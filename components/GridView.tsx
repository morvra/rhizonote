import React, { useState, useMemo } from 'react';
import { Note, SortField, SortDirection } from '../types';
import { Search, X, Clock, Calendar, ArrowDownAz, ArrowUp, ArrowDown, Globe } from 'lucide-react';

interface GridViewProps {
  notes: Note[];
  onSelectNote: (id: string, query?: string) => void;
}

const getThumbnail = (content: string): string | null => {
  if (!content) return null;
  const match = content.match(/!\[.*?\]\((.*?)\)/);
  return match ? match[1] : null;
};

const getSnippet = (content: string): string => {
  if (!content) return '';
  return content
    .replace(/!\[.*?\]\(.*?\)/g, '') // Remove images
    .replace(/\[\[(.*?)\]\]/g, '$1') // Clean wiki links
    .replace(/#{1,6}\s/g, '') // Remove headers
    .replace(/(\*\*|__)(.*?)\1/g, '$2') // Remove bold
    .replace(/(\*|_)(.*?)\1/g, '$2') // Remove italic
    .replace(/`([^`]+)`/g, '$1') // Remove code
    .replace(/\n+/g, ' ') // Flatten newlines
    .trim()
    .slice(0, 150);
};

const GridView: React.FC<GridViewProps> = ({ notes, onSelectNote }) => {
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('updated');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [showPublishedOnly, setShowPublishedOnly] = useState(false);

  const filteredNotes = useMemo(() => {
    // Active notes only
    let activeNotes = notes.filter(n => !n.deletedAt);
    
    // Filter by Published status
    if (showPublishedOnly) {
        activeNotes = activeNotes.filter(n => n.isPublished);
    }

    // Filter
    if (search) {
        const lowerQuery = search.toLowerCase();
        activeNotes = activeNotes.filter(n => 
            (n.title || '').toLowerCase().includes(lowerQuery) || 
            (n.content || '').toLowerCase().includes(lowerQuery)
        );
    }

    // Sort
    return activeNotes.sort((a, b) => {
        let result = 0;
        if (sortField === 'updated') {
            result = (a.updatedAt || 0) - (b.updatedAt || 0);
        } else if (sortField === 'created') {
             result = (a.createdAt || 0) - (b.createdAt || 0);
        } else if (sortField === 'name') {
            result = (a.title || '').localeCompare(b.title || '');
        }
        
        return sortDirection === 'asc' ? result : -result;
    });
  }, [notes, search, sortField, sortDirection, showPublishedOnly]);

  const SortButton = ({ field, icon: Icon, label }: { field: SortField, icon: any, label: string }) => (
      <button
          onClick={() => {
              if (sortField === field) {
                  setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
              } else {
                  setSortField(field);
                  setSortDirection(field === 'name' ? 'asc' : 'desc');
              }
          }}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              sortField === field 
                  ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300' 
                  : 'text-slate-500 hover:bg-gray-100 dark:hover:bg-slate-800 dark:text-slate-400'
          }`}
          title={`Sort by ${label}`}
      >
          <Icon size={14} />
          <span className="hidden sm:inline">{label}</span>
          {sortField === field && (
              sortDirection === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
          )}
      </button>
  );

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-slate-950">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-10 shrink-0">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 max-w-7xl mx-auto">
                 {/* Title & Count */}
                 <div className="flex items-center gap-3 shrink-0">
                    <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200">All Notes</h2>
                    <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400">
                        {filteredNotes.length}
                    </span>
                 </div>

                 {/* Controls Group: Search & Sort */}
                 <div className="flex items-center gap-3 flex-1 md:justify-end w-full md:w-auto">
                    {/* Search */}
                    <div className="relative flex-1 md:max-w-sm">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                        <input
                            type="text"
                            placeholder="Search notes..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full pl-9 pr-9 py-1.5 bg-gray-100 dark:bg-slate-800 border-none rounded-md focus:ring-2 focus:ring-indigo-500 text-slate-800 dark:text-slate-200 placeholder-slate-400 text-sm"
                        />
                        {search && (
                            <button 
                                onClick={() => setSearch('')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>

                    {/* Published Filter Toggle */}
                    <button
                        onClick={() => setShowPublishedOnly(!showPublishedOnly)}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors border ${
                            showPublishedOnly
                                ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800'
                                : 'bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-800 text-slate-500 hover:bg-gray-50 dark:hover:bg-slate-800 dark:text-slate-400'
                        }`}
                        title={showPublishedOnly ? "Show All Notes" : "Show Published Only"}
                    >
                        <Globe size={14} />
                        <span className="hidden sm:inline">Published</span>
                    </button>

                    {/* Sort Controls */}
                    <div className="flex items-center gap-1 bg-gray-50 dark:bg-slate-950 p-1 rounded-lg border border-gray-200 dark:border-slate-800 shrink-0">
                        <SortButton field="updated" icon={Clock} label="Updated" />
                        <SortButton field="created" icon={Calendar} label="Created" />
                        <SortButton field="name" icon={ArrowDownAz} label="Name" />
                    </div>
                 </div>
            </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 max-w-7xl mx-auto">
                {filteredNotes.map(note => {
                    const thumbnail = getThumbnail(note.content);
                    const snippet = getSnippet(note.content);
                    
                    return (
                        <div 
                            key={note.id}
                            onClick={() => onSelectNote(note.id, search)}
                            className="group bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl overflow-hidden cursor-pointer hover:shadow-lg hover:border-indigo-300 dark:hover:border-indigo-700 transition-all duration-200 flex flex-col h-[200px]"
                        >
                            {thumbnail ? (
                                 <div className="h-20 w-full bg-gray-100 dark:bg-slate-950 shrink-0 relative overflow-hidden">
                                    <img 
                                        src={thumbnail} 
                                        alt="thumbnail" 
                                        className="w-full h-full object-cover opacity-90 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500"
                                        loading="lazy"
                                        onError={(e) => {
                                            (e.target as HTMLImageElement).style.display = 'none';
                                            (e.target as HTMLImageElement).parentElement?.classList.add('hidden');
                                        }}
                                    />
                                 </div>
                            ) : null}
                            
                            <div className="p-3 flex flex-col flex-1 min-h-0">
                                <h3 className="font-bold text-slate-800 dark:text-slate-200 text-sm mb-2 line-clamp-2 leading-normal group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors break-words">
                                    {note.title || 'Untitled'}
                                </h3>
                                <p className={`text-xs text-slate-500 dark:text-slate-400 leading-relaxed break-words ${thumbnail ? 'line-clamp-2' : 'line-clamp-6'}`}>
                                    {snippet || <span className="italic opacity-50">No content</span>}
                                </p>
                            </div>
                        </div>
                    );
                })}
            </div>
            {filteredNotes.length === 0 && (
                <div className="text-center text-slate-500 dark:text-slate-400 mt-20">
                    No notes found matching "{search}"
                </div>
            )}
        </div>
    </div>
  );
};

export default GridView;