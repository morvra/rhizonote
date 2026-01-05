import React, { useState, useRef, useEffect, useMemo } from 'react';
import Sidebar from './components/Sidebar';
import Editor from './components/Editor';
import { Note, Folder, SortField, SortDirection, Theme } from './types';
import { INITIAL_NOTES, INITIAL_FOLDERS } from './constants';
import { Columns, Minimize2, Menu, ChevronLeft, ChevronRight, X, Moon, Sun, Monitor, Type, PanelLeft, Calendar, Plus, Keyboard, CheckSquare, Cloud, RefreshCw, LogOut, Upload, Download, FileText } from 'lucide-react';
import { getDropboxAuthUrl, parseAuthTokenFromUrl, uploadDataToDropbox, downloadDataFromDropbox } from './utils/dropboxService';

const generateId = () => Math.random().toString(36).substr(2, 9);

// Local Storage Keys
const LS_KEY_NOTES = 'rhizonote_notes';
const LS_KEY_FOLDERS = 'rhizonote_folders';
const LS_KEY_THEME = 'rhizonote_theme';
const LS_KEY_DB_TOKEN = 'rhizonote_dropbox_token';

// Simple date formatter
const formatDate = (date: Date, format: string) => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const shortDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    
    const map: Record<string, string> = {
        'YYYY': date.getFullYear().toString(),
        'MM': String(date.getMonth() + 1).padStart(2, '0'),
        'DD': String(date.getDate()).padStart(2, '0'),
        'dddd': days[date.getDay()],
        'ddd': shortDays[date.getDay()],
    };

    return format.replace(/YYYY|MM|DD|dddd|ddd/g, (matched) => map[matched]);
};

// Process template with date offsets (e.g. {{date+1d:YYYY-MM-DD}})
const processTemplate = (template: string, title: string) => {
    let result = template.replace(/\{\{title\}\}/g, title);

    // Regex for {{date(+1d):Format}}
    // Captures: 1: Offset (+1d, -2M), 2: Format (YYYY-MM-DD)
    result = result.replace(/\{\{date([+-]\d+[dmy])?:(.*?)\}\}/gi, (_, offset, format) => {
        const d = new Date();
        if (offset) {
            const operator = offset.charAt(0); // + or -
            const numStr = offset.slice(1, -1);
            const unit = offset.slice(-1).toLowerCase();
            const num = parseInt(numStr, 10) * (operator === '-' ? -1 : 1);

            if (unit === 'd') d.setDate(d.getDate() + num);
            if (unit === 'm') d.setMonth(d.getMonth() + num);
            if (unit === 'y') d.setFullYear(d.getFullYear() + num);
        }
        return formatDate(d, format);
    });
    return result;
};

interface PaneHistory {
    stack: string[];
    currentIndex: number;
}

interface ExtractedTask {
    lineIndex: number;
    prefix: string;
    content: string;
    isChecked: boolean;
    rawLine: string;
}

interface NoteTasks {
    note: Note;
    tasks: ExtractedTask[];
}

