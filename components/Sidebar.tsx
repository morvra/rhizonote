import React, { useState } from 'react';
import { Note, Folder, SortField, SortDirection } from '../types';
import { FileText, Bookmark, Plus, Search, Trash2, Folder as FolderIcon, FolderOpen, ChevronRight, ChevronDown, Settings, Edit2, RotateCcw, AlertTriangle, X } from 'lucide-react';

interface SidebarProps {
  isOpen: boolean;
  isVisible: boolean;
  onCloseMobile: () => void;
  notes: Note[];
  folders: Folder[];
  activeNoteId: string | null;
  onSelectNote: (id: string, query?: string) => void;
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
  onRestoreNote: (id: string) => void;
  onRestoreFolder: (id: string) => void;
  onPermanentDeleteNote: (id: string) => void;
  onPermanentDeleteFolder: (id: string) => void;
  onTitleClick?: () => void;
}

interface NoteItemProps {
  note: Note;
  activeNoteId: string | null;
  onSelect: (id: string, query?: string) => void;
  onToggleBookmark: (id: string) => void;
  onDelete: (id: string) => void;
  onNoteDrop?: (sourceId: string, targetId: string) => void;
  isTrash?: boolean;
  onRestore?: (id: string) => void;
  onPermanentDelete?: (id: string) => void;
  searchSnippet?: string;
}

// Helper to generate snippet
const getSearchSnippet = (content: string, query: string) => {
  if (!query || !content) return undefined;
  const lowerContent = content.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerContent.indexOf(lowerQuery);
  
  if (index === -1) return undefined;

  // Extract surrounding text
  const start = Math.max(0, index - 15);
  const end = Math.min(content.length, index + query.length + 30);
  let snippet = content.slice(start, end);

  // Replace newlines with spaces to keep it one line
  snippet = snippet.replace(/[\n\r]+/g, ' ');

  if (start > 0) snippet = '...' + snippet;
  if (end < content.length) snippet = snippet + '...';
  
  return snippet;
};

