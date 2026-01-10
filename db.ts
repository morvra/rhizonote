import Dexie, { Table } from 'dexie';
import { Note, Folder } from './types';

export class RhizonoteDB extends Dexie {
  notes!: Table<Note>;
  folders!: Table<Folder>;

  constructor() {
    super('RhizonoteDB');
    (this as any).version(1).stores({
      // Primary key and indexed props
      notes: 'id, folderId, title, updatedAt, createdAt, deletedAt, isBookmarked, bookmarkOrder',
      folders: 'id, parentId, name, deletedAt'
    });
  }
}

export const db = new RhizonoteDB();