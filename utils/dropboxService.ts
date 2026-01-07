import { Dropbox, DropboxAuth } from 'dropbox';
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

export interface DropboxAuthResult {
    result: {
        access_token: string;
        refresh_token: string;
        expires_in?: number;
        uid?: string;
    }
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

// Updated to use PKCE flow (async)
// We manually handle the code verifier storage to ensure reliability across the redirect
export const getDropboxAuthUrl = async (): Promise<string> => {
  const dbxAuth = new DropboxAuth({ clientId: CLIENT_ID });
  const redirectUri = window.location.href.split('#')[0].split('?')[0];
  
  // Args: redirectUri, state, responseType, tokenAccessType, scope, includeGrantedScopes, usePkce
  const authUrl = await dbxAuth.getAuthenticationUrl(redirectUri, undefined, 'code', 'offline', undefined, undefined, true);
  
  // Explicitly save the code verifier to sessionStorage
  const codeVerifier = dbxAuth.getCodeVerifier();
  if (codeVerifier) {
      window.sessionStorage.setItem('rhizonote_dropbox_code_verifier', codeVerifier);
  }

  return authUrl as string;
};

// New helper to exchange authorization code for tokens
export const exchangeCodeForToken = async (code: string): Promise<DropboxAuthResult> => {
    const dbxAuth = new DropboxAuth({ clientId: CLIENT_ID });
    
    // Retrieve and set the code verifier
    const codeVerifier = window.sessionStorage.getItem('rhizonote_dropbox_code_verifier');
    if (codeVerifier) {
        dbxAuth.setCodeVerifier(codeVerifier);
    }

    const redirectUri = window.location.href.split('#')[0].split('?')[0];
    const response = await dbxAuth.getAccessTokenFromCode(redirectUri, code);
    
    // Clean up
    window.sessionStorage.removeItem('rhizonote_dropbox_code_verifier');
    
    return response as unknown as DropboxAuthResult;
};

// Parsing hash is no longer the primary method, but kept for legacy/cleanup if needed
export const parseAuthTokenFromUrl = (): string | null => {
  const hash = window.location.hash;
  if (!hash) return null;
  const params = new URLSearchParams(hash.substring(1));
  return params.get('access_token');
};

/**
 * Performs a smart two-way sync with proper conflict resolution.
 * Strategy:
 * 1. Process explicit deletions and renames first
 * 2. Download all remote files and build ID-based index
 * 3. For each local note, determine action: upload, download, or skip
 * 4. Clean up duplicate remote files
 * 5. Execute all operations
 */
export const syncDropboxData = async (
    auth: { accessToken?: string | null, refreshToken?: string | null },
    localNotes: Note[], 
    localFolders: Folder[], 
    pathsToDelete: string[] = [],
    renames: RenameOperation[] = []
): Promise<SyncData> => {
  
  // Initialize Dropbox client with Refresh Token if available (Preferred)
  let dbx: Dropbox;
  
  if (auth.refreshToken) {
      dbx = new Dropbox({ 
          clientId: CLIENT_ID, 
          refreshToken: auth.refreshToken 
      });
  } else if (auth.accessToken) {
      dbx = new Dropbox({ accessToken: auth.accessToken });
  } else {
      throw new Error("No credentials provided for sync.");
  }

  const log: string[] = [];

  try {
    // ==================== STEP 0: Process Explicit Operations ====================
    
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
                        log.push(`Already deleted: ${path}`);
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
        for (const op of renames) {
            if (op.from === op.to) continue;
            try {
                await dbx.filesMoveV2({
                    from_path: op.from,
                    to_path: op.to,
                    autorename: false
                });
                log.push(`Renamed remote: ${op.from} -> ${op.to}`);
            } catch (e: any) {
                const errorSummary = e?.error?.error_summary || '';
                if (errorSummary.includes('from_lookup/not_found')) {
                    log.push(`Rename skipped (source not found): ${op.from}`);
                } else if (errorSummary.includes('to/conflict')) {
                    log.push(`Rename skipped (target exists): ${op.to}`);
                } else {
                    console.error(`Rename failed for ${op.from} -> ${op.to}`, e);
                    log.push(`Failed rename: ${op.from} -> ${op.to}`);
                }
            }
        }
    }

    // ==================== STEP 1: Fetch Remote State ====================
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

    // ==================== STEP 2: Reconstruct Remote Folder Structure ====================
    const mergedFolders = [...localFolders];
    
    const localFolderPaths = new Map<string, string>();
    const mapLocalFolderPaths = (parentId: string | null, parentPath: string) => {
        const children = localFolders.filter(f => f.parentId === parentId && !f.deletedAt);
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

    // ==================== STEP 3: Download and Index All Remote Files ====================
    
    interface RemoteNoteData {
        entry: any;
        noteId: string;
        note: Note;
    }
    
    const remoteNotesByIdMap = new Map<string, RemoteNoteData[]>();
    
    // Download all remote files in chunks
    const downloadChunks = chunkArray(remoteFileEntries, 10);
    for (const batch of downloadChunks) {
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
                            else if (!isNaN(Number(val)) && key !== 'title' && key !== 'id') metadata[key] = Number(val);
                            else metadata[key] = val;
                        }
                    });
                }

                // Determine folder ID
                const lastSlash = entry.path_lower.lastIndexOf('/');
                const parentPathLower = entry.path_lower.substring(0, lastSlash);
                const folderId = localFolderPaths.get(parentPathLower) || null;

                const noteId = metadata.id || Math.random().toString(36).substr(2, 9);
                const noteTitle = metadata.title || entry.name.replace('.md', '');

                const remoteNote: Note = {
                    id: noteId,
                    title: noteTitle,
                    content: content,
                    folderId: folderId,
                    isBookmarked: !!metadata.isBookmarked,
                    bookmarkOrder: metadata.bookmarkOrder,
                    createdAt: metadata.created || Date.now(),
                    updatedAt: new Date(entry.client_modified).getTime(),
                    deletedAt: metadata.deletedAt,
                };

                if (!remoteNotesByIdMap.has(noteId)) {
                    remoteNotesByIdMap.set(noteId, []);
                }
                remoteNotesByIdMap.get(noteId)!.push({
                    entry,
                    noteId,
                    note: remoteNote
                });

            } catch (e) {
                console.error(`Failed to download ${entry.path_display}`, e);
            }
        }));
    }

    // ==================== STEP 4: Detect and Clean Duplicates ====================
    
    const filesToDeleteFromRemote: string[] = [];
    const canonicalRemoteNotes = new Map<string, RemoteNoteData>();
    
    remoteNotesByIdMap.forEach((files, noteId) => {
        if (files.length > 1) {
            // Sort by modification time (newest first)
            files.sort((a, b) => {
                const timeA = new Date(a.entry.client_modified).getTime();
                const timeB = new Date(b.entry.client_modified).getTime();
                return timeB - timeA;
            });
            
            // Keep newest, mark rest for deletion
            canonicalRemoteNotes.set(noteId, files[0]);
            
            for (let i = 1; i < files.length; i++) {
                filesToDeleteFromRemote.push(files[i].entry.path_lower);
                log.push(`Marked duplicate for deletion: ${files[i].entry.path_display}`);
            }
        } else {
            canonicalRemoteNotes.set(noteId, files[0]);
        }
    });

    // ==================== STEP 5: Three-Way Merge Decision ====================
    
    const notesToUpload: Note[] = [];
    const notesToDownload: RemoteNoteData[] = [];
    const staleRemotePaths: string[] = []; // Old paths that need deletion
    const finalNotes: Note[] = [];
    
    // Index local notes by ID
    const localNotesById = new Map<string, Note>();
    localNotes.forEach(note => localNotesById.set(note.id, note));

    // Process each local note
    localNotes.forEach(localNote => {
        const remoteData = canonicalRemoteNotes.get(localNote.id);
        
        if (!remoteData) {
            // Note exists only locally
            if (!localNote.deletedAt) {
                notesToUpload.push(localNote);
                log.push(`Will upload (new): ${localNote.title}`);
            }
            finalNotes.push(localNote);
        } else {
            // Note exists both locally and remotely
            const remoteNote = remoteData.note;
            const remoteEntry = remoteData.entry;
            
            // Calculate expected path for local note
            const expectedPath = getNotePath(localNote.title, localNote.folderId, mergedFolders);
            const actualRemotePath = remoteEntry.path_lower;
            const pathsMatch = expectedPath.toLowerCase() === actualRemotePath;
            
            // Determine which version is newer
            const localTime = localNote.updatedAt;
            const remoteTime = remoteNote.updatedAt;
            const timeDiff = Math.abs(localTime - remoteTime);
            
            if (!pathsMatch) {
                // Path mismatch - local has been renamed/moved
                // Always trust local path, upload to new location
                notesToUpload.push(localNote);
                staleRemotePaths.push(actualRemotePath);
                log.push(`Path mismatch: ${localNote.title} - will upload to new path`);
                finalNotes.push(localNote);
            } else if (timeDiff <= 2000) {
                // Timestamps are essentially equal - no conflict
                finalNotes.push(localNote);
            } else if (localTime > remoteTime) {
                // Local is newer
                notesToUpload.push(localNote);
                log.push(`Will upload (local newer): ${localNote.title}`);
                finalNotes.push(localNote);
            } else {
                // Remote is newer
                notesToDownload.push(remoteData);
                log.push(`Will download (remote newer): ${localNote.title}`);
                finalNotes.push(remoteNote);
            }
            
            // Mark as processed
            canonicalRemoteNotes.delete(localNote.id);
        }
    });

    // Process remaining remote notes (not in local)
    canonicalRemoteNotes.forEach((remoteData) => {
        notesToDownload.push(remoteData);
        log.push(`Will download (new from remote): ${remoteData.note.title}`);
        finalNotes.push(remoteData.note);
    });

    // ==================== STEP 6: Create Missing Remote Folders ====================
    
    const folderUploads: string[] = [];
    const remotePathSet = new Set(remoteFolderEntries.map(e => e.path_lower));

    for (const folder of localFolders) {
        if (folder.deletedAt) continue;
        const path = getFolderPath(folder.id, localFolders);
        if (!path || path === '/' || path === '') continue;
        
        if (!remotePathSet.has(path.toLowerCase())) {
            folderUploads.push(path);
        }
    }
    
    folderUploads.sort((a, b) => a.length - b.length);
    const uniqueFolderUploads = [...new Set(folderUploads)];

    const createFolderChunks = chunkArray(uniqueFolderUploads, 5);
    for (const batch of createFolderChunks) {
        await Promise.all(batch.map(async (path) => {
            try {
                await dbx.filesCreateFolderV2({ path, autorename: false });
                log.push(`Created remote folder: ${path}`);
            } catch (e: any) {
                const errorTag = e?.error?.['.tag'];
                const pathReason = e?.error?.path?.['.tag'];
                if (errorTag !== 'path' || pathReason !== 'conflict') {
                    console.warn(`Create folder warning: ${path}`, e);
                }
            }
        }));
    }

    // ==================== STEP 7: Execute Uploads ====================
    
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
${note.bookmarkOrder !== undefined ? `bookmarkOrder: ${note.bookmarkOrder}` : ''}
${note.deletedAt ? `deletedAt: ${note.deletedAt}` : ''}
---
${note.content}`;
            const blob = new Blob([fileContent], { type: 'text/markdown' });

            try {
                const response = await dbx.filesUpload({
                    path: path,
                    contents: blob,
                    mode: { '.tag': 'overwrite' }
                });
                
                // Update timestamp to match server
                const serverTime = new Date(response.result.client_modified).getTime();
                const targetNote = finalNotes.find(n => n.id === note.id);
                if (targetNote) {
                    targetNote.updatedAt = serverTime;
                }
                
                log.push(`Uploaded: ${note.title}`);
            } catch (e) {
                console.error(`Upload failed for ${path}`, e);
                log.push(`Upload failed: ${note.title}`);
            }
        }));
    }

    // ==================== STEP 8: Clean Up Stale Files ====================
    
    const allFilesToDelete = [...filesToDeleteFromRemote, ...staleRemotePaths];
    const uniqueFilesToDelete = Array.from(new Set(allFilesToDelete));
    
    if (uniqueFilesToDelete.length > 0) {
        const delChunks = chunkArray(uniqueFilesToDelete, 10);
        for (const batch of delChunks) {
            await Promise.all(batch.map(async (path) => {
                try {
                    await dbx.filesDeleteV2({ path });
                    log.push(`Deleted stale file: ${path}`);
                } catch (e: any) {
                    if (!e?.error?.error_summary?.includes('path_lookup/not_found')) {
                        console.error(`Deletion failed for ${path}`, e);
                    }
                }
            }));
        }
    }

    // ==================== STEP 9: Return Final State ====================
    
    return {
        notes: finalNotes,
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