
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Note } from '../types';
import { Search, FileText, Calendar, Clock, ArrowDownAz } from 'lucide-react';

interface GridViewProps {
  notes: Note[];
  onSelectNote: (id: string) => void;
}

// Helper to extract the first image URL from markdown content
const getThumbnail = (content: string): string | null => {
  const match = content.match(/!\[.*?\]\((.*?)\)/);
  return match ? match[1] : null;
};

// Helper to strip markdown for preview
const getSnippet = (content: string): string => {
  return content
    .replace(/!\[.*?\]\(.*?\)/g, '') // Remove images
    .replace(/\[\[(.*?)\]\]/g, '$1') // Clean wiki links
    .replace(/[#*`~>]/g, '') // Remove simple markdown chars
    .replace(/\n/g, ' ') // Replace newlines with spaces
    .trim()
    .slice(0, 300); // Increased limit for text-only cards
};

const GridView: React.FC<GridViewProps> = ({ notes, onSelectNote }) => {
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<'updated' | 'created' | 'title'>('updated');
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const filteredNotes = useMemo(() => {
    let result = notes.filter(n => !n.deletedAt);
    
    if (search.trim()) {
      const lowerQuery = search.toLowerCase();
      result = result.filter(n => 
        n.title.toLowerCase().includes(lowerQuery) || 
        n.content.toLowerCase().includes(lowerQuery)
      );
    }

    return result.sort((a, b) => {
      if (sortField === 'title') {
        return a.title.localeCompare(b.title);
      }
      const valA = sortField === 'updated' ? a.updatedAt : a.createdAt;
      const valB = sortField === 'updated' ? b.updatedAt : b.createdAt;
      return valB - valA; // Descending
    });
  }, [notes, search, sortField]);

  // Listen for the global scroll-top event from App.tsx toolbar
  useEffect(() => {
    const handleScrollTop = () => {
        if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    window.addEventListener('rhizonote-scroll-top', handleScrollTop);
    return () => window.removeEventListener('rhizonote-scroll-top', handleScrollTop);
  }, []);

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-slate-950 overflow-hidden">
      {/* Grid Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0 z-10">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
            <span className="bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 p-1.5 rounded-lg">
                <FileText size={20} />
            </span>
            All Notes
            <span className="text-sm font-normal text-slate-400 ml-2">({filteredNotes.length})</span>
          </h2>

          <div className="flex items-center gap-3">
             {/* Search */}
            <div className="relative group">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                <input
                    type="text"
                    placeholder="Filter cards..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9 pr-4 py-1.5 w-full md:w-64 bg-gray-100 dark:bg-slate-800 border-none rounded-full text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none transition-all"
                />
            </div>

            {/* Sort Toggles */}
            <div className="flex bg-gray-100 dark:bg-slate-800 rounded-lg p-1">
                <button
                    onClick={() => setSortField('updated')}
                    className={`p-1.5 rounded-md transition-all ${sortField === 'updated' ? 'bg-white dark:bg-slate-700 shadow text-indigo-600 dark:text-indigo-400' : 'text-slate-400 hover:text-slate-600'}`}
                    title="Sort by Updated"
                >
                    <Clock size={16} />
                </button>
                <button
                    onClick={() => setSortField('created')}
                    className={`p-1.5 rounded-md transition-all ${sortField === 'created' ? 'bg-white dark:bg-slate-700 shadow text-indigo-600 dark:text-indigo-400' : 'text-slate-400 hover:text-slate-600'}`}
                    title="Sort by Created"
                >
                    <Calendar size={16} />
                </button>
                <button
                    onClick={() => setSortField('title')}
                    className={`p-1.5 rounded-md transition-all ${sortField === 'title' ? 'bg-white dark:bg-slate-700 shadow text-indigo-600 dark:text-indigo-400' : 'text-slate-400 hover:text-slate-600'}`}
                    title="Sort by Title"
                >
                    <ArrowDownAz size={16} />
                </button>
            </div>
          </div>
        </div>
      </div>

      {/* Cards Area */}
      <div 
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto p-4 md:p-6"
      >
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-6 auto-rows-max">
            {filteredNotes.map(note => {
                const thumbnail = getThumbnail(note.content);
                const snippet = getSnippet(note.content);
                
                return (
                    <div 
                        key={note.id}
                        onClick={() => onSelectNote(note.id)}
                        className="group bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl overflow-hidden cursor-pointer hover:shadow-lg hover:border-indigo-300 dark:hover:border-indigo-700 transition-all duration-200 flex flex-col h-[160px]"
                    >
                        {thumbnail && (
                             <div className="h-20 w-full bg-gray-100 dark:bg-slate-950 shrink-0 relative overflow-hidden">
                                <img 
                                    src={thumbnail} 
                                    alt="thumbnail" 
                                    className="w-full h-full object-cover opacity-90 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500"
                                    loading="lazy"
                                />
                             </div>
                        )}
                        
                        <div className="p-3 flex flex-col flex-1 min-h-0">
                            <h3 className="font-bold text-slate-800 dark:text-slate-200 text-sm mb-1 line-clamp-2 leading-tight group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
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
            <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                <Search size={48} className="mb-4 opacity-20" />
                <p>No notes found.</p>
            </div>
        )}
      </div>
    </div>
  );
};

export default GridView;
