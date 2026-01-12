import Dexie, { Table } from 'dexie';
import { Note, Folder, TaskItem } from './types';

export class RhizonoteDB extends Dexie {
  notes!: Table<Note>;
  folders!: Table<Folder>;
  tasks!: Table<TaskItem>;

  constructor() {
    super('RhizonoteDB');
    (this as any).version(2).stores({
      notes: 'id, folderId, title, updatedAt, createdAt, deletedAt, isBookmarked, bookmarkOrder',
      folders: 'id, parentId, name, deletedAt',
      tasks: '[noteId+lineIndex], noteId, isChecked' 
    });
  }
}

export const db = new RhizonoteDB();