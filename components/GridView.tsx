import React, { useState, useMemo } from 'react';
import { Note } from '../types';
import { Search, X } from 'lucide-react';

interface GridViewProps {
  notes: Note[];
  onSelectNote: (id: string) => void;
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

  const filteredNotes = useMemo(() => {
    // Sort by updated descending by default for grid view
    const activeNotes = notes.filter(n => !n.deletedAt).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    
    if (!search) return activeNotes;
    
    const lowerQuery = search.toLowerCase();
    return activeNotes.filter(n => 
        (n.title || '').toLowerCase().includes(lowerQuery) || 
        (n.content || '').toLowerCase().includes(lowerQuery)
    );
  }, [notes, search]);

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-slate-950">
        <div className="p-4 border-b border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-10 shrink-0">
            <div className="relative max-w-2xl mx-auto">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                <input
                    type="text"
                    placeholder="Search notes..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-10 pr-10 py-2 bg-gray-100 dark:bg-slate-800 border-none rounded-lg focus:ring-2 focus:ring-indigo-500 text-slate-800 dark:text-slate-200 placeholder-slate-400"
                />
                {search && (
                    <button 
                        onClick={() => setSearch('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    >
                        <X size={16} />
                    </button>
                )}
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
                            onClick={() => onSelectNote(note.id)}
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