const NoteItem: React.FC<NoteItemProps> = ({
  note,
  activeNoteId,
  onSelect,
  onToggleBookmark,
  onDelete,
  onNoteDrop,
  isTrash,
  onRestore,
  onPermanentDelete,
  searchSnippet
}) => {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragStart = (e: React.DragEvent) => {
    e.stopPropagation(); // Prevent parent folder from being dragged
    e.dataTransfer.setData('noteId', note.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (onNoteDrop && !isTrash) {
        e.preventDefault();
        setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    if (onNoteDrop && !isTrash) {
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
      draggable={!isTrash}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`group relative flex items-center px-2 py-2 md:py-1.5 ml-2 mb-px rounded-md cursor-pointer transition-colors ${
        note.id === activeNoteId
          ? 'bg-indigo-100 dark:bg-indigo-600/20 text-indigo-700 dark:text-indigo-300 border-l-2 border-indigo-500'
          : 'text-slate-600 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200 border-l-2 border-transparent'
      } ${isDragOver ? 'ring-2 ring-indigo-400 dark:ring-indigo-500' : ''}`}
      onClick={() => !isTrash && onSelect(note.id)}
    >
      <div className="flex flex-col w-full overflow-hidden">
        <div className="flex items-center gap-2 truncate w-full">
            <FileText className="w-4 h-4 md:w-3.5 md:h-3.5 text-slate-400 dark:text-slate-500 shrink-0" />
            <span className={`text-sm md:text-xs truncate font-medium ${isTrash ? 'line-through text-slate-400' : ''}`}>{note.title || 'Untitled'}</span>
        </div>
        {searchSnippet && (
            <div className="text-[10px] text-slate-400 dark:text-slate-500 pl-6 truncate w-full opacity-80">
                {searchSnippet}
            </div>
        )}
      </div>
      
      {/* Action Icons - Absolute Positioned to avoid taking up space when hidden */}
      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-inherit">
        {!isTrash ? (
            <>
                <button
                onClick={(e) => {
                    e.stopPropagation();
                    onToggleBookmark(note.id);
                }}
                onMouseDown={(e) => e.stopPropagation()} 
                className={`p-1 md:p-0.5 rounded hover:bg-gray-300 dark:hover:bg-slate-700 ${note.isBookmarked ? 'text-yellow-600 dark:text-yellow-500' : 'text-slate-400 dark:text-slate-500'}`}
                title={note.isBookmarked ? 'Remove Bookmark' : 'Bookmark'}
                >
                <Bookmark size={14} fill={note.isBookmarked ? 'currentColor' : 'none'} />
                </button>
                <button
                onClick={(e) => {
                    e.stopPropagation();
                    onDelete(note.id);
                }}
                onMouseDown={(e) => e.stopPropagation()} 
                className="p-1 md:p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/50 text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400"
                title="Move to Trash"
                >
                <Trash2 size={14} />
                </button>
            </>
        ) : (
            <>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onRestore && onRestore(note.id);
                    }}
                    className="p-1 md:p-0.5 rounded hover:bg-green-100 dark:hover:bg-green-900/50 text-slate-400 hover:text-green-600 dark:hover:text-green-400"
                    title="Restore Note"
                >
                    <RotateCcw size={14} />
                </button>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onPermanentDelete && onPermanentDelete(note.id);
                    }}
                    className="p-1 md:p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/50 text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                    title="Delete Permanently"
                >
                    <AlertTriangle size={14} />
                </button>
            </>
        )}
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
        className={`group relative flex items-center px-2 py-2 md:py-1.5 rounded cursor-pointer text-slate-500 dark:text-slate-400 transition-colors ${
          isDragOver 
            ? 'text-indigo-600 dark:text-indigo-200' 
            : 'hover:bg-gray-200 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200'
        }`}
        onClick={() => onToggleExpand(folder.id)}
      >
        <div className="flex items-center gap-1 font-semibold text-sm md:text-xs uppercase tracking-wide pointer-events-none w-full">
          {isExpanded 
            ? <ChevronDown className="w-4 h-4 md:w-3.5 md:h-3.5 shrink-0" /> 
            : <ChevronRight className="w-4 h-4 md:w-3.5 md:h-3.5 shrink-0" />
          }
          {isExpanded 
            ? <FolderOpen className="text-indigo-500 dark:text-indigo-400 w-4 h-4 md:w-3.5 md:h-3.5 shrink-0" /> 
            : <FolderIcon className="w-4 h-4 md:w-3.5 md:h-3.5 shrink-0" />
          }
          <span className="ml-1 select-none truncate">{folder.name}</span>
        </div>
        
        {/* Action Icons - Absolute Positioned */}
        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-inherit">
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onRenameFolder(folder.id);
                }}
                onMouseDown={(e) => e.stopPropagation()}
                className="p-1 md:p-0.5 hover:text-slate-800 dark:hover:text-white"
                title="Rename Folder"
            >
                <Edit2 size={14} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCreateFolder(folder.id);
                // Expand to show new subfolder
                if (!isExpanded) onToggleExpand(folder.id);
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className="p-1 md:p-0.5 hover:text-slate-800 dark:hover:text-white"
              title="New Subfolder"
            >
               <Plus size={14} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDeleteFolder(folder.id);
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className="p-1 md:p-0.5 hover:text-red-500 dark:hover:text-red-400"
              title="Move to Trash"
            >
               <Trash2 size={14} />
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
             <div className="text-xs md:text-[10px] text-slate-400 dark:text-slate-600 px-4 py-0.5 italic pointer-events-none">Empty</div>
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
  onToggleFolderExpand,
  onRestoreNote,
  onRestoreFolder,
  onPermanentDeleteNote,
  onPermanentDeleteFolder,
  onTitleClick
}) => {
  const [search, setSearch] = React.useState('');
  const [trashOpen, setTrashOpen] = React.useState(false);

  // Split Active and Trashed
  const activeNotes = notes.filter(n => !n.deletedAt);
  const trashedNotes = notes.filter(n => n.deletedAt);
  const activeFolders = folders.filter(f => !f.deletedAt);
  const trashedFolders = folders.filter(f => f.deletedAt);

  // Filter Logic handling 'is:published' command
  const isPublishedFilter = search.includes('is:published');
  const cleanSearch = search.replace('is:published', '').trim();

  const filteredNotes = activeNotes.filter((n) => {
      // 1. Filter by published if command is present
      if (isPublishedFilter && !n.isPublished) return false;

      // 2. Standard Search
      if (!cleanSearch) return true;
      return (
        n.title.toLowerCase().includes(cleanSearch.toLowerCase()) ||
        n.content.toLowerCase().includes(cleanSearch.toLowerCase())
      );
  });

  const bookmarkedNotes = filteredNotes
    .filter((n) => n.isBookmarked)
    .sort((a, b) => (a.bookmarkOrder || 0) - (b.bookmarkOrder || 0));
  
  // Force search mode if typing text OR using the filter command
  const isSearching = search.length > 0;

  const rootFolders = activeFolders.filter(f => f.parentId === null);
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
      <div 
        className={`fixed inset-0 bg-black/50 z-40 md:hidden backdrop-blur-sm transition-opacity duration-300 ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onCloseMobile}
      />

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
                <h1 
                    onClick={onTitleClick}
                    className="font-bold text-xl md:text-lg text-slate-800 dark:text-slate-200 tracking-tight cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors select-none"
                    title="Go to All Notes (Grid View)"
                >
                    Rhizonote
                </h1>
                <div className="flex items-center gap-1">
                <button
                    onClick={onOpenSettings}
                    className="p-2 md:p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-slate-700 rounded transition-colors"
                    title="Settings"
                >
                    <Settings size={18} className="md:w-4 md:h-4" />
                </button>
                <div className="w-px h-4 bg-gray-300 dark:bg-slate-700 mx-1"></div>
                <button
                    onClick={() => onCreateFolder(null)}
                    className="p-2 md:p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-slate-700 rounded transition-colors"
                    title="New Root Folder"
                >
                    <FolderIcon size={18} className="md:w-4 md:h-4" />
                </button>
                <button
                    onClick={onCreateNote}
                    className="p-2 md:p-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-500 transition-colors shadow-sm"
                    title="New Note"
                >
                    <Plus size={18} className="md:w-4 md:h-4" />
                </button>
                </div>
            </div>
            <div className="relative">
                <Search size={16} className="absolute left-3 top-3 md:top-2.5 text-slate-500 dark:text-slate-500 md:w-[14px] md:h-[14px]" />
                <input
                    type="text"
                    placeholder="Search..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 text-base md:text-sm rounded pl-10 md:pl-9 pr-10 md:pr-9 py-2 border border-gray-300 dark:border-slate-800 focus:border-indigo-500 focus:outline-none placeholder-slate-400 dark:placeholder-slate-600"
                />
                {search.length > 0 && (
                    <button
                        onClick={() => setSearch('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 rounded-full hover:bg-gray-200 dark:hover:bg-slate-800 transition-colors"
                        title="Clear search"
                        aria-label="Clear search"
                    >
                        <X size={16} className="md:w-[14px] md:h-[14px]" />
                    </button>
                )}
            </div>
            </div>

            {bookmarkedNotes.length > 0 && !isSearching && (
              <div className="shrink-0 max-h-[30vh] overflow-y-auto border-b border-gray-200 dark:border-slate-800 p-2">
                <div className="px-3 py-1 text-xs md:text-[10px] font-semibold text-slate-500 dark:text-slate-600 uppercase tracking-wider mb-1 flex items-center gap-1 sticky top-0 bg-gray-50 dark:bg-slate-900 z-10">
                    <Bookmark size={12} className="md:w-[10px] md:h-[10px]" /> Bookmarks
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

            <div 
            className="flex-1 overflow-y-auto p-2" 
            onDragOver={(e) => e.preventDefault()} 
            onDrop={handleRootDrop}
            >

            {isSearching ? (
                /* Flat list for search results */
                <div>
                    <div className="px-3 py-1 text-xs md:text-[10px] font-semibold text-slate-500 dark:text-slate-600 uppercase tracking-wider mb-1">
                    {cleanSearch ? 'Search Results' : 'Filtered Notes'}
                    </div>
                    {filteredNotes.length === 0 && <div className="px-3 text-sm md:text-sm text-slate-500 dark:text-slate-500">No results found</div>}
                    {filteredNotes.map(note => (
                        <NoteItem
                            key={note.id}
                            note={note}
                            activeNoteId={activeNoteId}
                            onSelect={(id) => onSelectNote(id, cleanSearch)}
                            onToggleBookmark={onToggleBookmark}
                            onDelete={onDeleteNote}
                            searchSnippet={getSearchSnippet(note.content, cleanSearch)}
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
                            allFolders={activeFolders} // Pass only active folders
                            allNotes={activeNotes} // Pass only active notes
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

                    {filteredNotes.length === 0 && activeFolders.length === 0 && (
                    <div className="px-3 py-4 text-center text-slate-500 dark:text-slate-600 text-sm">No notes found</div>
                    )}
                </div>
            )}
            </div>
            
            {/* Trash Section (Fixed at Bottom) */}
            {(trashedNotes.length > 0 || trashedFolders.length > 0) && (
                <div className="shrink-0 border-t border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-900/50">
                    <div 
                        className="flex items-center gap-2 px-4 py-3 md:py-2.5 cursor-pointer text-slate-500 hover:text-slate-800 dark:hover:text-slate-300 transition-colors"
                        onClick={() => setTrashOpen(!trashOpen)}
                    >
                        <Trash2 size={14} className="md:w-[14px] md:h-[14px]" />
                        <span className="text-xs md:text-[10px] font-semibold uppercase tracking-wider flex-1">Trash ({trashedNotes.length + trashedFolders.length})</span>
                        {trashOpen ? <ChevronDown size={14} className="md:w-[14px] md:h-[14px]" /> : <ChevronRight size={14} className="md:w-[14px] md:h-[14px]" />}
                    </div>
                    
                    {trashOpen && (
                        <div className="max-h-60 overflow-y-auto border-t border-gray-200 dark:border-slate-800 bg-gray-100/50 dark:bg-slate-950/50 p-2 shadow-inner">
                             <div className="mb-2 text-xs md:text-[10px] text-slate-400 px-2 italic text-center">Items are deleted after 30 days</div>
                            {trashedFolders.map(folder => (
                                <div key={folder.id} className="group relative flex items-center px-2 py-2 md:py-1.5 text-slate-500 dark:text-slate-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded mb-0.5">
                                    <div className="flex items-center gap-2 truncate w-full">
                                        <FolderIcon size={14} className="md:w-[12px] md:h-[12px]" />
                                        <span className="text-sm md:text-xs line-through truncate">{folder.name}</span>
                                    </div>
                                    <div className="absolute right-1 top-1/2 -translate-y-1/2 flex gap-1 opacity-0 group-hover:opacity-100 bg-inherit">
                                        <button onClick={() => onRestoreFolder(folder.id)} title="Restore" className="p-0.5 hover:text-green-600"><RotateCcw size={14} className="md:w-[11px] md:h-[11px]"/></button>
                                        <button onClick={() => onPermanentDeleteFolder(folder.id)} title="Delete Forever" className="p-0.5 hover:text-red-600"><AlertTriangle size={14} className="md:w-[11px] md:h-[11px]"/></button>
                                    </div>
                                </div>
                            ))}
                            {trashedNotes.map(note => (
                                <NoteItem
                                    key={note.id}
                                    note={note}
                                    activeNoteId={null}
                                    onSelect={() => {}}
                                    onToggleBookmark={() => {}}
                                    onDelete={() => {}}
                                    isTrash={true}
                                    onRestore={onRestoreNote}
                                    onPermanentDelete={onPermanentDeleteNote}
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
      </div>
    </>
  );
};

export default Sidebar;