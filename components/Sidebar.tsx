import React, { useState } from 'react';
import { Note, Folder, SortField, SortDirection } from '../types';
import { FileText, Bookmark, Plus, Search, Trash2, Folder as FolderIcon, FolderOpen, ChevronRight, ChevronDown, Settings, Edit2 } from 'lucide-react';

interface SidebarProps {
  isOpen: boolean;
  isVisible: boolean;
  onCloseMobile: () => void;
  notes: Note[];
  folders: Folder[];
  activeNoteId: string | null;
  onSelectNote: (id: string) => void;
  onCreateNote: () => void;
  onCreateFolder: (parentId: string | null) => void;
  onDeleteNote: (id: string) => void;
  onDeleteFolder: (id: string) => void;
  onRenameFolder: (id: string) => void;
  onToggleBookmark: (id: string) => void;
  onReorderBookmark?: (draggedId: string, targetId: string) => void;
  onMoveNote: (noteId: string, folderId: string | null) => void;
  onMoveFolder: (folderId: string, parentId: string | null) => void;
  sortField: SortField;
  sortDirection: SortDirection;
  width?: number;
  onOpenSettings: () => void;
  expandedFolderIds: string[];
  onToggleFolderExpand: (folderId: string) => void;
}

interface NoteItemProps {
  note: Note;
  activeNoteId: string | null;
  onSelect: (id: string) => void;
  onToggleBookmark: (id: string) => void;
  onDelete: (id: string) => void;
  onNoteDrop?: (sourceId: string, targetId: string) => void;
}

const NoteItem: React.FC<NoteItemProps> = ({
  note,
  activeNoteId,
  onSelect,
  onToggleBookmark,
  onDelete,
  onNoteDrop
}) => {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragStart = (e: React.DragEvent) => {
    e.stopPropagation(); // Prevent parent folder from being dragged
    e.dataTransfer.setData('noteId', note.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (onNoteDrop) {
        e.preventDefault();
        setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    if (onNoteDrop) {
        e.preventDefault();
        setIsDragOver(false);
        const sourceId = e.dataTransfer.getData('noteId');
        if (sourceId && sourceId !== note.id) {
            onNoteDrop(sourceId, note.id);
            e.stopPropagation(); // Only stop if we handled it
        }
    }
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`group flex items-center justify-between px-2 py-1 ml-2 mb-px rounded-md cursor-pointer transition-colors ${
        note.id === activeNoteId
          ? 'bg-indigo-100 dark:bg-indigo-600/20 text-indigo-700 dark:text-indigo-300 border-l-2 border-indigo-500'
          : 'text-slate-600 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200 border-l-2 border-transparent'
      } ${isDragOver ? 'ring-2 ring-indigo-400 dark:ring-indigo-500' : ''}`}
      onClick={() => onSelect(note.id)}
    >
      <div className="flex items-center gap-2 truncate flex-1">
        <FileText className="w-4 h-4 md:w-[13px] md:h-[13px] text-slate-400 dark:text-slate-500" />
        <span className="text-sm md:text-xs truncate font-medium">{note.title || 'Untitled'}</span>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleBookmark(note.id);
          }}
          onMouseDown={(e) => e.stopPropagation()} 
          className={`p-0.5 rounded hover:bg-gray-300 dark:hover:bg-slate-700 ${note.isBookmarked ? 'text-yellow-600 dark:text-yellow-500' : 'text-slate-400 dark:text-slate-500'}`}
          title={note.isBookmarked ? 'Remove Bookmark' : 'Bookmark'}
        >
          <Bookmark size={11} fill={note.isBookmarked ? 'currentColor' : 'none'} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(note.id);
          }}
          onMouseDown={(e) => e.stopPropagation()} 
          className="p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/50 text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400"
          title="Delete"
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  );
};

