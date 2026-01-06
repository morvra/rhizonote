import { Dropbox } from 'dropbox';
import { Note, Folder } from '../types';

const CLIENT_ID = '2reog117jgm9gmw';

export interface SyncData {
  notes: Note[];
  folders: Folder[];
  version: number;
  timestamp: number;
}

// Helper: Sanitize filename to avoid invalid characters in Dropbox paths
const sanitizeFilename = (name: string) => {
  return name.replace(/[/\\?%*:|"<>]/g, '-');
};

// Helper: Process requests in chunks to avoid hitting browser/API limits
const chunkArray = <T>(array: T[], size: number): T[][] => {
  return Array.from({ length: Math.ceil(array.length / size) }, (_, i) =>
    array.slice(i * size, i * size + size)
  );
};

export const getDropboxAuthUrl = () => {
  // Construct redirect URI from current location, including pathname
  const redirectUri = window.location.href.split('#')[0].split('?')[0];
  return `https://www.dropbox.com/oauth2/authorize?client_id=${CLIENT_ID}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}`;
};

export const parseAuthTokenFromUrl = (): string | null => {
  const hash = window.location.hash;
  if (!hash) return null;
  
  const params = new URLSearchParams(hash.substring(1));
  return params.get('access_token');
};

/**
 * Uploads all notes as individual Markdown files to Dropbox.
 * Folder structure is preserved.
 * Metadata (ID, created, etc.) is stored in YAML Frontmatter.
 */
export const uploadDataToDropbox = async (accessToken: string, notes: Note[], folders: Folder[]) => {
  const dbx = new Dropbox({ accessToken });
  
  // 1. Build a map of FolderID -> Full Path String
  const folderPathMap = new Map<string, string>();

  // Recursive function to resolve path for a given folder ID
  const getFolderPath = (folderId: string | null): string => {
      if (!folderId) return '';
      if (folderPathMap.has(folderId)) return folderPathMap.get(folderId)!;

      const folder = folders.find(f => f.id === folderId);
      if (!folder) return ''; // Should not happen if data integrity is good

      const parentPath = getFolderPath(folder.parentId);
      // Construct path: /Parent/Child
      const myPath = parentPath 
        ? `${parentPath}/${sanitizeFilename(folder.name)}` 
        : `/${sanitizeFilename(folder.name)}`;
      
      folderPathMap.set(folderId, myPath);
      return myPath;
  };

  // Pre-calculate paths for all folders to handle hierarchy
  folders.forEach(f => getFolderPath(f.id));

  // 2. Prepare upload promises
  // We divide notes into chunks to prevent "Too Many Requests" or browser hangs
  const noteChunks = chunkArray(notes, 5); // Upload 5 files at a time

  for (const batch of noteChunks) {
      const promises = batch.map(async (note) => {
          const folderPath = note.folderId ? getFolderPath(note.folderId) : '';
          const safeTitle = sanitizeFilename(note.title) || 'Untitled';
          const fullPath = `${folderPath}/${safeTitle}.md`;

          // Construct Content with Frontmatter
          const fileContent = `---
id: ${note.id}
title: ${note.title}
created: ${note.createdAt}
updated: ${note.updatedAt}
isBookmarked: ${note.isBookmarked || false}
---
${note.content}`;

          const blob = new Blob([fileContent], { type: 'text/markdown' });

          try {
              await dbx.filesUpload({
                  path: fullPath,
                  contents: blob,
                  mode: { '.tag': 'overwrite' } // Overwrite if exists
              });
          } catch (e) {
              console.error(`Failed to upload ${fullPath}`, e);
              // We continue uploading others even if one fails
          }
      });

      await Promise.all(promises);
  }
};

/**
 * Downloads all Markdown files from Dropbox and reconstructs the data.
 * Rebuilds Folder objects based on directory structure.
 */
export const downloadDataFromDropbox = async (accessToken: string): Promise<SyncData | null> => {
  const dbx = new Dropbox({ accessToken });

  try {
    // 1. List all files recursively
    let entries: any[] = [];
    let hasMore = true;
    let cursor = null;

    // Fetch all entries (pagination)
    while (hasMore) {
        const result: any = cursor 
            ? await dbx.filesListFolderContinue({ cursor })
            : await dbx.filesListFolder({ path: '', recursive: true });
        
        entries = [...entries, ...result.result.entries];
        hasMore = result.result.has_more;
        cursor = result.result.cursor;
    }

    // 2. Reconstruct Folders from Paths
    const newFolders: Folder[] = [];
    // Map full lowercase path to a newly generated ID
    const pathIdMap = new Map<string, string>(); 

    // Filter only folders and sort by path length to ensure parents are processed before children
    const folderEntries = entries
        .filter(e => e['.tag'] === 'folder')
        .sort((a, b) => a.path_lower.length - b.path_lower.length);

    folderEntries.forEach(entry => {
        const pathLower = entry.path_lower; // e.g. "/parent/child"
        const name = entry.name;
        
        // Determine Parent ID
        const lastSlash = pathLower.lastIndexOf('/');
        const parentPathLower = pathLower.substring(0, lastSlash); // e.g. "/parent"
        
        // If parentPathLower is empty string, it's root (parentId = null). 
        // Otherwise, look up the ID we generated for the parent.
        const parentId = parentPathLower ? (pathIdMap.get(parentPathLower) || null) : null;

        const newId = Math.random().toString(36).substr(2, 9);
        pathIdMap.set(pathLower, newId);

        newFolders.push({
            id: newId,
            name: name,
            parentId: parentId,
            createdAt: Date.now() // Dropbox doesn't easy provide folder creation time
        });
    });

    // 3. Download and Parse Notes
    const newNotes: Note[] = [];
    const fileEntries = entries.filter(e => e['.tag'] === 'file' && e.name.endsWith('.md'));

    // Download in chunks
    const fileChunks = chunkArray(fileEntries, 5);

    for (const batch of fileChunks) {
        const promises = batch.map(async (entry) => {
            try {
                const r = await dbx.filesDownload({ path: entry.path_lower });
                const blob = (r.result as any).fileBlob;
                const text = await blob.text();

                // Parse Frontmatter
                // Matches: --- (newline) content (newline) --- (newline) rest
                const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)?$/);
                
                let metadata: any = {};
                let content = text;

                if (match) {
                    const metaBlock = match[1];
                    content = match[2] || ''; // capture group 2 might be undefined if empty
                    
                    metaBlock.split('\n').forEach((line: string) => {
                        const colonIndex = line.indexOf(':');
                        if (colonIndex > -1) {
                            const key = line.substring(0, colonIndex).trim();
                            const val = line.substring(colonIndex + 1).trim();
                            
                            // Simple type conversion
                            if (val === 'true') metadata[key] = true;
                            else if (val === 'false') metadata[key] = false;
                            else if (!isNaN(Number(val)) && key !== 'title') metadata[key] = Number(val);
                            else metadata[key] = val;
                        }
                    });
                }

                // Determine Folder ID based on file path
                const lastSlash = entry.path_lower.lastIndexOf('/');
                const parentPathLower = entry.path_lower.substring(0, lastSlash);
                const folderId = pathIdMap.get(parentPathLower) || null;

                // Fallback for ID if not in frontmatter (e.g. externally created file)
                const noteId = metadata.id || Math.random().toString(36).substr(2, 9);
                // Fallback for title if not in frontmatter
                const noteTitle = metadata.title || entry.name.replace('.md', '');

                newNotes.push({
                    id: noteId,
                    title: noteTitle,
                    content: content,
                    folderId: folderId,
                    isBookmarked: !!metadata.isBookmarked,
                    createdAt: metadata.created || Date.now(),
                    updatedAt: metadata.updated || Date.now(),
                });

            } catch (e) {
                console.error(`Error downloading ${entry.path_display}`, e);
            }
        });
        await Promise.all(promises);
    }

    return {
        notes: newNotes,
        folders: newFolders,
        version: 1,
        timestamp: Date.now()
    };

  } catch (error: any) {
    console.error("Dropbox Sync Error:", error);
    // If folder doesn't exist yet (first sync), return empty valid structure
    if (error.error && error.error['.tag'] === 'path') {
         return { notes: [], folders: [], version: 1, timestamp: Date.now() };
    }
    throw error;
  }
};