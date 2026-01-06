import React, { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { Note } from '../types';
import WikiLinkPopup from './WikiLinkPopup';
import { Edit3, Eye, RefreshCw, Bold, Italic, Strikethrough, Code, Link as LinkIcon, FilePlus } from 'lucide-react';

interface EditorProps {
  note: Note;
  allNotes: Note[];
  onUpdate: (id: string, updates: Partial<Note>) => void;
  onLinkClick: (title: string) => void;
  onRefactorLinks: (oldTitle: string, newTitle: string) => void;
  onCreateNoteWithContent?: (title: string, content: string) => void;
  fontSize: number;
}

// Helper to extract [[links]] from content, ignoring code blocks
const extractLinks = (content: string): string[] => {
    // Regex explanation:
    // 1. (?:```[\s\S]*?```) matches code blocks (non-capturing group)
    // 2. (?:`[^`]*`) matches inline code (non-capturing group)
    // 3. \[\[(.*?)\]\] matches wiki links and captures the content
    const regex = /(?:```[\s\S]*?```|`[^`]*`)|\[\[(.*?)\]\]/g;
    const links: string[] = [];
    let match;
    while ((match = regex.exec(content)) !== null) {
        // If match[1] exists, it's a link. If undefined, it was a code block that matched.
        if (match[1]) {
            links.push(match[1]);
        }
    }
    return links;
};

interface NoteCardProps {
  note: Note;
  onLinkClick: (t: string) => void;
  currentNoteTitle: string;
}

const NoteCard: React.FC<NoteCardProps> = ({ note, onLinkClick, currentNoteTitle }) => {
    // For Ghost notes, we might want to show all backlinks even if it includes the current note, 
    // to clearly show "Referenced by X, Y, Z". 
    // However, the standard behavior is to exclude current. 
    // Let's keep excluding current to avoid redundancy, but rely on the text description for the full context if needed.
    // Actually, for Ghost notes, the "content" is generated specifically to list references.
    const linksInNote = useMemo(() => extractLinks(note.content).filter(l => l !== currentNoteTitle), [note.content, currentNoteTitle]);

    return (
        <div 
            className={`
                bg-white dark:bg-slate-900 border rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow cursor-pointer flex flex-col min-h-40
                ${note.isGhost 
                    ? 'border-dashed border-slate-300 dark:border-slate-700 opacity-90' 
                    : 'border-gray-200 dark:border-slate-800'}
            `}
            onClick={() => onLinkClick(note.title)}
        >
            <h3 className={`font-bold mb-2 truncate ${note.isGhost ? 'text-slate-600 dark:text-slate-400 italic' : 'text-slate-800 dark:text-slate-200'}`}>
                {note.title}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-3 mb-auto whitespace-pre-wrap">
                {note.content.replace(/#/g, '').replace(/\[\[/g, '').replace(/\]\]/g, '')}
            </p>
            {/* Show links/tags for both normal and ghost notes if available */}
            {linksInNote.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1 shrink-0">
                    {linksInNote.map((link, i) => (
                        <button 
                            key={i} 
                            onClick={(e) => {
                                e.stopPropagation();
                                onLinkClick(link);
                            }}
                            className="text-[10px] bg-gray-100 dark:bg-slate-800 hover:bg-indigo-100 dark:hover:bg-indigo-900 text-indigo-500 px-1.5 py-0.5 rounded truncate max-w-[150px] transition-colors"
                        >
                            {link}
                        </button>
                    ))}
                </div>
            )}
            {note.isGhost && linksInNote.length === 0 && (
                <div className="mt-3 text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                    Missing Note
                </div>
            )}
        </div>
    );
};

const Editor: React.FC<EditorProps> = ({ note, allNotes, onUpdate, onLinkClick, onRefactorLinks, onCreateNoteWithContent, fontSize }) => {
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  
  // Track where the cursor *was* before the current interaction
  const prevSelectionRef = useRef<number>(0);

  // Track current cursor line to styling
  const [currentLineIndex, setCurrentLineIndex] = useState<number>(0);
  
  // Ref to store cursor position that needs to be restored after a render
  const pendingCursorRef = useRef<number | null>(null);
  
  // Autocomplete state
  const [showPopup, setShowPopup] = useState(false);
  const [popupQuery, setPopupQuery] = useState('');
  const [popupPos, setPopupPos] = useState<{ top?: number; bottom?: number; left: number }>({ top: 0, left: 0 });
  const [cursorIndex, setCursorIndex] = useState(0);

  // Selection Menu State
  const [selectionMenu, setSelectionMenu] = useState<{
    top: number;
    left: number;
    text: string;
    start: number;
    end: number;
  } | null>(null);

  // Rename & Refactor State
  const [originalTitle, setOriginalTitle] = useState(note.title);

  // Track previous note ID to reset state immediately when note changes
  const prevNoteIdRef = useRef(note.id);
  if (prevNoteIdRef.current !== note.id) {
      prevNoteIdRef.current = note.id;
      setOriginalTitle(note.title);
  }

  const linkedNotesCount = useMemo(() => {
    if (!originalTitle || originalTitle === note.title) return 0;
    const escapedTitle = originalTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\[\\[${escapedTitle}\\]\\]`);
    return allNotes.filter(n => n.id !== note.id && n.content.match(regex)).length;
  }, [note.title, originalTitle, allNotes, note.id]);

  // Calculate Related Notes (Cosense-like)
  const relatedNotes = useMemo(() => {
      // 1. Outgoing links (Forward)
      const outgoingLinks = extractLinks(note.content);
      
      // Existing Notes linked from here
      const existingOutgoing = allNotes.filter(n => outgoingLinks.includes(n.title) && n.id !== note.id);
      
      // Ghost Notes (Missing Links) linked from here
      const missingLinks = outgoingLinks.filter(link => !allNotes.some(n => n.title === link));
      
      const ghostNotes: Note[] = missingLinks.map(link => {
          // Find backlinks to this missing note
          const linkedFrom = allNotes.filter(n => extractLinks(n.content).includes(link));
          
          return {
              id: `ghost-${link}`,
              folderId: null,
              title: link,
              // Show context: "Linked from: [[A]], [[B]]"
              content: `Missing Note (Ghost).\n\nReferenced by:\n${linkedFrom.map(n => `- [[${n.title}]]`).join('\n')}`,
              isBookmarked: false,
              updatedAt: Date.now(),
              createdAt: Date.now(),
              isGhost: true
          } as Note;
      });

      // 2. Incoming links (Backlinks)
      const backlinkNotes = allNotes.filter(n => {
          if (n.id === note.id) return false;
          const links = extractLinks(n.content);
          return links.includes(note.title);
      });

      // Combine and deduplicate
      const combined = [...existingOutgoing, ...ghostNotes];
      backlinkNotes.forEach(bn => {
          if (!combined.find(n => n.id === bn.id)) {
              combined.push(bn);
          }
      });
      
      return combined;
  }, [note.content, note.title, allNotes, note.id]);

  // Reset scroll and cursor when note changes (Requirement: Link navigation resets view)
  useEffect(() => {
      // Scroll the main container to top
      if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = 0;
      }

      if (textareaRef.current) {
          textareaRef.current.scrollTop = 0;
          textareaRef.current.setSelectionRange(0, 0);
          
          // Reset internal tracking
          prevSelectionRef.current = 0;
          setCurrentLineIndex(0);
      }
      if (backdropRef.current) {
          // Also reset backdrop scroll if it was scrollable (though it usually mirrors textarea)
          backdropRef.current.scrollTop = 0;
      }
      // Close popup when note changes
      setShowPopup(false);
  }, [note.id]);

  // Focus textarea when switching to edit mode
  useEffect(() => {
    if (mode === 'edit' && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [mode]);

  // Restore cursor position immediately after DOM update to prevent jumping
  useLayoutEffect(() => {
    if (pendingCursorRef.current !== null && textareaRef.current) {
      textareaRef.current.setSelectionRange(pendingCursorRef.current, pendingCursorRef.current);
      // Update line tracking based on the restored cursor position
      const pos = pendingCursorRef.current;
      prevSelectionRef.current = pos;
      const line = note.content.substring(0, pos).split('\n').length - 1;
      setCurrentLineIndex(line);
      
      pendingCursorRef.current = null;
    }
  });

  const updateLineTracking = () => {
      if (textareaRef.current) {
          const pos = textareaRef.current.selectionStart;
          prevSelectionRef.current = pos;
          const line = note.content.substring(0, pos).split('\n').length - 1;
          setCurrentLineIndex(line);
      }
  };

  const getLineNumber = (content: string, index: number) => {
    return content.substring(0, index).split('\n').length;
  };

  // Check if we should show autocomplete
  const checkAutocomplete = (currentCursor: number, text: string) => {
    const textBefore = text.slice(0, currentCursor);
    const lastOpen = textBefore.lastIndexOf('[[');
    const lastClose = textBefore.lastIndexOf(']]');
    
    // Check if we are inside [[ and not closed
    if (lastOpen !== -1 && lastOpen > lastClose) {
        const query = textBefore.slice(lastOpen + 2);
        // Ensure no newlines or backticks inside the query to prevent false positives
        if (!query.includes('\n') && !query.includes('`')) {
            setPopupQuery(query);
            setShowPopup(true);
            
            // Calculate accurate position
            const coords = measureSelection(lastOpen, lastOpen + 2);
            if (coords && containerRef.current) {
                 const containerRect = containerRef.current.getBoundingClientRect();
                 const lineHeight = 24; // Approx line height (can vary based on styling)
                 
                 // Standard position: Just below the text line
                 const topPos = containerRect.top + coords.top + lineHeight; 
                 const left = containerRect.left + coords.left;
                 
                 // Boundary check
                 // Reduced est height due to max-h-36 (144px) + header (~30px) + padding = ~180px
                 const POPUP_EST_HEIGHT = 180; 
                 const viewportHeight = window.innerHeight;

                 if (topPos + POPUP_EST_HEIGHT > viewportHeight) {
                    // Not enough space below, flip to above the line.
                    // Use 'bottom' positioning to ensure it sits right on top of the line 
                    // regardless of actual content height.
                    // Anchor to the top of the line (containerRect.top + coords.top)
                    // Added -4 offset to bring it closer to the text
                    const bottom = viewportHeight - (containerRect.top + coords.top) - 4;
                    setPopupPos({ bottom, left });
                 } else {
                    setPopupPos({ top: topPos, left });
                 }
            }
            return;
        }
    }
    setShowPopup(false);
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newVal = e.target.value;
    const newCursorPos = e.target.selectionStart;
    
    onUpdate(note.id, { content: newVal });
    setCursorIndex(newCursorPos);
    
    prevSelectionRef.current = newCursorPos;
    const line = newVal.substring(0, newCursorPos).split('\n').length - 1;
    setCurrentLineIndex(line);
    
    // Hide context menu on typing
    setSelectionMenu(null);

    // Check Autocomplete
    checkAutocomplete(newCursorPos, newVal);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLTextAreaElement>) => {
      if (!textareaRef.current) return;
      textareaRef.current.style.pointerEvents = 'none';
      const el = document.elementFromPoint(e.clientX, e.clientY);
      textareaRef.current.style.pointerEvents = 'auto';
      
      let cursor = 'text';

      if (el) {
        if (el.hasAttribute('data-link-title') || el.hasAttribute('data-url')) {
          const lineIndexStr = el.getAttribute('data-line-index');
          if (lineIndexStr) {
              const lineIndex = parseInt(lineIndexStr, 10);
              if (lineIndex !== currentLineIndex) {
                  cursor = 'pointer';
              }
          }
        }
      }
      
      if (textareaRef.current.style.cursor !== cursor) {
          textareaRef.current.style.cursor = cursor;
      }
  };
  
  // Calculate selection coordinates for centering the toolbar
  const measureSelection = (start: number, end: number) => {
    if (!textareaRef.current) return null;
    const textarea = textareaRef.current;
    
    const div = document.createElement('div');
    const styles = window.getComputedStyle(textarea);
    
    // Explicitly copy all font/text properties
    const props = [
        'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'line-height', 
        'text-transform', 'word-spacing', 'text-indent', 'white-space', 'word-break', 'overflow-wrap',
        'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
        'border-width', 'box-sizing'
    ];
    
    props.forEach(prop => {
        div.style.setProperty(prop, styles.getPropertyValue(prop));
    });
    
    div.style.position = 'fixed';
    div.style.top = '-9999px';
    div.style.left = '-9999px';
    div.style.width = styles.width;
    div.style.height = 'auto';
    div.style.visibility = 'hidden';
    
    const content = textarea.value;
    const before = content.substring(0, start);
    const selected = content.substring(start, end);
    const after = content.substring(end);
    
    div.textContent = before;
    const span = document.createElement('span');
    span.textContent = selected;
    div.appendChild(span);
    div.appendChild(document.createTextNode(after));
    
    document.body.appendChild(div);
    
    const spanRect = span.getBoundingClientRect();
    const divRect = div.getBoundingClientRect();
    
    const relativeTop = spanRect.top - divRect.top;
    const relativeLeft = spanRect.left - divRect.left;
    const width = spanRect.width;
    
    document.body.removeChild(div);
    
    return {
        top: relativeTop,
        left: relativeLeft + (width / 2)
    };
  };

  const updateSelectionMenu = () => {
    if (!textareaRef.current || !containerRef.current) return;
    
    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;

    if (start !== end) {
        const text = note.content.substring(start, end);
        const coords = measureSelection(start, end);
        
        if (coords) {
            setSelectionMenu({
                top: coords.top,
                left: coords.left,
                text,
                start,
                end
            });
        }
    } else {
        setSelectionMenu(null);
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLTextAreaElement>) => {
      // 1. Intercept Link Clicks on the Backdrop
      // We essentially "hit test" the backdrop element to see if we clicked a link.
      // If we did, we prevent default (stopping the cursor move/focus change) and open the link.
      if (textareaRef.current) {
          // Temporarily disable pointer events on textarea to look through it
          textareaRef.current.style.pointerEvents = 'none';
          const el = document.elementFromPoint(e.clientX, e.clientY);
          textareaRef.current.style.pointerEvents = 'auto';

          if (el) {
              const url = el.getAttribute('data-url');
              const wikiLink = el.getAttribute('data-link-title');

              if (url || wikiLink) {
                  e.preventDefault(); // This stops the cursor from moving
                  if (url) window.open(url, '_blank');
                  if (wikiLink) onLinkClick(wikiLink);
                  return;
              }
          }

          // If no link, capture cursor position normally
          prevSelectionRef.current = textareaRef.current.selectionStart;
      }
  };

  const handleMouseUp = () => {
    updateSelectionMenu();
    // Only update visual line index, don't update logical selection history
    // This prevents "click" handler from thinking we've already visited this line
    if (textareaRef.current) {
        const pos = textareaRef.current.selectionStart;
        const line = note.content.substring(0, pos).split('\n').length - 1;
        setCurrentLineIndex(line);
        // Check if we moved out of autocomplete
        checkAutocomplete(pos, note.content);
    }
  };

  const handleWrapText = (wrapper: string) => {
    if (!selectionMenu) return;
    const { start, end, text } = selectionMenu;
    const isWiki = wrapper === '[[';
    
    let prefix = wrapper;
    let suffix = wrapper;
    
    if (isWiki) {
        prefix = '[[';
        suffix = ']]';
    }

    // Logic to toggle? simpler to just apply for now
    const newValue = note.content.substring(0, start) + prefix + text + suffix + note.content.substring(end);
    onUpdate(note.id, { content: newValue });
    setSelectionMenu(null);
    
    // Restore cursor / focus
    if(textareaRef.current) {
        textareaRef.current.focus();
        pendingCursorRef.current = start + prefix.length + text.length + suffix.length;
    }
  };

  const handleExtractNote = () => {
    if (!selectionMenu || !onCreateNoteWithContent) return;
    const { start, end, text } = selectionMenu;
    
    // Split by first newline
    const lines = text.split('\n');
    const title = lines[0].trim();
    // If there is only one line, title is content. If multiple, rest is content.
    // If multiple lines, we want title = line1, content = rest.
    const content = lines.length > 1 ? lines.slice(1).join('\n').trim() : '';

    if (!title) return;

    onCreateNoteWithContent(title, content);

    // Replace selection with link
    const newValue = note.content.substring(0, start) + `[[${title}]]` + note.content.substring(end);
    onUpdate(note.id, { content: newValue });
    setSelectionMenu(null);

    // Restore focus
    if(textareaRef.current) {
        textareaRef.current.focus();
        pendingCursorRef.current = start + title.length + 4; // [[title]] length
    }
  };

  const handleContentClick = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    const target = e.target as HTMLTextAreaElement;
    const currentClickIndex = target.selectionStart;
    const content = note.content;
    const clickedLineNumber = getLineNumber(content, currentClickIndex);

    // PRIORITY 1: CHECKBOX TOGGLE
    const lineStart = content.lastIndexOf('\n', currentClickIndex - 1) + 1;
    let lineEnd = content.indexOf('\n', currentClickIndex);
    if (lineEnd === -1) lineEnd = content.length;
    
    const lineText = content.slice(lineStart, lineEnd);
    const taskRegex = /^(\s*)([-*]|\d+\.)\s+\[([ x])\]/;
    const match = lineText.match(taskRegex);

    if (match) {
        const fullPrefixLen = match[0].length;
        const openBracketPos = lineStart + fullPrefixLen - 3;
        const closeBracketPos = lineStart + fullPrefixLen - 1;

        if (currentClickIndex >= openBracketPos && currentClickIndex <= closeBracketPos + 1) {
            const isChecked = match[3] === 'x';
            const newState = isChecked ? ' ' : 'x';
            const charIndex = lineStart + fullPrefixLen - 2;
            const newContent = content.slice(0, charIndex) + newState + content.slice(charIndex + 1);
            
            pendingCursorRef.current = currentClickIndex;
            onUpdate(note.id, { content: newContent });
            updateLineTracking(); // Update history so subsequent clicks know we are here
            return;
        }
    }

    // PRIORITY 2: LINK NAVIGATION (REMOVED)
    // Handled in handleMouseDown to prevent cursor movement.
    
    updateLineTracking();
    checkAutocomplete(currentClickIndex, content);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Keyboard shortcut for extraction: Cmd+Shift+E
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'e') {
        e.preventDefault();
        const start = e.currentTarget.selectionStart;
        const end = e.currentTarget.selectionEnd;
        if (start !== end) {
            const text = note.content.substring(start, end);
            
            if (!onCreateNoteWithContent) return;
            const lines = text.split('\n');
            const title = lines[0].trim();
            const content = lines.length > 1 ? lines.slice(1).join('\n').trim() : '';
            
            if (title) {
                 onCreateNoteWithContent(title, content);
                 const newValue = note.content.substring(0, start) + `[[${title}]]` + note.content.substring(end);
                 pendingCursorRef.current = start + title.length + 4;
                 onUpdate(note.id, { content: newValue });
                 setSelectionMenu(null); 
            }
        }
        return;
    }
    
    const target = e.currentTarget;

    // Line Moving: Ctrl/Cmd + Arrow Up/Down
    if ((e.metaKey || e.ctrlKey) && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const start = target.selectionStart;
        const value = target.value;
        const lines = value.split('\n');
        
        // Find line index of cursor
        const textBefore = value.substring(0, start);
        const currentLineIndex = textBefore.split('\n').length - 1;

        // Calculate offset from start of line
        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        const offset = start - lineStart;

        if (e.key === 'ArrowUp' && currentLineIndex > 0) {
            // Swap with previous
            const temp = lines[currentLineIndex];
            lines[currentLineIndex] = lines[currentLineIndex - 1];
            lines[currentLineIndex - 1] = temp;
            
            // Reconstruct content
            const newContent = lines.join('\n');
            onUpdate(note.id, { content: newContent });
            
            // Calculate new cursor position
            // The moved line is now at index-1. 
            // We find the start position of that line in the new text.
            const prefix = lines.slice(0, currentLineIndex - 1).join('\n');
            const newStart = prefix.length > 0 ? prefix.length + 1 : 0;
            // Ensure we don't go out of bounds if offset is somehow larger (shouldn't happen with same content)
            pendingCursorRef.current = newStart + offset;
        } 
        else if (e.key === 'ArrowDown' && currentLineIndex < lines.length - 1) {
             // Swap with next
             const temp = lines[currentLineIndex];
             lines[currentLineIndex] = lines[currentLineIndex + 1];
             lines[currentLineIndex + 1] = temp;
             
             const newContent = lines.join('\n');
             onUpdate(note.id, { content: newContent });
             
             // The moved line is now at index+1.
             const prefix = lines.slice(0, currentLineIndex + 1).join('\n');
             const newStart = prefix.length + 1;
             pendingCursorRef.current = newStart + offset;
        }
        return;
    }

    // Indentation: Tab / Shift+Tab
    if (e.key === 'Tab') {
        e.preventDefault();
        const start = target.selectionStart;
        const value = target.value;
        
        // Find line start
        const lineStart = value.lastIndexOf('\n', start - 1) + 1;

        if (e.shiftKey) {
            // Outdent: Remove 2 spaces if present
            const lineEnd = value.indexOf('\n', start);
            const currentLine = value.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
            
            if (currentLine.startsWith('  ')) {
                const newValue = value.slice(0, lineStart) + value.slice(lineStart + 2);
                onUpdate(note.id, { content: newValue });
                // Move cursor back 2 chars, stopping at line start
                pendingCursorRef.current = Math.max(lineStart, start - 2);
            } else if (currentLine.startsWith('\t')) {
                 const newValue = value.slice(0, lineStart) + value.slice(lineStart + 1);
                 onUpdate(note.id, { content: newValue });
                 pendingCursorRef.current = Math.max(lineStart, start - 1);
            }
        } else {
            // Indent: Add 2 spaces at start of line
            const newValue = value.slice(0, lineStart) + '  ' + value.slice(lineStart);
            onUpdate(note.id, { content: newValue });
            // Move cursor forward 2 chars
            pendingCursorRef.current = start + 2;
        }
        return;
    }

    if (showPopup) {
       if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Enter') {
           if (e.key === 'Enter') e.preventDefault();
           return;
       }
    }

    if (e.key === 'Enter') {
      const target = e.target as HTMLTextAreaElement;
      const start = target.selectionStart;
      const value = target.value;
      const currentLineStart = value.lastIndexOf('\n', start - 1) + 1;
      const currentLineEnd = value.indexOf('\n', start);
      const currentLine = value.slice(currentLineStart, currentLineEnd === -1 ? undefined : currentLineEnd);
      
      const listMatch = currentLine.match(/^(\s*)([-*]|\d+\.)\s/);
      
      if (listMatch) {
        e.preventDefault();
        const basePrefix = listMatch[0];
        
        // Check for task regex: e.g. "   - [ ] " or "1. [x] "
        const taskRegex = /^(\s*)([-*]|\d+\.)\s+\[([ x])\]\s/;
        const taskMatch = currentLine.match(taskRegex);
        
        // Determine the "full" prefix. If it's a task, the prefix includes the bracket part.
        const fullPrefix = taskMatch ? taskMatch[0] : basePrefix;

        // If the current line is *strictly* just the prefix (trimmed), we clear the line.
        // This handles standard bullets "- " and tasks "- [ ] " alike.
        if (currentLine.trim() === fullPrefix.trim()) {
            const newValue = value.slice(0, currentLineStart) + value.slice(start);
            pendingCursorRef.current = currentLineStart;
            onUpdate(note.id, { content: newValue });
        } else {
            // Otherwise, we create a new line with the continuation prefix.
            let nextPrefix = basePrefix;
            
            // Handle Number Increment
            const numMatch = basePrefix.match(/^(\s*)(\d+)\.\s/);
            if (numMatch) {
                const num = parseInt(numMatch[2], 10);
                nextPrefix = `${numMatch[1]}${num + 1}. `;
            }

            // Handle Task Checkbox
            if (taskMatch) {
                 // Clean trailing space of the list marker and append empty checkbox
                 nextPrefix = nextPrefix.trimEnd() + ' [ ] ';
            }

            const newValue = value.slice(0, start) + '\n' + nextPrefix + value.slice(start);
            pendingCursorRef.current = start + 1 + nextPrefix.length;
            onUpdate(note.id, { content: newValue });
        }
      }
    }
  };

  const handleKeyUp = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    updateLineTracking();
    updateSelectionMenu();
    // Check if cursor moved out of autocomplete context (e.g. arrow keys)
    const target = e.target as HTMLTextAreaElement;
    checkAutocomplete(target.selectionStart, note.content);
  };

  const insertWikiLink = (title: string) => {
    if (!textareaRef.current) return;
    const value = note.content;
    const textBeforeCursor = value.slice(0, cursorIndex);
    const lastOpenBracket = textBeforeCursor.lastIndexOf('[[');
    if (lastOpenBracket !== -1) {
      const newValue = value.slice(0, lastOpenBracket) + `[[${title}]]` + value.slice(cursorIndex);
      pendingCursorRef.current = lastOpenBracket + 2 + title.length + 2;
      onUpdate(note.id, { content: newValue });
      setShowPopup(false);
    }
  };

  // Renders the text behind the textarea
  const renderBackdrop = (content: string) => {
      const lines = content.split('\n');
      return lines.map((line, index) => {
          const isActive = index === currentLineIndex;

          let contentNode: React.ReactNode = line;
          
          // Regex to identify code spans, wiki links, OR URLs
          // Exclude ')' from URL match to support [text](url) format
          const regex = /(`[^`]+`|!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\)|\[\[[^\]]+\]\]|https?:\/\/[^\s)]+)/g;
          const parts = line.split(regex);
          
          if (parts.length > 1) {
             contentNode = parts.map((part, i) => {
                 if (part.startsWith('`')) {
                     // Code span
                     return <span key={i} className="text-amber-600 dark:text-amber-200">{part}</span>;
                 }
                 if (part.startsWith('![') && part.includes('](') && part.endsWith(')')) {
                    // Image Syntax Highlight: ![alt](url)
                    const match = part.match(/!\[([^\]]*)\]\(([^)]+)\)/);
                    if (match) {
                        const alt = match[1];
                        const url = match[2];
                        return (
                            <span key={i} className="text-amber-600 dark:text-amber-500">
                                {'!['}{alt}{']('}
                                <span 
                                    className={`${isActive ? '' : 'underline cursor-pointer pointer-events-auto'}`}
                                    data-url={url}
                                    data-line-index={index}
                                >
                                    {url}
                                </span>
                                {')'}
                            </span>
                        );
                    }
                    return <span key={i} className="text-amber-600 dark:text-amber-500">{part}</span>;
                 }
                 if (part.startsWith('[') && !part.startsWith('[[') && part.includes('](') && part.endsWith(')')) {
                    // Link Syntax Highlight: [text](url)
                    const match = part.match(/\[([^\]]+)\]\(([^)]+)\)/);
                    if (match) {
                        const text = match[1];
                        const url = match[2];
                        return (
                            <span key={i} className="text-indigo-600 dark:text-indigo-400">
                                {'['}
                                <span className="text-indigo-600 dark:text-indigo-400">{text}</span>
                                {']('}
                                <span 
                                    className={`${isActive ? '' : 'underline cursor-pointer pointer-events-auto'}`}
                                    data-url={url}
                                    data-line-index={index}
                                >
                                    {url}
                                </span>
                                {')'}
                            </span>
                        );
                    }
                    return <span key={i} className="text-indigo-600 dark:text-indigo-400">{part}</span>;
                 }
                 if (part.startsWith('[[') && part.endsWith(']]')) {
                     const title = part.slice(2, -2);
                     return (
                         <span 
                            key={i} 
                            className={`
                                ${isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-indigo-600 dark:text-indigo-400 underline decoration-indigo-500/50 pointer-events-auto'}
                            `}
                            data-link-title={title}
                            data-line-index={index}
                         >
                             {part}
                         </span>
                     );
                 }
                 if (part.match(/^https?:\/\//)) {
                     return (
                         <span 
                            key={i} 
                            className={`
                                ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-blue-600 dark:text-blue-400 underline decoration-blue-500/50 pointer-events-auto'}
                            `}
                            data-url={part}
                            data-line-index={index}
                         >
                             {part}
                         </span>
                     );
                 }
                 return <span key={i}>{part}</span>;
             });
          } else {
             if (line === '') contentNode = <br/>;
          }

          return (
            <div key={index} className="whitespace-pre-wrap break-words">
                {contentNode}
            </div>
          );
      });
  };

  const renderMarkdown = (text: string) => {
    let html = text
      .replace(/^# (.*$)/gm, '<h1 class="text-3xl font-bold mb-6 text-slate-800 dark:text-slate-100 border-b border-gray-200 dark:border-slate-700 pb-2">$1</h1>')
      .replace(/^## (.*$)/gm, '<h2 class="text-2xl font-bold mb-4 mt-8 text-slate-700 dark:text-slate-200">$1</h2>')
      .replace(/^### (.*$)/gm, '<h3 class="text-xl font-bold mb-3 mt-6 text-slate-600 dark:text-slate-300">$1</h3>');
    
    // Blockquote
    html = html.replace(/^> (.*$)/gm, '<blockquote class="border-l-4 border-indigo-500/50 pl-4 italic text-slate-600 dark:text-slate-400 my-4">$1</blockquote>');

    html = html
      .replace(/(`[^`]+`)/g, '<code class="bg-gray-100 dark:bg-slate-800 px-1 py-0.5 rounded text-amber-700 dark:text-amber-200 text-sm font-mono">$1</code>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>');
    
    // Images ![alt](url)
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="max-w-full h-auto rounded-lg shadow-sm my-4" />');

    // Links [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-indigo-600 dark:text-indigo-400 hover:underline">$1</a>');
    
    // Auto-link <url>
    html = html.replace(/<(https?:\/\/[^>]+)>/g, '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-indigo-600 dark:text-indigo-400 hover:underline">$1</a>');

    // Interactive Tasks (Place BEFORE lists to prevent tasks being consumed by list regex)
    let taskIndex = 0;
    // Regex for both checked and unchecked to ensure correct indexing
    html = html.replace(/^\s*([-\*]|\d+\.)\s+\[([ x])\]\s(.*$)/gm, (_match, _bullet, state, content) => {
        const idx = taskIndex++;
        const isChecked = state === 'x';
        const opacity = isChecked ? 'opacity-50' : 'opacity-80';
        const decoration = isChecked ? 'line-through text-slate-500' : 'text-slate-700 dark:text-slate-300';
        
        return `<div class="flex items-start gap-3 my-2 ${opacity}"><input type="checkbox" ${isChecked ? 'checked' : ''} data-task-index="${idx}" class="mt-1.5 rounded border-gray-400 dark:border-slate-600 bg-transparent transform scale-110 cursor-pointer pointer-events-auto"><span class="${decoration}">${content}</span></div>`;
    });

    html = html.replace(/^\s*-\s+(.*$)/gm, '<li class="ml-4 list-disc text-slate-700 dark:text-slate-300 my-1">$1</li>');
    html = html.replace(/^\s*(\d+)\.\s+(.*$)/gm, '<li class="ml-4 list-decimal text-slate-700 dark:text-slate-300 my-1">$2</li>');

    html = html.replace(/\n\n/g, '<br/><br/>');
    html = html.replace(
      /\[\[(.*?)\]\]/g, 
      (match, p1) => `<span class="text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 underline cursor-pointer wiki-link font-medium" data-link="${p1}">${match}</span>`
    );
    return { __html: html };
  };

  const handlePreviewTaskToggle = (taskIndex: number) => {
    const lines = note.content.split('\n');
    let currentTaskCount = 0;
    const newLines = lines.map(line => {
        // Regex to identify a task line
        const taskRegex = /^(\s*)([-*]|\d+\.)\s+\[([ x])\]\s(.*)$/;
        const match = line.match(taskRegex);
        if (match) {
            if (currentTaskCount === taskIndex) {
                const isChecked = match[3] === 'x';
                const newStatus = isChecked ? ' ' : 'x';
                // Reconstruct line
                return `${match[1]}${match[2]} [${newStatus}] ${match[4]}`;
            }
            currentTaskCount++;
        }
        return line;
    });
    
    onUpdate(note.id, { content: newLines.join('\n') });
  };

  const handlePreviewClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    
    // Wiki Links
    if (target.classList.contains('wiki-link')) {
      const link = target.getAttribute('data-link');
      if (link) onLinkClick(link);
      return;
    }

    // Interactive Checkboxes
    if (target.tagName === 'INPUT' && target.getAttribute('type') === 'checkbox') {
        const indexStr = target.getAttribute('data-task-index');
        if (indexStr !== null) {
            const index = parseInt(indexStr, 10);
            handlePreviewTaskToggle(index);
        }
    }
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-950 relative group transition-colors duration-200">
      {/* Header */}
      <div className="flex flex-col px-6 py-3 border-b border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50 z-20">
        <div className="flex items-center justify-between">
            <input
                type="text"
                value={note.title}
                onChange={(e) => onUpdate(note.id, { title: e.target.value })}
                className="bg-transparent text-xl font-bold text-slate-800 dark:text-slate-200 focus:outline-none w-full mr-4 placeholder-slate-400 dark:placeholder-slate-600"
                placeholder="Note Title"
            />
            <div className="flex items-center gap-2 bg-gray-200 dark:bg-slate-800 rounded p-1">
            <button
                onClick={() => setMode('edit')}
                className={`p-1.5 rounded transition-colors ${mode === 'edit' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}
                title="Edit Mode"
            >
                <Edit3 size={16} />
            </button>
            <button
                onClick={() => setMode('preview')}
                className={`p-1.5 rounded transition-colors ${mode === 'preview' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}
                title="Reading Mode"
            >
                <Eye size={16} />
            </button>
            </div>
        </div>
        
        {/* Link Refactor Prompt */}
        {linkedNotesCount > 0 && (
            <div className="mt-2 flex items-center animate-in fade-in slide-in-from-top-1 duration-200">
                <button
                    onClick={() => {
                        onRefactorLinks(originalTitle, note.title);
                        setOriginalTitle(note.title);
                    }}
                    className="flex items-center gap-2 px-3 py-1.5 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 rounded-md text-sm font-medium hover:bg-indigo-200 dark:hover:bg-indigo-900 transition-colors group"
                >
                    <RefreshCw size={14} className="group-hover:rotate-180 transition-transform duration-500" />
                    <span>Update links in {linkedNotesCount} other files</span>
                </button>
            </div>
        )}
      </div>

      {/* Editor / Preview Area */}
      <div className="flex-1 overflow-y-auto" ref={scrollContainerRef}>
        <div className="flex flex-col min-h-full">
            {mode === 'edit' ? (
            <div className="relative w-full flex-1 min-h-[200px]" ref={containerRef}>
                {/* Backdrop: Syntax Highlighting */}
                <div 
                    ref={backdropRef}
                    className="min-h-full p-8 font-sans text-slate-800 dark:text-slate-300 whitespace-pre-wrap break-words pointer-events-none"
                    style={{ fontSize: `${fontSize}px`, lineHeight: 1.6 }}
                    aria-hidden="true"
                >
                    {renderBackdrop(note.content)}
                </div>

                {/* Textarea: Input handling, Transparent Text */}
                <textarea
                ref={textareaRef}
                value={note.content}
                onChange={handleChange}
                onClick={handleContentClick}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseLeave={() => { if(textareaRef.current) textareaRef.current.style.cursor = 'text'; }}
                onMouseUp={handleMouseUp}
                onKeyDown={handleKeyDown}
                onKeyUp={handleKeyUp}
                onBlur={() => setSelectionMenu(null)}
                className="absolute inset-0 w-full h-full p-8 bg-transparent text-transparent caret-indigo-600 dark:caret-slate-200 font-sans resize-none focus:outline-none z-10 overflow-hidden"
                style={{ fontSize: `${fontSize}px`, lineHeight: 1.6 }}
                placeholder="Start typing..."
                spellCheck={false}
                />
                
                {/* Selection Toolbar */}
                {selectionMenu && (
                    <div 
                        className="absolute z-50 flex items-center bg-slate-900 dark:bg-slate-200 rounded-md shadow-xl border border-slate-700 dark:border-slate-300 p-1 gap-0.5 -translate-x-1/2 -translate-y-full mt-[-10px] animate-in fade-in zoom-in-95 duration-100"
                        style={{ top: selectionMenu.top, left: selectionMenu.left }}
                        onMouseDown={(e) => e.preventDefault()} // Prevent blur
                    >
                        {/* 1. Less than 1 line (No newlines) */}
                        {!selectionMenu.text.includes('\n') && (
                            <>
                                <button 
                                    onClick={() => handleWrapText('**')}
                                    className="p-1.5 text-slate-300 dark:text-slate-800 hover:text-white dark:hover:text-black hover:bg-slate-700 dark:hover:bg-slate-300 rounded"
                                    title="Bold"
                                >
                                    <Bold size={14} />
                                </button>
                                <button 
                                    onClick={() => handleWrapText('*')}
                                    className="p-1.5 text-slate-300 dark:text-slate-800 hover:text-white dark:hover:text-black hover:bg-slate-700 dark:hover:bg-slate-300 rounded"
                                    title="Italic"
                                >
                                    <Italic size={14} />
                                </button>
                                <button 
                                    onClick={() => handleWrapText('~~')}
                                    className="p-1.5 text-slate-300 dark:text-slate-800 hover:text-white dark:hover:text-black hover:bg-slate-700 dark:hover:bg-slate-300 rounded"
                                    title="Strikethrough"
                                >
                                    <Strikethrough size={14} />
                                </button>
                                <button 
                                    onClick={() => handleWrapText('`')}
                                    className="p-1.5 text-slate-300 dark:text-slate-800 hover:text-white dark:hover:text-black hover:bg-slate-700 dark:hover:bg-slate-300 rounded"
                                    title="Code"
                                >
                                    <Code size={14} />
                                </button>
                                <button 
                                    onClick={() => handleWrapText('[[')}
                                    className="p-1.5 text-slate-300 dark:text-slate-800 hover:text-white dark:hover:text-black hover:bg-slate-700 dark:hover:bg-slate-300 rounded"
                                    title="Link"
                                >
                                    <LinkIcon size={14} />
                                </button>
                            </>
                        )}

                        {/* 2. 2 lines or more (Has newlines) */}
                        {selectionMenu.text.includes('\n') && (
                            <button 
                                onClick={handleExtractNote}
                                className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-slate-300 dark:text-slate-800 hover:text-white dark:hover:text-black hover:bg-slate-700 dark:hover:bg-slate-300 rounded"
                                title="Extract to New Note (Cmd+Shift+E)"
                            >
                                <FilePlus size={14} />
                                <span>Extract Note</span>
                            </button>
                        )}
                        
                        {/* Tail */}
                        <div className="absolute left-1/2 bottom-0 w-2 h-2 bg-slate-900 dark:bg-slate-200 translate-y-1/2 -translate-x-1/2 rotate-45 border-r border-b border-slate-700 dark:border-slate-300"></div>
                    </div>
                )}

                {showPopup && (
                <WikiLinkPopup
                    query={popupQuery}
                    notes={allNotes}
                    onSelect={insertWikiLink}
                    position={popupPos}
                    onClose={() => setShowPopup(false)}
                />
                )}
            </div>
            ) : (
            <div 
                className="w-full h-full p-8 prose prose-slate dark:prose-invert max-w-none transition-colors duration-200 flex-1 min-h-[200px]"
                style={{ fontSize: `${fontSize}px` }}
                dangerouslySetInnerHTML={renderMarkdown(note.content)}
                onClick={handlePreviewClick}
            />
            )}

            {/* Footer: Related Notes (Cosense-like) */}
            {relatedNotes.length > 0 && (
                <div className="border-t border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-950/50 p-6 shrink-0 mt-auto">
                    <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4">Related Notes</h3>
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                        {relatedNotes.map(n => (
                            <NoteCard 
                                key={n.id} 
                                note={n} 
                                onLinkClick={onLinkClick} 
                                currentNoteTitle={note.title}
                            />
                        ))}
                    </div>
                </div>
            )}
        </div>
      </div>
    </div>
  );
};

export default Editor;