const FolderItem: React.FC<{
  folder: Folder;
  allFolders: Folder[];
  allNotes: Note[];
  activeNoteId: string | null;
  onSelectNote: (id: string) => void;
  onToggleBookmark: (id: string) => void;
  onDeleteNote: (id: string) => void;
  onCreateFolder: (parentId: string) => void;
  onDeleteFolder: (id: string) => void;
  onRenameFolder: (id: string) => void;
  onMoveNote: (noteId: string, folderId: string) => void;
  onMoveFolder: (folderId: string, parentId: string) => void;
  sortField: SortField;
  sortDirection: SortDirection;
  expandedFolderIds: string[];
  onToggleExpand: (id: string) => void;
}> = ({ 
  folder, 
  allFolders, 
  allNotes, 
  activeNoteId, 
  onSelectNote, 
  onToggleBookmark, 
  onDeleteNote, 
  onCreateFolder, 
  onDeleteFolder, 
  onRenameFolder, 
  onMoveNote,
  onMoveFolder, 
  sortField,
  sortDirection,
  expandedFolderIds,
  onToggleExpand
}) => {
  const isExpanded = expandedFolderIds.includes(folder.id);
  const [isDragOver, setIsDragOver] = useState(false);

  // Filter children
  const childFolders = allFolders.filter(f => f.parentId === folder.id);
  const childNotes = allNotes.filter(n => n.folderId === folder.id);

  // Sort children
  // Folders are always sorted by name (asc)
  const sortedFolders = sortItems(childFolders, 'name', 'asc') as Folder[];
  // Notes follow the user selection
  const sortedNotes = sortItems(childNotes, sortField, sortDirection) as Note[];

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const noteId = e.dataTransfer.getData('noteId');
    const folderId = e.dataTransfer.getData('folderId');
    
    if (noteId) {
      onMoveNote(noteId, folder.id);
      e.stopPropagation(); // Stop bubbling if handled
      // Removed auto-expansion when dropping a note
    } else if (folderId && folderId !== folder.id) {
        onMoveFolder(folderId, folder.id);
        e.stopPropagation(); // Stop bubbling if handled
        // Do NOT force expand when moving a folder, preserving user state
    }
  };

  const handleDragStart = (e: React.DragEvent) => {
      e.stopPropagation(); // Prevent parent folder from being dragged (if nested)
      e.dataTransfer.setData('folderId', folder.id);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  return (
    <div 
      className={`mb-px rounded transition-colors ${isDragOver ? 'bg-indigo-50 dark:bg-slate-800/50 ring-1 ring-indigo-500' : ''}`}
      draggable
      onDragStart={handleDragStart}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <div 
        className={`group flex items-center justify-between px-2 py-1 rounded cursor-pointer text-slate-500 dark:text-slate-400 transition-colors ${
          isDragOver 
            ? 'text-indigo-600 dark:text-indigo-200' 
            : 'hover:bg-gray-200 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200'
        }`}
        onClick={() => onToggleExpand(folder.id)}
      >
        <div className="flex items-center gap-1 font-semibold text-sm md:text-xs uppercase tracking-wide pointer-events-none">
          {isExpanded 
            ? <ChevronDown className="w-4 h-4 md:w-[13px] md:h-[13px]" /> 
            : <ChevronRight className="w-4 h-4 md:w-[13px] md:h-[13px]" />
          }
          {isExpanded 
            ? <FolderOpen className="text-indigo-500 dark:text-indigo-400 w-4 h-4 md:w-[13px] md:h-[13px]" /> 
            : <FolderIcon className="w-4 h-4 md:w-[13px] md:h-[13px]" />
          }
          <span className="ml-1 select-none">{folder.name}</span>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onRenameFolder(folder.id);
                }}
                onMouseDown={(e) => e.stopPropagation()}
                className="p-0.5 hover:text-slate-800 dark:hover:text-white"
                title="Rename Folder"
            >
                <Edit2 size={11} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCreateFolder(folder.id);
                // Expand to show new subfolder
                if (!isExpanded) onToggleExpand(folder.id);
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className="p-0.5 hover:text-slate-800 dark:hover:text-white"
              title="New Subfolder"
            >
               <Plus size={11} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDeleteFolder(folder.id);
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className="p-0.5 hover:text-red-500 dark:hover:text-red-400"
              title="Delete Folder"
            >
               <Trash2 size={11} />
            </button>
        </div>
      </div>
      
      {isExpanded && (
        <div className="border-l border-gray-300 dark:border-slate-800 ml-2 pl-1 mt-0.5 min-h-[2px]">
          {sortedFolders.map(subFolder => (
              <FolderItem
                  key={subFolder.id}
                  folder={subFolder}
                  allFolders={allFolders}
                  allNotes={allNotes}
                  activeNoteId={activeNoteId}
                  onSelectNote={onSelectNote}
                  onToggleBookmark={onToggleBookmark}
                  onDeleteNote={onDeleteNote}
                  onCreateFolder={onCreateFolder}
                  onDeleteFolder={onDeleteFolder}
                  onRenameFolder={onRenameFolder}
                  onMoveNote={onMoveNote}
                  onMoveFolder={onMoveFolder}
                  sortField={sortField}
                  sortDirection={sortDirection}
                  expandedFolderIds={expandedFolderIds}
                  onToggleExpand={onToggleExpand}
              />
          ))}
          {sortedNotes.map(note => (
             <NoteItem
               key={note.id}
               note={note}
               activeNoteId={activeNoteId}
               onSelect={onSelectNote}
               onToggleBookmark={onToggleBookmark}
               onDelete={onDeleteNote}
             />
          ))}
          {sortedFolders.length === 0 && sortedNotes.length === 0 && (
             <div className="text-[10px] text-slate-400 dark:text-slate-600 px-4 py-0.5 italic pointer-events-none">Empty</div>
          )}
        </div>
      )}
    </div>
  );
};

