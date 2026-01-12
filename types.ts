
export type SortField = 'name' | 'created' | 'updated';
export type SortDirection = 'asc' | 'desc';
export type Theme = 'light' | 'dark';

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
  deletedAt?: number;
}

export interface Note {
  id: string;
  folderId: string | null;
  title: string;
  content: string;
  isBookmarked: boolean;
  isPublished?: boolean;
  updatedAt: number;
  createdAt: number;
  isGhost?: boolean;
  bookmarkOrder?: number;
  deletedAt?: number;
}

export type PaneId = 'left' | 'right';

export interface EditorState {
  activeNoteId: string | null;
  mode: 'edit' | 'preview';
}

export interface TaskItem {
  noteId: string;
  lineIndex: number;
  content: string;
  isChecked: boolean;
  rawContent: string;
}