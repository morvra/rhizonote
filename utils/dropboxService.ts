import { Dropbox } from 'dropbox';
import { Note, Folder } from '../types';

const CLIENT_ID = '2reog117jgm9gmw';
const SYNC_FILENAME = '/rhizonote_data.json';

export interface SyncData {
  notes: Note[];
  folders: Folder[];
  version: number;
  timestamp: number;
}

export const getDropboxAuthUrl = () => {
  const redirectUri = window.location.origin; // Current domain
  // Using Implicit Grant for client-side only app
  return `https://www.dropbox.com/oauth2/authorize?client_id=${CLIENT_ID}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}`;
};

export const parseAuthTokenFromUrl = (): string | null => {
  const hash = window.location.hash;
  if (!hash) return null;
  
  const params = new URLSearchParams(hash.substring(1)); // Remove the #
  return params.get('access_token');
};

export const uploadDataToDropbox = async (accessToken: string, notes: Note[], folders: Folder[]) => {
  const dbx = new Dropbox({ accessToken });
  
  const data: SyncData = {
    notes,
    folders,
    version: 1,
    timestamp: Date.now()
  };

  const fileContent = JSON.stringify(data, null, 2);
  const blob = new Blob([fileContent], { type: 'application/json' });

  // Dropbox SDK requires file data to be passed specifically. 
  // For browser env, it handles Blob/File.
  await dbx.filesUpload({
    path: SYNC_FILENAME,
    contents: blob,
    mode: { '.tag': 'overwrite' } // Overwrite existing backup
  });
};

export const downloadDataFromDropbox = async (accessToken: string): Promise<SyncData | null> => {
  const dbx = new Dropbox({ accessToken });

  try {
    const response = await dbx.filesDownload({ path: SYNC_FILENAME });
    
    // The SDK response (result) contains a 'fileBlob' in browser environments 
    // or we might need to cast 'response.result' depending on version.
    // In strict types, 'fileBlob' exists on the result object for browser builds.
    const fileBlob = (response.result as any).fileBlob;

    if (fileBlob) {
        const text = await fileBlob.text();
        return JSON.parse(text) as SyncData;
    }
    return null;
  } catch (error: any) {
    if (error.error && error.error['.tag'] === 'path') {
        // File not found
        console.warn('Sync file not found in Dropbox');
        return null;
    }
    throw error;
  }
};