// Helper for sorting
function sortItems(items: any[], field: SortField, direction: SortDirection) {
    return [...items].sort((a, b) => {
        let result = 0;
        if (field === 'updated') {
            result = (a.updatedAt || 0) - (b.updatedAt || 0);
        } else if (field === 'created') {
             result = (a.createdAt || 0) - (b.createdAt || 0);
        } else if (field === 'name') {
            result = (a.title || a.name || '').localeCompare(b.title || b.name || '');
        }
        
        return direction === 'asc' ? result : -result;
    });
}

const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  isVisible,
  onCloseMobile,
  notes,
  folders,
  activeNoteId,
  onSelectNote,
  onCreateNote,
  onCreateFolder,
  onDeleteNote,
  onDeleteFolder,
  onRenameFolder,
  onToggleBookmark,
  onReorderBookmark,
  onMoveNote,
  onMoveFolder,
  sortField,
  sortDirection,
  width,
  onOpenSettings,
  expandedFolderIds,
  onToggleFolderExpand
}) => {
  const [search, setSearch] = React.useState('');

  const filteredNotes = notes.filter(
    (n) =>
      n.title.toLowerCase().includes(search.toLowerCase()) ||
      n.content.toLowerCase().includes(search.toLowerCase())
  );

  const bookmarkedNotes = filteredNotes
    .filter((n) => n.isBookmarked)
    .sort((a, b) => (a.bookmarkOrder || 0) - (b.bookmarkOrder || 0));
  
  const isSearching = search.length > 0;

  const rootFolders = folders.filter(f => f.parentId === null);
  const rootNotes = filteredNotes.filter(n => !n.folderId);
  
  // Folders are always sorted by name (asc)
  const sortedRootFolders = sortItems(rootFolders, 'name', 'asc') as Folder[];
  // Notes follow the user selection
  const sortedRootNotes = sortItems(rootNotes, sortField, sortDirection) as Note[];

  const handleRootDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const noteId = e.dataTransfer.getData('noteId');
    const folderId = e.dataTransfer.getData('folderId');
    if (noteId) {
       onMoveNote(noteId, null);
    } else if (folderId) {
       onMoveFolder(folderId, null);
    }
  };

  return (
    <>
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden backdrop-blur-sm"
          onClick={onCloseMobile}
        />
      )}

      <div 
        className={`
          fixed inset-y-0 left-0 z-50 bg-gray-50 dark:bg-slate-900 flex flex-col transition-all duration-300 ease-in-out shrink-0
          md:relative
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
          ${!isVisible ? 'md:!w-0 md:!min-w-0 md:overflow-hidden' : 'md:translate-x-0'}
        `}
        style={{ width: width ? `${width}px` : undefined }} 
      >
        <div className={`flex flex-col h-full w-full ${!width ? 'w-64' : ''}`}> 
            <div className="p-4 border-b border-gray-200 dark:border-slate-800 shrink-0">
            <div className="flex items-center justify-between mb-4">
                <h1 className="font-bold text-slate-800 dark:text-slate-200 tracking-tight">Rhizonote</h1>
                <div className="flex items-center gap-1">
                <button
                    onClick={onOpenSettings}
                    className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-slate-700 rounded transition-colors"
                    title="Settings"
                >
                    <Settings size={16} />
                </button>
                <div className="w-px h-4 bg-gray-300 dark:bg-slate-700 mx-1"></div>
                <button
                    onClick={() => onCreateFolder(null)}
                    className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-slate-700 rounded transition-colors"
                    title="New Root Folder"
                >
                    <FolderIcon size={16} />
                </button>
                <button
                    onClick={onCreateNote}
                    className="p-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-500 transition-colors shadow-sm"
                    title="New Note"
                >
                    <Plus size={16} />
                </button>
                </div>
            </div>
            <div className="relative">
                <Search size={14} className="absolute left-3 top-2.5 text-slate-500 dark:text-slate-500" />
                <input
                type="text"
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 text-sm rounded pl-9 pr-3 py-2 border border-gray-300 dark:border-slate-800 focus:border-indigo-500 focus:outline-none placeholder-slate-400 dark:placeholder-slate-600"
                />
            </div>
            </div>

            <div 
            className="flex-1 overflow-y-auto p-2" 
            onDragOver={(e) => e.preventDefault()} 
            onDrop={handleRootDrop}
            >
            {bookmarkedNotes.length > 0 && !isSearching && (
                <div className="mb-4">
                <div className="px-3 py-1 text-xs font-semibold text-slate-500 dark:text-slate-600 uppercase tracking-wider mb-1 flex items-center gap-1">
                    <Bookmark size={10} /> Bookmarks
                </div>
                {bookmarkedNotes.map((note) => (
                    <NoteItem
                        key={note.id}
                        note={note}
                        activeNoteId={activeNoteId}
                        onSelect={onSelectNote}
                        onToggleBookmark={onToggleBookmark}
                        onDelete={onDeleteNote}
                        onNoteDrop={onReorderBookmark}
                    />
                ))}
                </div>
            )}

            {isSearching ? (
                /* Flat list for search results */
                <div>
                    <div className="px-3 py-1 text-xs font-semibold text-slate-500 dark:text-slate-600 uppercase tracking-wider mb-1">
                    Search Results
                    </div>
                    {filteredNotes.length === 0 && <div className="px-3 text-sm text-slate-500 dark:text-slate-500">No results found</div>}
                    {filteredNotes.map(note => (
                        <NoteItem
                            key={note.id}
                            note={note}
                            activeNoteId={activeNoteId}
                            onSelect={onSelectNote}
                            onToggleBookmark={onToggleBookmark}
                            onDelete={onDeleteNote}
                        />
                    ))}
                </div>
            ) : (
                /* Tree View */
                <div className="space-y-0.5 mb-2">
                    {sortedRootFolders.map(folder => (
                        <FolderItem
                            key={folder.id}
                            folder={folder}
                            allFolders={folders}
                            allNotes={filteredNotes} 
                            activeNoteId={activeNoteId}
                            onSelectNote={onSelectNote}
                            onToggleBookmark={onToggleBookmark}
                            onDeleteNote={onDeleteNote}
                            onCreateFolder={onCreateFolder}
                            onDeleteFolder={onDeleteFolder}
                            onRenameFolder={onRenameFolder}
                            onMoveNote={onMoveNote}
                            onMoveFolder={onMoveFolder}
                            sortField={sortField}
                            sortDirection={sortDirection}
                            expandedFolderIds={expandedFolderIds}
                            onToggleExpand={onToggleFolderExpand}
                        />
                    ))}

                    {sortedRootFolders.length > 0 && sortedRootNotes.length > 0 && <div className="h-1"></div>}
                    
                    {sortedRootNotes.map(note => (
                        <NoteItem
                            key={note.id}
                            note={note}
                            activeNoteId={activeNoteId}
                            onSelect={onSelectNote}
                            onToggleBookmark={onToggleBookmark}
                            onDelete={onDeleteNote}
                        />
                    ))}

                    {filteredNotes.length === 0 && folders.length === 0 && (
                    <div className="px-3 py-4 text-center text-slate-500 dark:text-slate-600 text-sm">No notes found</div>
                    )}
                </div>
            )}
            
            <div className="h-16"></div>
            </div>
        </div>
      </div>
    </>
  );
};

export default Sidebar;