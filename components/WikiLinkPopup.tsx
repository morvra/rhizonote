import React, { useEffect, useState } from 'react';
import { Note } from '../types';

interface WikiLinkPopupProps {
  query: string;
  notes: Note[];
  onSelect: (noteTitle: string) => void;
  position: { top?: number; bottom?: number; left: number };
  onClose: () => void;
}

const WikiLinkPopup: React.FC<WikiLinkPopupProps> = ({ query, notes, onSelect, position, onClose }) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Filter and limit to top 4 results
  const filteredNotes = notes
    .filter((note) => note.title.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 4);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (filteredNotes.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev: number) => (prev + 1) % filteredNotes.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev: number) => (prev - 1 + filteredNotes.length) % filteredNotes.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        onSelect(filteredNotes[selectedIndex].title);
      } else if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredNotes, selectedIndex, onSelect, onClose]);

  if (filteredNotes.length === 0) {
    return null;
  }

  return (
    <div
      className="fixed z-50 w-64 bg-slate-800 border border-slate-600 rounded-lg shadow-xl overflow-hidden"
      style={{ 
        top: position.top, 
        bottom: position.bottom,
        left: position.left 
      }}
    >
      <div className="text-xs text-slate-400 px-3 py-1 bg-slate-900 border-b border-slate-700">
        Link to...
      </div>
      <ul className="max-h-36 overflow-y-auto">
        {filteredNotes.map((note, index) => (
          <li
            key={note.id}
            className={`px-3 py-2 text-sm cursor-pointer flex items-center gap-2 ${
              index === selectedIndex ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-700'
            }`}
            onClick={() => onSelect(note.title)}
          >
            <span className="w-2 h-2 rounded-full bg-slate-500 opacity-50"></span>
            {note.title}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default WikiLinkPopup;