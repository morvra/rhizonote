import { Dropbox } from 'dropbox';
import { Note, Folder } from '../types';

const CLIENT_ID = '2reog117jgm9gmw';

export interface SyncData {
  notes: Note[];
  folders: Folder[];
  version: number;
  timestamp: number;
  syncLog: string[]; // For UI feedback
}

export interface RenameOperation {
    from: string;
    to: string;
}

// Helper: Sanitize filename to avoid invalid characters in Dropbox paths
export const sanitizeFilename = (name: string) => {
  return name.replace(/[/\\?%*:|"<>]/g, '-');
};

// Helper: Get full path for a folder
export const getFolderPath = (folderId: string | null, folders: Folder[]): string => {
    if (!folderId) return '';
    const folder = folders.find(f => f.id === folderId);
    if (!folder) return '';
    const parentPath = getFolderPath(folder.parentId, folders);
    return parentPath
        ? `${parentPath}/${sanitizeFilename(folder.name)}`
        : `/${sanitizeFilename(folder.name)}`;
};

// Helper: Generate full path for a note
export const getNotePath = (noteTitle: string, folderId: string | null, folders: Folder[]) => {
    const folderPath = getFolderPath(folderId, folders);
    const safeTitle = sanitizeFilename(noteTitle) || 'Untitled';
    return `${folderPath}/${safeTitle}.md`;
};

// Helper: Process requests in chunks to avoid hitting browser/API limits
const chunkArray = <T>(array: T[], size: number): T[][] => {
  return Array.from({ length: Math.ceil(array.length / size) }, (_, i) =>
    array.slice(i * size, i * size + size)
  );
};

export const getDropboxAuthUrl = () => {
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
 * Performs a smart two-way sync.
 * 1. Process queued deletions.
 * 2. Process queued renames (Moves).
 * 3. Downloads file list from Dropbox.
 * 4. Compares with local notes based on PATH.
 * 5. Syncs diffs.
 */
export const syncDropboxData = async (
    accessToken: string, 
    localNotes: Note[], 
    localFolders: Folder[], 
    pathsToDelete: string[] = [],
    renames: RenameOperation[] = []
): Promise<SyncData> => {
  const dbx = new Dropbox({ accessToken });
  const log: string[] = [];

  try {
    // 0a. Process Deletions First
    if (pathsToDelete.length > 0) {
        const uniquePaths = Array.from(new Set(pathsToDelete));
        const delChunks = chunkArray(uniquePaths, 10);
        for (const batch of delChunks) {
            await Promise.all(batch.map(async (path) => {
                try {
                    await dbx.filesDeleteV2({ path });
                    log.push(`Deleted remote: ${path}`);
                } catch (e: any) {
                    if (e?.error?.error_summary?.includes('path_lookup/not_found')) {
                        // already gone, fine
                    } else {
                        console.error(`Deletion failed for ${path}`, e);
                        log.push(`Failed delete: ${path}`);
                    }
                }
            }));
        }
    }

    // 0b. Process Renames (Moves)
    if (renames.length > 0) {
        // Execute sequentially to respect order dependencies
        for (const op of renames) {
            if (op.from === op.to) continue;
            try {
                await dbx.filesMoveV2({
                    from_path: op.from,
                    to_path: op.to,
                    autorename: false // Fail if target exists, usually desired for sync integrity
                });
                log.push(`Renamed remote: ${op.from} -> ${op.to}`);
            } catch (e: any) {
                // If from_path not found, maybe it was deleted or never uploaded?
                // If to_path exists, it's a conflict.
                console.error(`Rename failed for ${op.from} -> ${op.to}`, e);
                log.push(`Failed rename: ${op.from} -> ${op.to}`);
            }
        }
    }

    // 1. Fetch Remote State
    let entries: any[] = [];
    let hasMore = true;
    let cursor = null;

    while (hasMore) {
        const result: any = cursor 
            ? await dbx.filesListFolderContinue({ cursor })
            : await dbx.filesListFolder({ path: '', recursive: true });
        
        entries = [...entries, ...result.result.entries];
        hasMore = result.result.has_more;
        cursor = result.result.cursor;
    }

    const remoteFileEntries = entries.filter(e => e['.tag'] === 'file' && e.name.endsWith('.md'));
    const remoteFolderEntries = entries.filter(e => e['.tag'] === 'folder');

    // 2. Reconstruct Remote Folder Structure
    const mergedFolders = [...localFolders];
    
    // Calculate all local folder paths for matching
    const localFolderPaths = new Map<string, string>(); // Path (lower) -> ID
    const mapLocalFolderPaths = (parentId: string | null, parentPath: string) => {
        const children = localFolders.filter(f => f.parentId === parentId);
        children.forEach(c => {
            const myPath = parentPath === '' ? `/${sanitizeFilename(c.name).toLowerCase()}` : `${parentPath}/${sanitizeFilename(c.name).toLowerCase()}`;
            localFolderPaths.set(myPath, c.id);
            mapLocalFolderPaths(c.id, myPath);
        });
    };
    mapLocalFolderPaths(null, '');

    // Process Remote Folders
    remoteFolderEntries.sort((a, b) => a.path_lower.length - b.path_lower.length).forEach((entry: any) => {
        if (!localFolderPaths.has(entry.path_lower)) {
            const name = entry.name;
            const lastSlash = entry.path_lower.lastIndexOf('/');
            const parentPath = entry.path_lower.substring(0, lastSlash);
            
            const parentId = parentPath === '' ? null : (localFolderPaths.get(parentPath) || null);
            const newId = Math.random().toString(36).substr(2, 9);
            
            mergedFolders.push({
                id: newId,
                name: name,
                parentId: parentId,
                createdAt: Date.now()
            });
            localFolderPaths.set(entry.path_lower, newId);
            log.push(`Created local folder: ${entry.path_display}`);
        }
    });

    // 3. Compare Files and Notes
    const notesToUpload: Note[] = [];
    const filesToDownload: any[] = [];
    const mergedNotes = [...localNotes];

    const remoteFileMap = new Map<string, any>();
    remoteFileEntries.forEach((f: any) => remoteFileMap.set(f.path_lower, f));

    // Check Local Notes against Remote
    for (const note of localNotes) {
        const path = getNotePath(note.title, note.folderId, mergedFolders);
        const pathLower = path.toLowerCase();
        const remoteFile = remoteFileMap.get(pathLower);

        if (!remoteFile) {
            notesToUpload.push(note);
            log.push(`Queued upload: ${note.title} (New Local)`);
        } else {
            const remoteTime = new Date(remoteFile.client_modified).getTime();
            const localTime = note.updatedAt;

            // Allow 2 second buffer
            if (localTime > remoteTime + 2000) {
                notesToUpload.push(note);
                log.push(`Queued upload: ${note.title} (Local Newer)`);
            } else if (remoteTime > localTime + 2000) {
                filesToDownload.push(remoteFile);
                log.push(`Queued download: ${note.title} (Remote Newer)`);
            }
            remoteFileMap.delete(pathLower);
        }
    }

    // Remaining remote files -> Download
    remoteFileMap.forEach((remoteFile) => {
        filesToDownload.push(remoteFile);
        log.push(`Queued download: ${remoteFile.name} (New Remote)`);
    });

    // 4. Execute Downloads
    const dlChunks = chunkArray(filesToDownload, 5);
    for (const batch of dlChunks) {
        await Promise.all(batch.map(async (entry) => {
            try {
                const r = await dbx.filesDownload({ path: entry.path_lower });
                const blob = (r.result as any).fileBlob;
                const text = await blob.text();

                // Parse Metadata
                const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)?$/);
                let metadata: any = {};
                let content = text;

                if (match) {
                    const metaBlock = match[1];
                    content = match[2] || '';
                    metaBlock.split('\n').forEach((line: string) => {
                        const colonIndex = line.indexOf(':');
                        if (colonIndex > -1) {
                            const key = line.substring(0, colonIndex).trim();
                            const val = line.substring(colonIndex + 1).trim();
                            if (val === 'true') metadata[key] = true;
                            else if (val === 'false') metadata[key] = false;
                            else if (!isNaN(Number(val)) && key !== 'title') metadata[key] = Number(val);
                            else metadata[key] = val;
                        }
                    });
                }

                const lastSlash = entry.path_lower.lastIndexOf('/');
                const parentPathLower = entry.path_lower.substring(0, lastSlash);
                const folderId = localFolderPaths.get(parentPathLower) || null;

                const noteId = metadata.id || Math.random().toString(36).substr(2, 9);
                const noteTitle = metadata.title || entry.name.replace('.md', '');

                const newNoteObj: Note = {
                    id: noteId,
                    title: noteTitle,
                    content: content,
                    folderId: folderId,
                    isBookmarked: !!metadata.isBookmarked,
                    createdAt: metadata.created || Date.now(),
                    updatedAt: new Date(entry.client_modified).getTime(),
                };
                
                const existingIdx = mergedNotes.findIndex(n => n.id === newNoteObj.id);
                if (existingIdx > -1) {
                    mergedNotes[existingIdx] = newNoteObj;
                } else {
                    const samePathIdx = mergedNotes.findIndex(n => {
                        return n.title === newNoteObj.title && n.folderId === newNoteObj.folderId;
                    });
                    if (samePathIdx > -1) {
                         mergedNotes[samePathIdx] = newNoteObj;
                    } else {
                        mergedNotes.push(newNoteObj);
                    }
                }

            } catch (e) {
                console.error(`Download failed for ${entry.path_display}`, e);
            }
        }));
    }

    // 5. Execute Uploads
    const ulChunks = chunkArray(notesToUpload, 5);
    for (const batch of ulChunks) {
        await Promise.all(batch.map(async (note) => {
            const path = getNotePath(note.title, note.folderId, mergedFolders);
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
                    path: path,
                    contents: blob,
                    mode: { '.tag': 'overwrite' }
                });
            } catch (e) {
                console.error(`Upload failed for ${path}`, e);
            }
        }));
    }

    return {
        notes: mergedNotes,
        folders: mergedFolders,
        version: 1,
        timestamp: Date.now(),
        syncLog: log
    };

  } catch (error: any) {
    console.error("Dropbox Sync Error:", error);
    throw error;
  }
};