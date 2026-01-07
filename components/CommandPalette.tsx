import React, { useState, useEffect, useRef } from 'react';
import { Search, Command, ArrowRight, CornerDownLeft } from 'lucide-react';

export interface CommandItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  action: () => void;
  group?: string;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  commands: CommandItem[];
}

const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose, commands }) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      // Focus input after a brief delay to ensure render
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Filter commands based on query
  const filteredCommands = commands.filter(cmd => 
    cmd.label.toLowerCase().includes(query.toLowerCase()) ||
    (cmd.group && cmd.group.toLowerCase().includes(query.toLowerCase()))
  );

  // Group commands for display
  const groupedCommands: { [key: string]: CommandItem[] } = {};
  filteredCommands.forEach(cmd => {
    const group = cmd.group || 'Actions';
    if (!groupedCommands[group]) groupedCommands[group] = [];
    groupedCommands[group].push(cmd);
  });

  // Define group order priority
  const groupOrder = ['Bookmarks', 'Actions', 'View', 'System'];

  // Sort groups based on priority, then alphabetical
  const sortedGroupKeys = Object.keys(groupedCommands).sort((a, b) => {
      const idxA = groupOrder.indexOf(a);
      const idxB = groupOrder.indexOf(b);
      
      // Both in priority list
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      // Only A in priority list
      if (idxA !== -1) return -1;
      // Only B in priority list
      if (idxB !== -1) return 1;
      // Neither (alphabetical)
      return a.localeCompare(b);
  });

  // Flatten based on sorted keys to match visual order for keyboard navigation
  const flatList = sortedGroupKeys.flatMap(group => groupedCommands[group]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % flatList.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + flatList.length) % flatList.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (flatList[selectedIndex]) {
          flatList[selectedIndex].action();
          onClose();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, flatList, selectedIndex, onClose]);

  // Scroll active item into view
  useEffect(() => {
    if (listRef.current) {
        const activeItem = listRef.current.querySelector(`[data-index="${selectedIndex}"]`);
        if (activeItem) {
            activeItem.scrollIntoView({ block: 'nearest' });
        }
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[20vh] px-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-gray-200 dark:border-slate-700 overflow-hidden flex flex-col max-h-[60vh] animate-in fade-in zoom-in-95 duration-100">
        <div className="flex items-center px-4 py-3 border-b border-gray-200 dark:border-slate-800 shrink-0">
          <Search className="w-5 h-5 text-slate-400 mr-3" />
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent text-lg text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none"
            placeholder="Type a command..."
            value={query}
            onChange={(e) => {
                setQuery(e.target.value);
                setSelectedIndex(0);
            }}
          />
          <div className="hidden md:flex items-center gap-1">
             <kbd className="px-2 py-0.5 bg-gray-100 dark:bg-slate-800 rounded border border-gray-200 dark:border-slate-700 text-xs font-mono text-slate-500">Esc</kbd>
          </div>
        </div>

        <ul ref={listRef} className="flex-1 overflow-y-auto py-2 scroll-p-2">
            {flatList.length === 0 ? (
                <div className="px-4 py-8 text-center text-slate-500">
                    No commands found matching "{query}"
                </div>
            ) : (
                sortedGroupKeys.map((group) => {
                    const groupCommands = groupedCommands[group];
                    return (
                        <React.Fragment key={group}>
                             <div className="px-4 py-1 text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                                {group}
                            </div>
                            {groupCommands.map(cmd => {
                                // Find the index in the flat list to handle selection correctly
                                const globalIndex = flatList.indexOf(cmd);
                                const isSelected = globalIndex === selectedIndex;
                                
                                return (
                                    <li
                                        key={cmd.id}
                                        data-index={globalIndex}
                                        className={`mx-2 px-3 py-3 rounded-lg flex items-center justify-between cursor-pointer transition-colors scroll-m-2 ${
                                            isSelected 
                                                ? 'bg-indigo-600 text-white' 
                                                : 'text-slate-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800'
                                        }`}
                                        onClick={() => {
                                            cmd.action();
                                            onClose();
                                        }}
                                        onMouseEnter={() => setSelectedIndex(globalIndex)}
                                    >
                                        <div className="flex items-center gap-3 overflow-hidden">
                                            {cmd.icon ? (
                                                <span className={`${isSelected ? 'text-indigo-200' : 'text-slate-400'}`}>
                                                    {cmd.icon}
                                                </span>
                                            ) : (
                                                <Command className={`w-4 h-4 ${isSelected ? 'text-indigo-200' : 'text-slate-400'}`} />
                                            )}
                                            <span className="truncate font-medium">{cmd.label}</span>
                                        </div>
                                        <div className="flex items-center gap-3 pl-4 shrink-0">
                                            {cmd.shortcut && (
                                                <span className={`text-xs ${isSelected ? 'text-indigo-200' : 'text-slate-500'}`}>
                                                    {cmd.shortcut}
                                                </span>
                                            )}
                                            {isSelected && <CornerDownLeft className="w-4 h-4 text-indigo-200" />}
                                        </div>
                                    </li>
                                );
                            })}
                        </React.Fragment>
                    );
                })
            )}
        </ul>
        
        <div className="bg-gray-50 dark:bg-slate-950 px-4 py-2 border-t border-gray-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 shrink-0">
             <span>
                <span className="font-semibold">{flatList.length}</span> commands
             </span>
             <div className="flex gap-4">
                 <span className="flex items-center gap-1"><ArrowRight className="w-3 h-3 rotate-[-90deg]"/> <ArrowRight className="w-3 h-3 rotate-90deg"/> Navigate</span>
                 <span className="flex items-center gap-1"><CornerDownLeft className="w-3 h-3"/> Select</span>
             </div>
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;