export default function App() {
  // Initialize State from LocalStorage or Defaults
  const [notes, setNotes] = useState<Note[]>(() => {
      const saved = localStorage.getItem(LS_KEY_NOTES);
      return saved ? JSON.parse(saved) : INITIAL_NOTES;
  });
  const [folders, setFolders] = useState<Folder[]>(() => {
      const saved = localStorage.getItem(LS_KEY_FOLDERS);
      return saved ? JSON.parse(saved) : INITIAL_FOLDERS;
  });
  
  // Settings State
  const [theme, setTheme] = useState<Theme>(() => {
      return (localStorage.getItem(LS_KEY_THEME) as Theme) || 'dark';
  });
  const [fontSize, setFontSize] = useState<number>(16);
  const [showSettings, setShowSettings] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showTasks, setShowTasks] = useState(false);

  // Dropbox State
  const [dropboxToken, setDropboxToken] = useState<string | null>(() => localStorage.getItem(LS_KEY_DB_TOKEN));
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [syncMessage, setSyncMessage] = useState('');

  // Daily Note Settings
  const [dailyNoteFormat, setDailyNoteFormat] = useState('YYYY-MM-DD');
  const [dailyNoteFolderId, setDailyNoteFolderId] = useState<string>(''); // Empty string means root
  const [dailyNoteTemplate, setDailyNoteTemplate] = useState('# {{title}}\n\n<< [[{{date-1d:YYYY-MM-DD}}]] | [[{{date+1d:YYYY-MM-DD}}]] >>\n\n## Tasks\n- [ ] ');

  // Modal States
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    message: string;
    onConfirm: () => void;
  }>({ isOpen: false, message: '', onConfirm: () => {} });

  const [inputModal, setInputModal] = useState<{
    isOpen: boolean;
    title: string;
    value: string;
    onConfirm: (val: string) => void;
  }>({ isOpen: false, title: '', value: '', onConfirm: () => {} });

  // Sort State
  const [sortField, setSortField] = useState<SortField>('updated');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  
  // Layout State
  const [sidebarWidth, setSidebarWidth] = useState(256); // Default 256px
  const [splitRatio, setSplitRatio] = useState(0.5); // Default 50% for split view
  const isResizingSidebar = useRef(false);
  const isResizingSplit = useRef(false);

  // State for panes and their history
  const [panes, setPanes] = useState<(string | null)[]>(['1', null]); 
  const [history, setHistory] = useState<PaneHistory[]>([
      { stack: ['1'], currentIndex: 0 }, // History for Pane 0
      { stack: [], currentIndex: -1 }    // History for Pane 1
  ]);

  const [activePaneIndex, setActivePaneIndex] = useState<number>(0);
  
  // Sidebar Visibility States
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(true);

  const activeNoteId = panes[activePaneIndex];

  // LocalStorage Effects
  useEffect(() => {
    localStorage.setItem(LS_KEY_NOTES, JSON.stringify(notes));
  }, [notes]);

  useEffect(() => {
    localStorage.setItem(LS_KEY_FOLDERS, JSON.stringify(folders));
  }, [folders]);

  useEffect(() => {
    localStorage.setItem(LS_KEY_THEME, theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // Dropbox Auth Check
  useEffect(() => {
      const token = parseAuthTokenFromUrl();
      if (token) {
          setDropboxToken(token);
          localStorage.setItem(LS_KEY_DB_TOKEN, token);
          window.location.hash = ''; // Clear hash
          setShowSettings(true); // Open settings to show success
          setSyncStatus('success');
          setSyncMessage('Dropbox connected successfully!');
          setTimeout(() => setSyncStatus('idle'), 3000);
      }
  }, []);

  // Dropbox Handlers
  const handleConnectDropbox = () => {
      window.location.href = getDropboxAuthUrl();
  };

  const handleDisconnectDropbox = () => {
      setDropboxToken(null);
      localStorage.removeItem(LS_KEY_DB_TOKEN);
      setSyncMessage('');
  };

  const handleSyncPush = async () => {
      if (!dropboxToken) return;
      setSyncStatus('syncing');
      try {
          await uploadDataToDropbox(dropboxToken, notes, folders);
          setSyncStatus('success');
          setSyncMessage(`Uploaded successfully at ${new Date().toLocaleTimeString()}`);
      } catch (e) {
          console.error(e);
          setSyncStatus('error');
          setSyncMessage('Upload failed. Check console.');
      }
      setTimeout(() => { if(syncStatus !== 'error') setSyncStatus('idle'); }, 3000);
  };

  const handleSyncPull = async () => {
      if (!dropboxToken) return;
      setSyncStatus('syncing');
      try {
          const data = await downloadDataFromDropbox(dropboxToken);
          if (data) {
              setNotes(data.notes);
              setFolders(data.folders);
              setSyncStatus('success');
              setSyncMessage(`Downloaded successfully at ${new Date().toLocaleTimeString()}`);
          } else {
              setSyncStatus('error');
              setSyncMessage('No sync file found in Dropbox.');
          }
      } catch (e) {
          console.error(e);
          setSyncStatus('error');
          setSyncMessage('Download failed. Check console.');
      }
      setTimeout(() => { if(syncStatus !== 'error') setSyncStatus('idle'); }, 3000);
  };

  // Extract all tasks from all notes (Memoized)
  const allTasks = useMemo<NoteTasks[]>(() => {
      const result: NoteTasks[] = [];
      notes.forEach(note => {
          const noteTasks: ExtractedTask[] = [];
          note.content.split('\n').forEach((line, idx) => {
              // Regex: matches "   - [ ] task..." or "   - [x] task..."
              const match = line.match(/^(\s*)(-\s\[([ x])\]\s)(.*)/);
              if (match) {
                  noteTasks.push({
                      lineIndex: idx,
                      prefix: match[1] + match[2],
                      content: match[4],
                      isChecked: match[3] === 'x',
                      rawLine: line
                  });
              }
          });
          if (noteTasks.length > 0) {
              result.push({ note, tasks: noteTasks });
          }
      });
      return result;
  }, [notes]);

  const handleCloseTasks = () => {
      setShowTasks(false);
  };

  const handleToggleTaskFromModal = (noteId: string, lineIndex: number, currentChecked: boolean) => {
      setNotes(prev => prev.map(note => {
          if (note.id !== noteId) return note;

          const lines = note.content.split('\n');
          if (lineIndex >= lines.length) return note; // Safety check

          const line = lines[lineIndex];
          const newStatus = currentChecked ? '[ ]' : '[x]';
          // Replace only the first occurrence of [ ] or [x] to ensure we target the checkbox
          const newLine = line.replace(/\[([ x])\]/, newStatus);
          lines[lineIndex] = newLine;

          return { ...note, content: lines.join('\n'), updatedAt: Date.now() };
      }));
  };

  const handleCreateNote = () => {
    const newNote: Note = {
      id: generateId(),
      folderId: null, // Default to root
      title: '',
      content: '',
      isBookmarked: false,
      updatedAt: Date.now(),
      createdAt: Date.now(),
    };
    setNotes(prev => [newNote, ...prev]);
    openNote(newNote.id);
    setMobileMenuOpen(false); // Close sidebar on mobile on create
  };

  const handleCreateSpecificNote = (title: string, content: string) => {
    const newNote: Note = {
        id: generateId(),
        folderId: null,
        title: title,
        content: content,
        isBookmarked: false,
        updatedAt: Date.now(),
        createdAt: Date.now(),
    };
    setNotes(prev => [newNote, ...prev]);
    // Note: We intentionally don't open the note here to keep focus on the editor
    // unless the user specifically navigates there later.
  };

  const handleOpenDailyNote = () => {
    const todayTitle = formatDate(new Date(), dailyNoteFormat);
    
    // Check if folder exists, if not fallback to root
    const targetFolderId = dailyNoteFolderId && folders.find(f => f.id === dailyNoteFolderId) ? dailyNoteFolderId : null;

    // Find existing note
    const existingNote = notes.find(n => n.title === todayTitle && n.folderId === targetFolderId);

    if (existingNote) {
        openNote(existingNote.id);
    } else {
        // Create new daily note with processed template
        const content = processTemplate(dailyNoteTemplate, todayTitle);
        
        const newNote: Note = {
            id: generateId(),
            folderId: targetFolderId,
            title: todayTitle,
            content: content,
            isBookmarked: false,
            updatedAt: Date.now(),
            createdAt: Date.now(),
        };
        setNotes(prev => [newNote, ...prev]);
        openNote(newNote.id);
    }
    setMobileMenuOpen(false);
  };

  const handleCreateFolder = (parentId: string | null = null) => {
    setInputModal({
        isOpen: true,
        title: 'New Folder Name',
        value: '',
        onConfirm: (name) => {
            if (name) {
                setFolders(prev => [...prev, { 
                    id: generateId(), 
                    name, 
                    parentId, 
                    createdAt: Date.now() 
                }]);
            }
            setInputModal(prev => ({ ...prev, isOpen: false }));
        }
    });
  };

  const getDescendantFolderIds = (folderId: string, allFolders: Folder[]): string[] => {
      const children = allFolders.filter(f => f.parentId === folderId);
      let ids = children.map(c => c.id);
      children.forEach(c => {
          ids = [...ids, ...getDescendantFolderIds(c.id, allFolders)];
      });
      return ids;
  };

  const handleDeleteFolder = (id: string) => {
    const folder = folders.find(f => f.id === id);
    const name = folder ? folder.name : 'this folder';
    
    setConfirmModal({
        isOpen: true,
        message: `Delete folder "${name}" and all its contents?`,
        onConfirm: () => {
            const idsToDelete = [id, ...getDescendantFolderIds(id, folders)];
            setFolders(prev => prev.filter(f => !idsToDelete.includes(f.id)));
            setNotes(prev => prev.filter(n => !n.folderId || !idsToDelete.includes(n.folderId)));
            
            // Check if deleted folder was the daily note folder
            if (dailyNoteFolderId === id) {
                setDailyNoteFolderId('');
            }
            
            const allNotes = notes; 
            const deletedNoteIds = allNotes
                .filter(n => n.folderId && idsToDelete.includes(n.folderId))
                .map(n => n.id);
            setPanes(prev => prev.map(pid => (pid && deletedNoteIds.includes(pid)) ? null : pid));
            
            setConfirmModal(prev => ({ ...prev, isOpen: false }));
        }
    });
  };

  const handleDeleteNote = (id: string) => {
    setConfirmModal({
        isOpen: true,
        message: 'Are you sure you want to delete this note?',
        onConfirm: () => {
            setNotes(prev => prev.filter((n) => n.id !== id));
            setPanes(prev => prev.map(paneId => paneId === id ? null : paneId));
            setConfirmModal(prev => ({ ...prev, isOpen: false }));
        }
    });
  };

  const handleToggleBookmark = (id: string) => {
    setNotes(prev => {
        const note = prev.find(n => n.id === id);
        if (!note) return prev;
        if (note.isBookmarked) {
            // Unbookmark
            return prev.map(n => n.id === id ? { ...n, isBookmarked: false, bookmarkOrder: undefined } : n);
        } else {
            // Bookmark (add to end)
            const maxOrder = Math.max(0, ...prev.filter(n => n.isBookmarked).map(n => n.bookmarkOrder || 0));
            return prev.map(n => n.id === id ? { ...n, isBookmarked: true, bookmarkOrder: maxOrder + 1 } : n);
        }
    });
  };

  const handleReorderBookmark = (draggedId: string, targetId: string) => {
    setNotes(prev => {
        // Get all bookmarked notes sorted by current order
        const bookmarked = prev.filter(n => n.isBookmarked).sort((a, b) => (a.bookmarkOrder || 0) - (b.bookmarkOrder || 0));
        const draggedIndex = bookmarked.findIndex(n => n.id === draggedId);
        const targetIndex = bookmarked.findIndex(n => n.id === targetId);

        if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) return prev;

        // Move item in array
        const item = bookmarked[draggedIndex];
        const newOrderList = [...bookmarked];
        newOrderList.splice(draggedIndex, 1);
        newOrderList.splice(targetIndex, 0, item);

        // Create a map of id -> newOrder
        const orderMap = new Map();
        newOrderList.forEach((n, idx) => orderMap.set(n.id, idx));

        // Update all notes
        return prev.map(n => {
            if (orderMap.has(n.id)) {
                return { ...n, bookmarkOrder: orderMap.get(n.id) };
            }
            return n;
        });
    });
  };

  const handleUpdateNote = (id: string, updates: Partial<Note>) => {
    setNotes(prev => prev.map((n) => (n.id === id ? { ...n, ...updates, updatedAt: Date.now() } : n)));
  };

  const handleRefactorLinks = (oldTitle: string, newTitle: string) => {
    // Escape regex characters in old title
    const escapedOldTitle = oldTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\[\\[${escapedOldTitle}\\]\\]`, 'g');
    
    setNotes(prev => prev.map(note => {
      // Only update if it contains the link
      if (note.content.match(regex)) {
        return {
          ...note,
          content: note.content.replace(regex, `[[${newTitle}]]`),
          updatedAt: Date.now()
        };
      }
      return note;
    }));
  };

  const handleMoveNote = (noteId: string, folderId: string | null) => {
    setNotes(prev => prev.map(n => n.id === noteId ? { ...n, folderId, updatedAt: Date.now() } : n));
  };

  const handleMoveFolder = (folderId: string, newParentId: string | null) => {
      if (newParentId) {
          if (folderId === newParentId) return;
          const descendants = getDescendantFolderIds(folderId, folders);
          if (descendants.includes(newParentId)) {
              alert("Cannot move a folder into its own subfolder.");
              return;
          }
      }
      setFolders(folders.map(f => f.id === folderId ? { ...f, parentId: newParentId } : f));
  };

  const handleSortChange = (field: SortField) => {
      if (sortField === field) {
          setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
      } else {
          setSortField(field);
          setSortDirection(field === 'name' ? 'asc' : 'desc');
      }
  };

  const openNote = (id: string) => {
    const targetPane = activePaneIndex;
    const newPanes = [...panes];
    newPanes[targetPane] = id;
    setPanes(newPanes);
    setHistory(prevHistory => {
        const newHistory = [...prevHistory];
        const paneHist = newHistory[targetPane] || { stack: [], currentIndex: -1 };
        const newStack = paneHist.stack.slice(0, paneHist.currentIndex + 1);
        if (newStack[newStack.length - 1] !== id) {
            newStack.push(id);
        }
        newHistory[targetPane] = {
            stack: newStack,
            currentIndex: newStack.length - 1
        };
        return newHistory;
    });
    if (window.innerWidth < 768) {
        setMobileMenuOpen(false);
    }
  };

  const goBack = () => {
      const hist = history[activePaneIndex];
      if (hist && hist.currentIndex > 0) {
          const newIndex = hist.currentIndex - 1;
          const noteId = hist.stack[newIndex];
          const newPanes = [...panes];
          newPanes[activePaneIndex] = noteId;
          setPanes(newPanes);
          setHistory(prev => {
              const newH = [...prev];
              newH[activePaneIndex] = { ...hist, currentIndex: newIndex };
              return newH;
          });
      }
  };

  const goForward = () => {
      const hist = history[activePaneIndex];
      if (hist && hist.currentIndex < hist.stack.length - 1) {
          const newIndex = hist.currentIndex + 1;
          const noteId = hist.stack[newIndex];
          const newPanes = [...panes];
          newPanes[activePaneIndex] = noteId;
          setPanes(newPanes);
          setHistory(prev => {
              const newH = [...prev];
              newH[activePaneIndex] = { ...hist, currentIndex: newIndex };
              return newH;
          });
      }
  };

  const handleLinkClick = (title: string) => {
    const targetNote = notes.find(n => n.title.toLowerCase() === title.toLowerCase());
    if (targetNote) {
      openNote(targetNote.id);
    } else {
      setConfirmModal({
          isOpen: true,
          message: `Note "${title}" does not exist. Create it?`,
          onConfirm: () => {
            const newNote: Note = {
                id: generateId(),
                folderId: null,
                title: title,
                content: '',
                isBookmarked: false,
                updatedAt: Date.now(),
                createdAt: Date.now(),
            };
            setNotes(prev => [newNote, ...prev]);
            openNote(newNote.id);
            setConfirmModal(prev => ({ ...prev, isOpen: false }));
          }
      });
    }
  };

  const toggleSplitView = () => {
    if (panes[1] !== null) {
      setPanes([panes[0], null]);
      setActivePaneIndex(0);
      setSplitRatio(0.5);
    } else {
      setPanes([panes[0], panes[0]]); 
      setHistory(prev => {
          const newH = [...prev];
          if (panes[0]) {
            newH[1] = { stack: [panes[0]], currentIndex: 0 };
          } else {
            newH[1] = { stack: [], currentIndex: -1 };
          }
          return newH;
      });
      setActivePaneIndex(1);
    }
  };

  const getNoteById = (id: string | null) => notes.find((n) => n.id === id);

  const canGoBack = history[activePaneIndex]?.currentIndex > 0;
  const canGoForward = history[activePaneIndex]?.currentIndex < (history[activePaneIndex]?.stack.length - 1);

  // Resizing Handlers
  const startResizingSidebar = (e: React.MouseEvent) => {
      e.preventDefault();
      isResizingSidebar.current = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
  };

  const startResizingSplit = (e: React.MouseEvent) => {
      e.preventDefault();
      isResizingSplit.current = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
  };

  const stopResizing = () => {
      isResizingSidebar.current = false;
      isResizingSplit.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
  };

  const handleMouseMove = (e: React.MouseEvent) => {
      if (isResizingSidebar.current) {
          const newWidth = e.clientX;
          if (newWidth > 150 && newWidth < 600) {
              setSidebarWidth(newWidth);
          }
      } else if (isResizingSplit.current && panes[1] !== null) {
          // Calculate percentage based on available width (viewport - sidebar)
          const availableWidth = window.innerWidth - (sidebarVisible ? sidebarWidth : 0);
          const relativeX = e.clientX - (sidebarVisible ? sidebarWidth : 0);
          const newRatio = relativeX / availableWidth;
          if (newRatio > 0.2 && newRatio < 0.8) {
              setSplitRatio(newRatio);
          }
      }
  };

  // Keyboard Shortcuts via Ref to avoid stale closures
  const shortcutHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});

  // Update the ref logic on every render to capture fresh closures (for handleCreateNote, notes state, etc)
  useEffect(() => {
    shortcutHandlerRef.current = (e: KeyboardEvent) => {
        const isMod = e.metaKey || e.ctrlKey;
        
        // Navigation: Mod + [ or Alt + Left / Mod + ] or Alt + Right
        if ((isMod && e.key === '[') || (e.altKey && e.key === 'ArrowLeft')) {
            e.preventDefault();
            goBack();
        } else if ((isMod && e.key === ']') || (e.altKey && e.key === 'ArrowRight')) {
            e.preventDefault();
            goForward();
        }

        // New Note: Mod + N
        if (isMod && e.key.toLowerCase() === 'n') {
            e.preventDefault();
            handleCreateNote();
        }

        // Daily Note: Mod + D
        if (isMod && e.key.toLowerCase() === 'd') {
            e.preventDefault();
            handleOpenDailyNote();
        }

        // Toggle Sidebar: Mod + \
        if (isMod && e.key === '\\') {
            e.preventDefault();
            setSidebarVisible(prev => !prev);
        }

        // Show Shortcuts: Mod + ? (or /)
        if (isMod && (e.key === '?' || e.key === '/')) {
            e.preventDefault();
            setShowShortcuts(prev => !prev);
        }

        // Show Tasks: Alt + T (Option + T)
        if (e.altKey && e.key.toLowerCase() === 't') {
            e.preventDefault();
            setShowTasks(prev => {
                if (prev) {
                    return false;
                }
                return true;
            });
        }
    };
  }); // No dependencies -> runs on every render

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (shortcutHandlerRef.current) {
            shortcutHandlerRef.current(e);
        }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div 
        className={`flex h-screen w-screen overflow-hidden font-sans bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 transition-colors duration-200`}
        onMouseMove={handleMouseMove}
        onMouseUp={stopResizing}
        onMouseLeave={stopResizing}
    >
      <Sidebar
        isOpen={mobileMenuOpen}
        isVisible={sidebarVisible}
        onCloseMobile={() => setMobileMenuOpen(false)}
        notes={notes}
        folders={folders}
        activeNoteId={activeNoteId}
        onSelectNote={openNote}
        onCreateNote={handleCreateNote}
        onCreateFolder={handleCreateFolder}
        onDeleteNote={handleDeleteNote}
        onDeleteFolder={handleDeleteFolder}
        onToggleBookmark={handleToggleBookmark}
        onReorderBookmark={handleReorderBookmark}
        onMoveNote={handleMoveNote}
        onMoveFolder={handleMoveFolder}
        sortField={sortField}
        sortDirection={sortDirection}
        onSortChange={handleSortChange}
        width={sidebarWidth}
        onOpenSettings={() => setShowSettings(true)}
      />

      {/* Sidebar Resizer - Only visible on desktop when sidebar is open */}
      {sidebarVisible && (
        <div 
            className="w-px bg-gray-200 dark:bg-slate-800 hover:w-1 hover:bg-indigo-500 cursor-col-resize transition-all z-20 flex-shrink-0 hidden md:block"
            onMouseDown={startResizingSidebar}
        />
      )}

      <div className="flex-1 flex flex-col h-full min-w-0">
        {/* Top Bar */}
        <div className="h-10 border-b border-gray-200 dark:border-slate-800 flex items-center justify-between px-4 bg-gray-50 dark:bg-slate-900 gap-2 shrink-0 transition-colors duration-200">
            <div className="flex items-center gap-2">
                <button
                    onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                    className="md:hidden p-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                >
                    <Menu size={18} />
                </button>
                <button
                    onClick={() => setSidebarVisible(!sidebarVisible)}
                    className={`hidden md:block p-1 rounded transition-colors ${!sidebarVisible ? 'text-slate-400 dark:text-slate-600' : 'text-slate-600 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700'}`}
                    title="Toggle Sidebar (Cmd/Ctrl + \)"
                >
                    <PanelLeft size={18} />
                </button>
                
                {/* Navigation Buttons */}
                <div className="flex items-center bg-gray-200 dark:bg-slate-800 rounded ml-2">
                    <button 
                        onClick={goBack}
                        disabled={!canGoBack}
                        className={`p-1 rounded-l transition-colors ${canGoBack ? 'text-slate-600 dark:text-slate-300 hover:bg-gray-300 dark:hover:bg-slate-700 cursor-default' : 'text-slate-400 dark:text-slate-600 cursor-default'}`}
                        title="Go Back (Cmd + [ or Alt + Left)"
                    >
                        <ChevronLeft size={16} />
                    </button>
                    <div className="w-px h-4 bg-gray-300 dark:bg-slate-700"></div>
                    <button 
                        onClick={goForward}
                        disabled={!canGoForward}
                        className={`p-1 rounded-r transition-colors ${canGoForward ? 'text-slate-600 dark:text-slate-300 hover:bg-gray-300 dark:hover:bg-slate-700 cursor-default' : 'text-slate-400 dark:text-slate-600 cursor-default'}`}
                        title="Go Forward (Cmd + ] or Alt + Right)"
                    >
                        <ChevronRight size={16} />
                    </button>
                </div>

                {/* Daily Note Button */}
                <button
                    onClick={handleOpenDailyNote}
                    className="p-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-slate-700 rounded transition-colors ml-1"
                    title="Open Today's Note (Cmd/Ctrl + D)"
                >
                    <Calendar size={18} />
                </button>

                {/* Tasks Button */}
                <button
                    onClick={() => setShowTasks(true)}
                    className="p-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-slate-700 rounded transition-colors ml-1"
                    title="Task List (Alt + T)"
                >
                    <CheckSquare size={18} />
                </button>

                {/* New Note Button */}
                <button
                    onClick={handleCreateNote}
                    className="p-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-slate-700 rounded transition-colors ml-1"
                    title="Create New Note (Ctrl/Cmd + N)"
                >
                    <Plus size={18} />
                </button>
            </div>
            
            <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 dark:text-slate-500 hidden sm:inline mr-2">
                    {panes[1] !== null ? 'Split View Active' : 'Single View'}
                </span>
                <button 
                    onClick={toggleSplitView}
                    className="p-1 text-slate-500 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white rounded transition-colors"
                    title={panes[1] !== null ? "Close Split Pane" : "Split Pane"}
                >
                    {panes[1] !== null ? <Minimize2 size={16} /> : <Columns size={16} />}
                </button>
            </div>
        </div>

        {/* Main Workspace */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* Pane 1 */}
          <div 
            className={`flex flex-col min-w-0 transition-colors duration-200 ${activePaneIndex === 0 ? 'ring-1 ring-inset ring-indigo-500/30 z-10' : ''}`}
            onClick={() => setActivePaneIndex(0)}
            style={{ flex: panes[1] !== null ? splitRatio : 1 }}
          >
            {getNoteById(panes[0]) ? (
              <Editor
                note={getNoteById(panes[0])!}
                allNotes={notes}
                onUpdate={handleUpdateNote}
                onLinkClick={handleLinkClick}
                onRefactorLinks={handleRefactorLinks}
                onCreateNoteWithContent={handleCreateSpecificNote}
                fontSize={fontSize}
              />
            ) : (
               <EmptyState onCreate={handleCreateNote} />
            )}
          </div>

          {/* Split Resizer */}
          {panes[1] !== null && (
               <div 
                   className="w-px bg-gray-200 dark:bg-slate-800 hover:w-1 hover:bg-indigo-500 cursor-col-resize transition-all z-20 flex-shrink-0"
                   onMouseDown={startResizingSplit}
               />
          )}

          {/* Pane 2 */}
          {panes[1] !== null && (
             <div 
                className={`flex flex-col min-w-0 transition-colors duration-200 ${activePaneIndex === 1 ? 'ring-1 ring-inset ring-indigo-500/30 z-10' : ''}`}
                onClick={() => setActivePaneIndex(1)}
                style={{ flex: 1 - splitRatio }}
             >
                {getNoteById(panes[1]) ? (
                    <Editor
                        note={getNoteById(panes[1])!}
                        allNotes={notes}
                        onUpdate={handleUpdateNote}
                        onLinkClick={handleLinkClick}
                        onRefactorLinks={handleRefactorLinks}
                        onCreateNoteWithContent={handleCreateSpecificNote}
                        fontSize={fontSize}
                    />
                ) : (
                    <EmptyState onCreate={handleCreateNote} />
                )}
             </div>
          )}
        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowSettings(false)}></div>
            <div className="relative bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl shadow-2xl w-full max-w-sm max-h-[90vh] overflow-y-auto p-6 space-y-6">
                <div className="flex items-center justify-between border-b border-gray-200 dark:border-slate-800 pb-4">
                    <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">Settings</h2>
                    <button onClick={() => setShowSettings(false)} className="text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-white">
                        <X size={20} />
                    </button>
                </div>

                {/* Sync Settings */}
                <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-slate-300">
                        <Cloud size={16} />
                        <span>Dropbox Sync</span>
                    </div>
                    <div className="bg-gray-100 dark:bg-slate-950 p-3 rounded-lg space-y-3">
                        {!dropboxToken ? (
                            <button
                                onClick={handleConnectDropbox}
                                className="w-full py-2 bg-[#0061FE] hover:bg-[#0057e5] text-white rounded-md font-medium text-sm flex items-center justify-center gap-2 transition-colors"
                            >
                                <Cloud size={16} /> Connect Dropbox
                            </button>
                        ) : (
                            <>
                                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                                    <span className="text-green-600 dark:text-green-400 font-medium">Connected</span>
                                    <button onClick={handleDisconnectDropbox} className="hover:text-red-500 transition-colors flex items-center gap-1">
                                        <LogOut size={12} /> Disconnect
                                    </button>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <button 
                                        onClick={handleSyncPush}
                                        disabled={syncStatus === 'syncing'}
                                        className="flex items-center justify-center gap-2 py-2 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-900/50 rounded-md text-xs font-medium transition-colors"
                                        title="Overwrite Dropbox data with local data"
                                    >
                                        <Upload size={14} /> Push (Upload)
                                    </button>
                                    <button 
                                        onClick={handleSyncPull}
                                        disabled={syncStatus === 'syncing'}
                                        className="flex items-center justify-center gap-2 py-2 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 rounded-md text-xs font-medium transition-colors"
                                        title="Overwrite local data with Dropbox data"
                                    >
                                        <Download size={14} /> Pull (Download)
                                    </button>
                                </div>
                                {syncMessage && (
                                    <div className={`text-xs text-center ${syncStatus === 'error' ? 'text-red-500' : 'text-slate-500'}`}>
                                        {syncStatus === 'syncing' ? (
                                            <span className="flex items-center justify-center gap-1">
                                                <RefreshCw size={12} className="animate-spin" /> Syncing...
                                            </span>
                                        ) : syncMessage}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>

                {/* Theme Toggle */}
                <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-slate-300">
                        <Monitor size={16} />
                        <span>Theme</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 bg-gray-100 dark:bg-slate-950 p-1 rounded-lg">
                        <button 
                            onClick={() => setTheme('light')}
                            className={`flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors ${
                                theme === 'light' 
                                ? 'bg-white text-indigo-600 shadow-sm' 
                                : 'text-gray-500 hover:text-gray-900 dark:text-slate-500 dark:hover:text-slate-300'
                            }`}
                        >
                            <Sun size={16} /> Light
                        </button>
                        <button 
                            onClick={() => setTheme('dark')}
                            className={`flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors ${
                                theme === 'dark' 
                                ? 'bg-slate-800 text-white shadow-sm' 
                                : 'text-gray-500 hover:text-gray-900 dark:text-slate-500 dark:hover:text-slate-300'
                            }`}
                        >
                            <Moon size={16} /> Dark
                        </button>
                    </div>
                </div>

                {/* Font Size */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between text-sm font-semibold text-gray-700 dark:text-slate-300">
                        <div className="flex items-center gap-2">
                            <Type size={16} />
                            <span>Font Size</span>
                        </div>
                        <span className="text-indigo-600 dark:text-indigo-400">{fontSize}px</span>
                    </div>
                    <div className="flex items-center gap-4">
                        <span className="text-xs text-gray-500">A</span>
                        <input 
                            type="range" 
                            min="12" 
                            max="24" 
                            step="1"
                            value={fontSize}
                            onChange={(e) => setFontSize(parseInt(e.target.value))}
                            className="flex-1 h-2 bg-gray-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                        />
                        <span className="text-lg text-gray-500">A</span>
                    </div>
                </div>

                {/* Daily Notes Settings */}
                <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-slate-800">
                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-slate-300">
                        <Calendar size={16} />
                        <span>Daily Notes</span>
                    </div>
                    
                    <div className="space-y-1">
                        <label className="text-xs text-slate-500 dark:text-slate-400">Date Format</label>
                        <input 
                            type="text" 
                            value={dailyNoteFormat} 
                            onChange={(e) => setDailyNoteFormat(e.target.value)}
                            className="w-full bg-gray-100 dark:bg-slate-950 text-slate-800 dark:text-slate-200 rounded p-2 text-sm border border-gray-300 dark:border-slate-800 focus:border-indigo-500 focus:outline-none"
                            placeholder="YYYY-MM-DD"
                        />
                        <p className="text-[10px] text-slate-500">Available tokens: YYYY, MM, DD, ddd, dddd</p>
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs text-slate-500 dark:text-slate-400">Folder Location</label>
                        <select 
                            value={dailyNoteFolderId}
                            onChange={(e) => setDailyNoteFolderId(e.target.value)}
                            className="w-full bg-gray-100 dark:bg-slate-950 text-slate-800 dark:text-slate-200 rounded p-2 text-sm border border-gray-300 dark:border-slate-800 focus:border-indigo-500 focus:outline-none appearance-none"
                        >
                            <option value="">Root (No Folder)</option>
                            {folders.map(f => (
                                <option key={f.id} value={f.id}>{f.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs text-slate-500 dark:text-slate-400">Template</label>
                        <textarea 
                            value={dailyNoteTemplate}
                            onChange={(e) => setDailyNoteTemplate(e.target.value)}
                            className="w-full h-24 bg-gray-100 dark:bg-slate-950 text-slate-800 dark:text-slate-200 rounded p-2 text-sm border border-gray-300 dark:border-slate-800 focus:border-indigo-500 focus:outline-none font-mono"
                            placeholder="# {{title}}"
                        />
                        <p className="text-[10px] text-slate-500">Use {'{{title}}'} for the date title. Use {'{{date+1d:YYYY-MM-DD}}'} for relative dates.</p>
                    </div>
                </div>
            </div>
        </div>
      )}

      {/* Shortcuts Modal (triggered by Ctrl+?) */}
      {showShortcuts && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
           <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowShortcuts(false)}></div>
           <div className="relative bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl shadow-2xl w-full max-w-md p-6">
                <div className="flex items-center justify-between border-b border-gray-200 dark:border-slate-800 pb-4 mb-4">
                    <div className="flex items-center gap-2">
                        <Keyboard size={20} className="text-indigo-600 dark:text-indigo-400" />
                        <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">Keyboard Shortcuts</h2>
                    </div>
                    <button onClick={() => setShowShortcuts(false)} className="text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-white">
                        <X size={20} />
                    </button>
                </div>
                <div className="space-y-3">
                     <ShortcutRow keys={['Ctrl', 'N']} description="Create New Note" />
                     <ShortcutRow keys={['Ctrl', 'D']} description="Open Daily Note" />
                     <ShortcutRow keys={['Ctrl', '\\']} description="Toggle Sidebar" />
                     <ShortcutRow keys={['Ctrl', '?']} description="Show Shortcuts" />
                     <ShortcutRow keys={['Alt', 'T']} description="Toggle Task List" />
                     <ShortcutRow keys={['Ctrl', '[']} description="Go Back" />
                     <ShortcutRow keys={['Ctrl', ']']} description="Go Forward" />
                     <ShortcutRow keys={['Cmd', 'Shift', 'E']} description="Extract Selection" />
                     <ShortcutRow keys={['[[']} description="Trigger Link Autocomplete" />
                </div>
           </div>
        </div>
      )}
      
      {/* Tasks Modal (triggered by Alt+T) */}
      {showTasks && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
             <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={handleCloseTasks}></div>
             <div className="relative bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
                 <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-slate-800 shrink-0">
                     <div className="flex items-center gap-2">
                         <CheckSquare size={20} className="text-indigo-600 dark:text-indigo-400" />
                         <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">All Tasks</h2>
                     </div>
                     <button onClick={handleCloseTasks} className="text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-white">
                         <X size={20} />
                     </button>
                 </div>
                 <div className="flex-1 overflow-y-auto p-4 space-y-6">
                     {allTasks.length === 0 ? (
                         <div className="text-center text-slate-500 dark:text-slate-500 py-8">
                             No tasks found in your notes.
                             <br/><span className="text-xs">Create a task using <code>- [ ]</code> in any note.</span>
                         </div>
                     ) : (
                         allTasks.map(({ note, tasks }) => (
                             <div key={note.id} className="space-y-2">
                                 <div 
                                    className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2 cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                                    onClick={() => {
                                        openNote(note.id);
                                        handleCloseTasks();
                                    }}
                                 >
                                    <FileText size={12} />
                                    {note.title}
                                 </div>
                                 <div className="pl-4 space-y-1">
                                     {tasks.map((task, i) => {
                                         // Show all, but styling differs for completed
                                         return (
                                             <div key={i} className={`flex items-start gap-3 group ${task.isChecked ? 'opacity-40 hover:opacity-100 transition-opacity' : ''}`}>
                                                 <input 
                                                    type="checkbox" 
                                                    checked={task.isChecked} 
                                                    onChange={() => handleToggleTaskFromModal(note.id, task.lineIndex, task.isChecked)}
                                                    className="mt-1 rounded border-gray-400 dark:border-slate-600 bg-transparent transform scale-110 cursor-pointer"
                                                 />
                                                 <span 
                                                    className={`text-sm text-slate-700 dark:text-slate-300 ${task.isChecked ? 'line-through' : ''}`}
                                                    dangerouslySetInnerHTML={{ 
                                                        // Simple markdown rendering for task content (bold, italic, code)
                                                        __html: task.content
                                                            .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
                                                            .replace(/\*(.*?)\*/g, '<i>$1</i>')
                                                            .replace(/`([^`]+)`/g, '<code class="bg-gray-100 dark:bg-slate-800 px-1 rounded text-xs">$1</code>')
                                                            .replace(/\[\[(.*?)\]\]/g, '<span class="text-indigo-600 dark:text-indigo-400 underline">$1</span>')
                                                    }}
                                                 />
                                             </div>
                                         );
                                     })}
                                 </div>
                             </div>
                         ))
                     )}
                 </div>
             </div>
          </div>
      )}

      {/* Confirm Modal */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}></div>
            <div className="relative bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg shadow-xl p-6 max-w-sm w-full">
                <h3 className="text-lg font-bold mb-2 text-slate-900 dark:text-slate-100">Confirm Action</h3>
                <p className="text-slate-600 dark:text-slate-300 mb-6">{confirmModal.message}</p>
                <div className="flex justify-end gap-2">
                    <button 
                        onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                        className="px-4 py-2 text-slate-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded transition-colors"
                    >
                        Cancel
                    </button>
                    <button 
                        onClick={confirmModal.onConfirm}
                        className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
                    >
                        Confirm
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* Input Modal */}
      {inputModal.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setInputModal(prev => ({ ...prev, isOpen: false }))}></div>
            <div className="relative bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg shadow-xl p-6 max-w-sm w-full">
                <h3 className="text-lg font-bold mb-4 text-slate-900 dark:text-slate-100">{inputModal.title}</h3>
                <input
                    autoFocus
                    type="text"
                    className="w-full bg-gray-100 dark:bg-slate-950 border border-gray-300 dark:border-slate-800 rounded p-2 mb-6 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                    value={inputModal.value}
                    onChange={(e) => setInputModal(prev => ({ ...prev, value: e.target.value }))}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') inputModal.onConfirm(inputModal.value);
                        if (e.key === 'Escape') setInputModal(prev => ({ ...prev, isOpen: false }));
                    }}
                />
                <div className="flex justify-end gap-2">
                    <button 
                        onClick={() => setInputModal(prev => ({ ...prev, isOpen: false }))}
                        className="px-4 py-2 text-slate-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded transition-colors"
                    >
                        Cancel
                    </button>
                    <button 
                        onClick={() => inputModal.onConfirm(inputModal.value)}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded transition-colors"
                    >
                        Confirm
                    </button>
                </div>
            </div>
        </div>
      )}

    </div>
  );
}

const EmptyState = ({ onCreate }: { onCreate: () => void }) => (
    <div className="flex flex-col items-center justify-center h-full text-slate-500 dark:text-slate-500 gap-4">
        <div className="bg-gray-100 dark:bg-slate-900 p-4 rounded-full">
            <Columns size={32} className="opacity-50" />
        </div>
        <p>No note selected</p>
        <button 
            onClick={onCreate}
            className="px-4 py-2 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded text-sm transition-colors"
        >
            Create New Note (Ctrl/Cmd + N)
        </button>
    </div>
);

const ShortcutRow = ({ keys, description }: { keys: string[], description: string }) => (
    <div className="flex items-center justify-between">
        <span className="text-sm text-slate-600 dark:text-slate-400">{description}</span>
        <div className="flex gap-1">
            {keys.map(k => (
                <kbd key={k} className="px-2 py-1 bg-gray-100 dark:bg-slate-800 rounded border border-gray-200 dark:border-slate-700 text-xs font-mono text-slate-600 dark:text-slate-300">
                    {k}
                </kbd>
            ))}
        </div>
    </div>
);
