import React, { useState, useRef, useEffect, useMemo } from 'react';
import Sidebar from './components/Sidebar';
import Editor from './components/Editor';
import CommandPalette, { CommandItem } from './components/CommandPalette';
import { Note, Folder, SortField, SortDirection, Theme } from './types';
import { INITIAL_NOTES, INITIAL_FOLDERS } from './constants';
import { Columns, Minimize2, Menu, ChevronLeft, ChevronRight, X, Moon, Sun, Monitor, Type, PanelLeft, Calendar, Plus, Keyboard, CheckSquare, Cloud, RefreshCw, LogOut, FileText, Clock, ArrowDownAz, ArrowUp, ArrowDown, Check, AlertCircle, Shuffle, Eye, Bookmark, Terminal } from 'lucide-react';
import { getDropboxAuthUrl, parseAuthTokenFromUrl, syncDropboxData, getNotePath, getFolderPath, RenameOperation, exchangeCodeForToken } from './utils/dropboxService';

const generateId = () => Math.random().toString(36).substr(2, 9);
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// Local Storage Keys
const LS_KEY_NOTES = 'rhizonote_notes';
const LS_KEY_FOLDERS = 'rhizonote_folders';
const LS_KEY_THEME = 'rhizonote_theme';
const LS_KEY_DB_TOKEN = 'rhizonote_dropbox_token'; // Legacy / Short term
const LS_KEY_DB_REFRESH_TOKEN = 'rhizonote_dropbox_refresh_token'; // Long term
const LS_KEY_PANES = 'rhizonote_panes';
const LS_KEY_ACTIVE_PANE = 'rhizonote_active_pane';
const LS_KEY_SORT = 'rhizonote_sort';
const LS_KEY_EXPANDED = 'rhizonote_expanded';
const LS_KEY_UI_SETTINGS = 'rhizonote_ui_settings';
const LS_KEY_DAILY_PREFS = 'rhizonote_daily_prefs';
const LS_KEY_DELETED_PATHS = 'rhizonote_deleted_paths';
const LS_KEY_PENDING_RENAMES = 'rhizonote_pending_renames';

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

interface ConfirmModalState {
    isOpen: boolean;
    message: string;
    onConfirm: () => void;
}
  
interface InputModalState {
    isOpen: boolean;
    title: string;
    value: string;
    onConfirm: (val: string) => void;
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
  
  // Track deleted paths (notes/folders) for sync deletion
  const [deletedPaths, setDeletedPaths] = useState<string[]>(() => {
      const saved = localStorage.getItem(LS_KEY_DELETED_PATHS);
      return saved ? JSON.parse(saved) : [];
  });
  
  // Track renames/moves: { from: 'old/path', to: 'new/path' }
  const [pendingRenames, setPendingRenames] = useState<RenameOperation[]>(() => {
      const saved = localStorage.getItem(LS_KEY_PENDING_RENAMES);
      return saved ? JSON.parse(saved) : [];
  });

  // Helper to queue renames intelligently
  // If A -> B exists, and we rename B -> C, we update the existing entry to A -> C
  const queueRename = (from: string, to: string) => {
      setPendingRenames(prev => {
          // Check if 'from' is the destination of a previous rename
          const existingIdx = prev.findIndex(op => op.to === from);
          
          if (existingIdx > -1) {
              // Modify existing op (A -> B becomes A -> C)
              const newRenames = [...prev];
              newRenames[existingIdx] = { ...newRenames[existingIdx], to };
              return newRenames;
          } else {
              // Add new op
              return [...prev, { from, to }];
          }
      });
  };

  // Settings State
  const [theme, setTheme] = useState<Theme>(() => {
      return (localStorage.getItem(LS_KEY_THEME) as Theme) || 'dark';
  });

  const uiSettings = useMemo(() => {
      try {
          return JSON.parse(localStorage.getItem(LS_KEY_UI_SETTINGS) || '{}');
      } catch { return {}; }
  }, []);

  const [fontSize, setFontSize] = useState<number>(uiSettings.fontSize || 16);
  const [showSettings, setShowSettings] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showTasks, setShowTasks] = useState(uiSettings.showTasks || false);
  const [autoSync, setAutoSync] = useState(uiSettings.autoSync ?? true);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  // Dropbox State
  const [dropboxToken, setDropboxToken] = useState<string | null>(() => localStorage.getItem(LS_KEY_DB_TOKEN));
  const [dropboxRefreshToken, setDropboxRefreshToken] = useState<string | null>(() => localStorage.getItem(LS_KEY_DB_REFRESH_TOKEN));
  
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [syncMessage, setSyncMessage] = useState('');

  // 未同期の変更を追跡
  const unsyncedNoteIds = useRef<Set<string>>(new Set());
  
  // 最終編集時刻を追跡（自動同期の抑制に使用）
  const lastEditTimeRef = useRef<number>(0);

  const [recentlyCompletedTasks, setRecentlyCompletedTasks] = useState<Set<string>>(new Set());

  const dailyPrefs = useMemo(() => {
      try {
          return JSON.parse(localStorage.getItem(LS_KEY_DAILY_PREFS) || '{}');
      } catch { return {}; }
  }, []);

  const [dailyNoteFormat, setDailyNoteFormat] = useState(dailyPrefs.format || 'YYYY-MM-DD');
  const [dailyNoteFolderId, setDailyNoteFolderId] = useState<string>(dailyPrefs.folderId || ''); 
  const [dailyNoteTemplate, setDailyNoteTemplate] = useState(dailyPrefs.template || '# {{title}}\n\n<< [[{{date-1d:YYYY-MM-DD}}]] | [[{{date+1d:YYYY-MM-DD}}]] >>\n\n## Tasks\n- [ ] ');

  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>({ isOpen: false, message: '', onConfirm: () => {} });
  const [inputModal, setInputModal] = useState<InputModalState>({ isOpen: false, title: '', value: '', onConfirm: () => {} });

  const [sortField, setSortField] = useState<SortField>(() => {
      const saved = localStorage.getItem(LS_KEY_SORT);
      return saved ? JSON.parse(saved).field : 'updated';
  });
  const [sortDirection, setSortDirection] = useState<SortDirection>(() => {
      const saved = localStorage.getItem(LS_KEY_SORT);
      return saved ? JSON.parse(saved).direction : 'desc';
  });

  const [expandedFolderIds, setExpandedFolderIds] = useState<string[]>(() => {
      const saved = localStorage.getItem(LS_KEY_EXPANDED);
      if (saved) return JSON.parse(saved);
      return INITIAL_FOLDERS.map(f => f.id);
  });
  
  const [sidebarWidth, setSidebarWidth] = useState(uiSettings.sidebarWidth || 256);
  const [splitRatio, setSplitRatio] = useState(uiSettings.splitRatio || 0.5);
  const isResizingSidebar = useRef(false);
  const isResizingSplit = useRef(false);

  const [panes, setPanes] = useState<(string | null)[]>(() => {
      const saved = localStorage.getItem(LS_KEY_PANES);
      return saved ? JSON.parse(saved) : ['1', null];
  }); 
  const [history, setHistory] = useState<PaneHistory[]>([
      { stack: ['1'], currentIndex: 0 },
      { stack: [], currentIndex: -1 }
  ]);

  const [activePaneIndex, setActivePaneIndex] = useState<number>(() => {
      const saved = localStorage.getItem(LS_KEY_ACTIVE_PANE);
      return saved ? parseInt(saved, 10) : 0;
  });
  
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(uiSettings.sidebarVisible ?? true);

  const activeNoteId = panes[activePaneIndex];

  // Gesture State for Edge Swipe
  const touchStartRef = useRef<{ x: number, y: number } | null>(null);

  // LocalStorage Effects
  useEffect(() => {
    localStorage.setItem(LS_KEY_NOTES, JSON.stringify(notes));
  }, [notes]);

  useEffect(() => {
    localStorage.setItem(LS_KEY_FOLDERS, JSON.stringify(folders));
  }, [folders]);

  useEffect(() => {
      localStorage.setItem(LS_KEY_DELETED_PATHS, JSON.stringify(deletedPaths));
  }, [deletedPaths]);

  useEffect(() => {
      localStorage.setItem(LS_KEY_PENDING_RENAMES, JSON.stringify(pendingRenames));
  }, [pendingRenames]);

  useEffect(() => {
    localStorage.setItem(LS_KEY_THEME, theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(LS_KEY_PANES, JSON.stringify(panes));
  }, [panes]);

  useEffect(() => {
    localStorage.setItem(LS_KEY_ACTIVE_PANE, activePaneIndex.toString());
  }, [activePaneIndex]);

  useEffect(() => {
      localStorage.setItem(LS_KEY_SORT, JSON.stringify({ field: sortField, direction: sortDirection }));
  }, [sortField, sortDirection]);

  useEffect(() => {
      localStorage.setItem(LS_KEY_EXPANDED, JSON.stringify(expandedFolderIds));
  }, [expandedFolderIds]);

  useEffect(() => {
      const settings = {
          fontSize,
          sidebarWidth,
          splitRatio,
          sidebarVisible,
          showTasks,
          autoSync
      };
      localStorage.setItem(LS_KEY_UI_SETTINGS, JSON.stringify(settings));
  }, [fontSize, sidebarWidth, splitRatio, sidebarVisible, showTasks, autoSync]);

  useEffect(() => {
      const prefs = {
          format: dailyNoteFormat,
          folderId: dailyNoteFolderId,
          template: dailyNoteTemplate
      };
      localStorage.setItem(LS_KEY_DAILY_PREFS, JSON.stringify(prefs));
  }, [dailyNoteFormat, dailyNoteFolderId, dailyNoteTemplate]);

  // Cleanup expired trash on mount
  useEffect(() => {
      cleanupExpiredTrash();
  }, []); // Run once on mount

  const cleanupExpiredTrash = () => {
      const now = Date.now();
      
      // Find expired items
      const expiredNotes = notes.filter(n => n.deletedAt && (now - n.deletedAt > THIRTY_DAYS_MS));
      const expiredFolders = folders.filter(f => f.deletedAt && (now - f.deletedAt > THIRTY_DAYS_MS));

      if (expiredNotes.length === 0 && expiredFolders.length === 0) return;

      const newDeletedPaths = [...deletedPaths];

      // Queue paths for permanent deletion
      expiredNotes.forEach(n => {
          newDeletedPaths.push(getNotePath(n.title, n.folderId, folders));
      });
      expiredFolders.forEach(f => {
          newDeletedPaths.push(getFolderPath(f.id, folders));
      });

      setDeletedPaths(newDeletedPaths);

      // Remove from state
      setNotes(prev => prev.filter(n => !n.deletedAt || (now - n.deletedAt <= THIRTY_DAYS_MS)));
      setFolders(prev => prev.filter(f => !f.deletedAt || (now - f.deletedAt <= THIRTY_DAYS_MS)));
  };

  // Guard against double firing in strict mode
  const authCodeProcessed = useRef(false);

  // Dropbox Auth Check & Code Handling
  useEffect(() => {
      const handleAuth = async () => {
          // Check for Authorization Code (PKCE Flow)
          const urlParams = new URLSearchParams(window.location.search);
          const code = urlParams.get('code');
          
          if (code) {
              // Prevent double execution
              if (authCodeProcessed.current) return;
              authCodeProcessed.current = true;

              setSyncStatus('syncing');
              setSyncMessage('Completing login...');
              setShowSettings(true);
              
              try {
                  const data = await exchangeCodeForToken(code);
                  const { access_token, refresh_token } = data.result;

                  if (access_token) {
                      setDropboxToken(access_token);
                      localStorage.setItem(LS_KEY_DB_TOKEN, access_token);
                  }
                  
                  if (refresh_token) {
                      setDropboxRefreshToken(refresh_token);
                      localStorage.setItem(LS_KEY_DB_REFRESH_TOKEN, refresh_token);
                  }
                  
                  setSyncStatus('success');
                  setSyncMessage('Dropbox connected successfully!');
                  setTimeout(() => setSyncStatus('idle'), 3000);
              } catch (e: any) {
                  console.error('Failed to exchange token', e);
                  setSyncStatus('error');
                  setSyncMessage(`Login failed: ${e.message || 'Unknown error'}`);
              } finally {
                  // Always clear URL parameters to keep it clean
                  window.history.replaceState({}, document.title, window.location.pathname);
              }
              return;
          }

          // Legacy / Fallback Check
          const legacyToken = parseAuthTokenFromUrl();
          if (legacyToken) {
              setDropboxToken(legacyToken);
              localStorage.setItem(LS_KEY_DB_TOKEN, legacyToken);
              window.location.hash = ''; 
              setShowSettings(true); 
              setSyncStatus('success');
              setSyncMessage('Dropbox connected (Legacy)');
              setTimeout(() => setSyncStatus('idle'), 3000);
          }
      };

      handleAuth();
  }, []);

  const handleConnectDropbox = async () => {
      try {
        const url = await getDropboxAuthUrl();
        window.location.href = url;
      } catch (e) {
          console.error(e);
          alert('Failed to initialize Dropbox login.');
      }
  };

  const handleDisconnectDropbox = () => {
      setDropboxToken(null);
      setDropboxRefreshToken(null);
      localStorage.removeItem(LS_KEY_DB_TOKEN);
      localStorage.removeItem(LS_KEY_DB_REFRESH_TOKEN);
      setSyncMessage('');
  };

  const handleSync = async () => {
      if (!dropboxToken && !dropboxRefreshToken) {
          if (confirm("Dropbox is not connected. Open settings?")) {
            setShowSettings(true);
          }
          return;
      }
      
      setSyncStatus('syncing');
      setSyncMessage('Syncing changes...');
      
      try {
          // ✅ Capture latest state at sync time
          let latestNotes: Note[] = [];
          let latestFolders: Folder[] = [];
          
          // Use functional setState to get current values
          await new Promise<void>(resolve => {
              setNotes(current => {
                  latestNotes = current;
                  return current;
              });
              setFolders(current => {
                  latestFolders = current;
                  resolve();
                  return current;
              });
          });
          
          const auth = {
              accessToken: dropboxToken,
              refreshToken: dropboxRefreshToken
          };

          const data = await syncDropboxData(
              auth, 
              latestNotes,
              latestFolders, 
              deletedPaths, 
              pendingRenames,
              unsyncedNoteIds.current
          );
          
          if (data) {
              setNotes(data.notes);
              setFolders(data.folders);
              setDeletedPaths([]);
              setPendingRenames([]);
              
              unsyncedNoteIds.current.clear();
              setSyncStatus('success');
              setSyncMessage(`Synced at ${new Date().toLocaleTimeString()}. ${data.syncLog.length} changes.`);
          }
      } catch (e) {
          console.error(e);
          setSyncStatus('error');
          setSyncMessage('Sync failed. Check console.');
      }
      setTimeout(() => { if(syncStatus !== 'error') setSyncStatus('idle'); }, 4000);
  };

  // 同期中フラグと最終同期時刻をRefで管理
  const isSyncingRef = useRef(false);
  const lastSyncTimeRef = useRef<number>(0);

  // Auto-sync on visibility change and periodic sync
  useEffect(() => {
      if (!autoSync || (!dropboxToken && !dropboxRefreshToken)) return;

      let intervalId: number | undefined;
      const MIN_SYNC_INTERVAL = 30 * 1000; // 最低30秒間隔（レート制限対策）

      const syncIfNeeded = async () => {
          const now = Date.now();
          const timeSinceLastSync = now - lastSyncTimeRef.current;
          const timeSinceLastEdit = now - lastEditTimeRef.current;

          // 既に同期中なら何もしない
          if (isSyncingRef.current) {
              return;
          }

          // 執筆中（最後の編集から5秒以内）は自動同期しない
          if (timeSinceLastEdit < 5000) {
              return;
          }

          // 最後の同期から30秒経っていなければスキップ
          if (timeSinceLastSync < MIN_SYNC_INTERVAL) {
              return;
          }

          isSyncingRef.current = true;
          lastSyncTimeRef.current = now;
          
          try {
              await handleSync();
          } catch (error) {
              console.error('Auto-sync failed:', error);
          } finally {
              setTimeout(() => {
                  isSyncingRef.current = false;
              }, 2000);
          }
      };

      // 1. ページが表示されたときに同期
      const handleVisibilityChange = () => {
          if (document.visibilityState === 'visible') {
              syncIfNeeded();
          }
      };

      // 2. ウィンドウがフォーカスされたときに同期
      const handleFocus = () => {
          syncIfNeeded();
      };

      // 3. 定期的な自動同期（5分ごと）
      intervalId = window.setInterval(() => {
          syncIfNeeded();
      }, 5 * 60 * 1000);

      // イベントリスナー登録
      document.addEventListener('visibilitychange', handleVisibilityChange);
      window.addEventListener('focus', handleFocus);

      // 初回同期
      const initialSyncTimeout = setTimeout(() => {
          syncIfNeeded();
      }, 1500);

      // クリーンアップ
      return () => {
          if (intervalId) clearInterval(intervalId);
          clearTimeout(initialSyncTimeout);
          document.removeEventListener('visibilitychange', handleVisibilityChange);
          window.removeEventListener('focus', handleFocus);
      };
  }, [autoSync, dropboxToken, dropboxRefreshToken]);

  // Extract all tasks from all notes (Memoized)
  const allTasks = useMemo<NoteTasks[]>(() => {
      const result: NoteTasks[] = [];
      // Only show tasks from non-deleted notes
      notes.filter(n => !n.deletedAt).forEach(note => {
          const noteTasks: ExtractedTask[] = [];
          note.content.split('\n').forEach((line, idx) => {
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
      setRecentlyCompletedTasks(new Set());
  };

  const handleToggleTaskFromModal = (noteId: string, lineIndex: number, currentChecked: boolean) => {
      lastEditTimeRef.current = Date.now();
      if (!currentChecked) {
          setRecentlyCompletedTasks((prev: Set<string>) => {
              const newSet = new Set(prev);
              newSet.add(`${noteId}-${lineIndex}`);
              return newSet;
          });
      }

      setNotes((prev: Note[]) => prev.map(note => {
          if (note.id !== noteId) return note;

          const lines = note.content.split('\n');
          if (lineIndex >= lines.length) return note; 

          const line = lines[lineIndex];
          const newStatus = currentChecked ? '[ ]' : '[x]';
          const newLine = line.replace(/\[([ x])\]/, newStatus);
          lines[lineIndex] = newLine;

          return { ...note, content: lines.join('\n'), updatedAt: Date.now() };
      }));
  };

  const openNote = (id: string) => {
    setPanes(prev => {
        const newPanes = [...prev];
        newPanes[activePaneIndex] = id;
        return newPanes;
    });
    // Update history
    setHistory(prev => {
        const newHistory = [...prev];
        if (!newHistory[activePaneIndex]) {
            newHistory[activePaneIndex] = { stack: [], currentIndex: -1 };
        }
        const paneHist = newHistory[activePaneIndex];
        // If stack is empty, just push
        if (paneHist.currentIndex === -1) {
             newHistory[activePaneIndex] = { stack: [id], currentIndex: 0 };
        } else {
            const current = paneHist.stack[paneHist.currentIndex];
            if (current !== id) {
                const newStack = paneHist.stack.slice(0, paneHist.currentIndex + 1);
                newStack.push(id);
                newHistory[activePaneIndex] = {
                    stack: newStack,
                    currentIndex: newStack.length - 1
                };
            }
        }
        return newHistory;
    });
    
    if (window.innerWidth < 768) {
        setMobileMenuOpen(false);
    }
  };

  const handleCreateNote = () => {
    lastEditTimeRef.current = Date.now();
    const newNote: Note = {
      id: generateId(),
      folderId: null, 
      title: '',
      content: '',
      isBookmarked: false,
      updatedAt: Date.now(),
      createdAt: Date.now(),
    };
    setNotes((prev: Note[]) => [newNote, ...prev]);
    
    // 未同期変更をマーク
    unsyncedNoteIds.current.add(newNote.id);
    
    openNote(newNote.id);
    setMobileMenuOpen(false); 
  };

  const handleCreateSpecificNote = (title: string, content: string) => {
    lastEditTimeRef.current = Date.now();
    const newNote: Note = {
        id: generateId(),
        folderId: null,
        title: title,
        content: content,
        isBookmarked: false,
        updatedAt: Date.now(),
        createdAt: Date.now(),
    };
    setNotes((prev: Note[]) => [newNote, ...prev]);
    
    // 未同期変更をマーク
    unsyncedNoteIds.current.add(newNote.id);
  };

  const handleOpenDailyNote = () => {
    const todayTitle = formatDate(new Date(), dailyNoteFormat);
    const targetFolderId = dailyNoteFolderId && folders.find(f => f.id === dailyNoteFolderId) ? dailyNoteFolderId : null;
    const existingNote = notes.find(n => n.title === todayTitle && n.folderId === targetFolderId && !n.deletedAt);

    if (existingNote) {
        openNote(existingNote.id);
    } else {
        lastEditTimeRef.current = Date.now();
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
        setNotes((prev: Note[]) => [newNote, ...prev]);
        openNote(newNote.id);
    }
    setMobileMenuOpen(false);
  };

  const handleOpenRandomNote = () => {
    const activeNotes = notes.filter(n => !n.deletedAt);
    if (activeNotes.length > 0) {
        const randomIndex = Math.floor(Math.random() * activeNotes.length);
        const randomNote = activeNotes[randomIndex];
        openNote(randomNote.id);
    }
  };

  const handleCreateFolder = (parentId: string | null = null) => {
    setInputModal({
        isOpen: true,
        title: 'New Folder Name',
        value: '',
        onConfirm: (name) => {
            if (name) {
                const newFolder = { 
                    id: generateId(), 
                    name, 
                    parentId, 
                    createdAt: Date.now() 
                };
                setFolders((prev: Folder[]) => [...prev, newFolder]);
                if (parentId) {
                    setExpandedFolderIds((prev: string[]) => prev.includes(parentId) ? prev : [...prev, parentId]);
                }
                setExpandedFolderIds((prev: string[]) => [...prev, newFolder.id]);
            }
            setInputModal({ isOpen: false, title: '', value: '', onConfirm: () => {} });
        }
    });
  };

  const handleToggleFolderExpand = (folderId: string) => {
      setExpandedFolderIds(prev => 
          prev.includes(folderId) 
              ? prev.filter(id => id !== folderId) 
              : [...prev, folderId]
      );
  };

  const handleRenameFolder = (id: string) => {
    const folder = folders.find(f => f.id === id);
    if (!folder) return;

    setInputModal({
        isOpen: true,
        title: 'Rename Folder',
        value: folder.name,
        onConfirm: (newName) => {
            if (newName && newName !== folder.name) {
                // Queue Rename logic
                // For folders, getFolderPath uses the *current* state.
                const oldPath = getFolderPath(id, folders);
                
                // Simulate new state to calculate new path
                const simulatedFolders = folders.map(f => f.id === id ? { ...f, name: newName } : f);
                const newPath = getFolderPath(id, simulatedFolders);
                
                if (oldPath !== newPath) {
                    queueRename(oldPath, newPath);
                }

                setFolders((prev: Folder[]) => prev.map(f => f.id === id ? { ...f, name: newName } : f));
            }
            setInputModal({ isOpen: false, title: '', value: '', onConfirm: () => {} });
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

  // Modified to "Soft Delete" (Move to Trash)
  const handleDeleteFolder = (id: string) => {
    const folder = folders.find(f => f.id === id);
    const name = folder ? folder.name : 'this folder';
    
    setConfirmModal({
        isOpen: true,
        message: `Move folder "${name}" and its contents to trash?`,
        onConfirm: () => {
            const now = Date.now();
            const descendantIds = getDescendantFolderIds(id, folders);
            const allAffectedFolderIds = [id, ...descendantIds];

            setFolders(prev => prev.map(f => 
                allAffectedFolderIds.includes(f.id) ? { ...f, deletedAt: now } : f
            ));
            
            setNotes(prev => prev.map(n => 
                (n.folderId && allAffectedFolderIds.includes(n.folderId)) ? { ...n, deletedAt: now, updatedAt: now } : n
            ));

            // Close affected panes
            const deletedNoteIds = notes
                .filter(n => n.folderId && allAffectedFolderIds.includes(n.folderId))
                .map(n => n.id);
            setPanes(prev => prev.map(pid => (pid && deletedNoteIds.includes(pid)) ? null : pid));

            setConfirmModal({ isOpen: false, message: '', onConfirm: () => {} });
        }
    });
  };

  // Modified to "Soft Delete" (Move to Trash)
  const handleDeleteNote = (id: string) => {
    const noteToDelete = notes.find(n => n.id === id);
    const title = noteToDelete ? noteToDelete.title : 'this note';
    setConfirmModal({
        isOpen: true,
        message: `Move note "${title}" to trash?`,
        onConfirm: () => {
            const now = Date.now();
            setNotes(prev => prev.map(n => n.id === id ? { ...n, deletedAt: now, updatedAt: now } : n));
            setPanes(prev => prev.map(paneId => paneId === id ? null : paneId));
            setConfirmModal({ isOpen: false, message: '', onConfirm: () => {} });
        }
    });
  };

  const handlePermanentDeleteFolder = (id: string) => {
      const descendantIds = getDescendantFolderIds(id, folders);
      const allAffectedFolderIds = [id, ...descendantIds];
      
      // Queue for deletion
      const newDeletedPaths = [...deletedPaths];
      allAffectedFolderIds.forEach(fid => {
           newDeletedPaths.push(getFolderPath(fid, folders));
      });
      // Notes in these folders are also implicitly deleted on Dropbox if the parent folder is deleted,
      // but explicitly adding them is safer if the structure flattened somehow, though for folder deletion simply deleting the root folder path is usually enough.
      // However, to keep state clean, let's just delete the top folder path.
      // Wait, getFolderPath depends on state. We must calculate path BEFORE removing from state.
      const topPath = getFolderPath(id, folders);
      setDeletedPaths(prev => [...prev, topPath]);
      
      setFolders(prev => prev.filter(f => !allAffectedFolderIds.includes(f.id)));
      setNotes(prev => prev.filter(n => !n.folderId || !allAffectedFolderIds.includes(n.folderId)));
  };

  const handlePermanentDeleteNote = (id: string) => {
      const note = notes.find(n => n.id === id);
      if (note) {
          const path = getNotePath(note.title, note.folderId, folders);
          setDeletedPaths(prev => [...prev, path]);
          setNotes(prev => prev.filter(n => n.id !== id));
      }
  };

  const handleRestoreNote = (id: string) => {
      setNotes(prev => prev.map(n => n.id === id ? { ...n, deletedAt: undefined, updatedAt: Date.now() } : n));
  };

  const handleRestoreFolder = (id: string) => {
      // Restore folder and all its contents
      const descendantIds = getDescendantFolderIds(id, folders);
      const allAffectedFolderIds = [id, ...descendantIds];

      setFolders(prev => prev.map(f => 
        allAffectedFolderIds.includes(f.id) ? { ...f, deletedAt: undefined } : f
      ));
      
      setNotes(prev => prev.map(n => 
        (n.folderId && allAffectedFolderIds.includes(n.folderId)) ? { ...n, deletedAt: undefined, updatedAt: Date.now() } : n
      ));
  };

  const handleToggleBookmark = (id: string) => {
    setNotes((prev: Note[]) => {
        const note = prev.find(n => n.id === id);
        if (!note) return prev;
        if (note.isBookmarked) {
            return prev.map(n => n.id === id ? { ...n, isBookmarked: false, bookmarkOrder: undefined } : n);
        } else {
            const maxOrder = Math.max(0, ...prev.filter(n => n.isBookmarked).map(n => n.bookmarkOrder || 0));
            return prev.map(n => n.id === id ? { ...n, isBookmarked: true, bookmarkOrder: maxOrder + 1 } : n);
        }
    });
  };

  const handleReorderBookmark = (draggedId: string, targetId: string) => {
    setNotes((prev: Note[]) => {
        const bookmarked = prev.filter(n => n.isBookmarked).sort((a, b) => (a.bookmarkOrder || 0) - (b.bookmarkOrder || 0));
        const draggedIndex = bookmarked.findIndex(n => n.id === draggedId);
        const targetIndex = bookmarked.findIndex(n => n.id === targetId);

        if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) return prev;

        const item = bookmarked[draggedIndex];
        const newOrderList = [...bookmarked];
        newOrderList.splice(draggedIndex, 1);
        newOrderList.splice(targetIndex, 0, item);

        const orderMap = new Map();
        newOrderList.forEach((n, idx) => orderMap.set(n.id, idx));

        return prev.map(n => {
            if (orderMap.has(n.id)) {
                return { ...n, bookmarkOrder: orderMap.get(n.id) };
            }
            return n;
        });
    });
  };

  const handleUpdateNote = (id: string, updates: Partial<Note>) => {
    lastEditTimeRef.current = Date.now();
    setNotes((prev: Note[]) => {
        const oldNote = prev.find(n => n.id === id);
        if (!oldNote) return prev;
        
        // Handle Rename/Move: Queue RENAME (Move) instead of Delete+Create
        if (
            (updates.title && updates.title !== oldNote.title) || 
            (updates.folderId !== undefined && updates.folderId !== oldNote.folderId)
        ) {
             const oldPath = getNotePath(oldNote.title, oldNote.folderId, folders);
             
             // Calculate new path based on updates merging with old state
             const newTitle = updates.title !== undefined ? updates.title : oldNote.title;
             const newFolderId = updates.folderId !== undefined ? updates.folderId : oldNote.folderId;
             const newPath = getNotePath(newTitle, newFolderId, folders);

             if (oldPath !== newPath) {
                 queueRename(oldPath, newPath);
             }
        }

        // Mark as unsynced
        unsyncedNoteIds.current.add(id);

        return prev.map(n => n.id === id ? { ...n, ...updates, updatedAt: Date.now() } : n);
    });
  };

  const handleMoveNote = (noteId: string, folderId: string | null) => {
      handleUpdateNote(noteId, { folderId });
  };

  const handleMoveFolder = (folderId: string, parentId: string | null) => {
      // Prevent circular moves
      if (folderId === parentId) return;
      
      // Check if parentId is a descendant of folderId
      const isDescendant = (parent: string | null, target: string): boolean => {
          if (!parent) return false;
          if (parent === target) return true;
          const pFolder = folders.find(f => f.id === parent);
          return pFolder ? isDescendant(pFolder.parentId, target) : false;
      };

      if (parentId && isDescendant(parentId, folderId)) {
          alert("Cannot move a folder into its own descendant.");
          return;
      }

      setFolders(prev => {
          const folder = prev.find(f => f.id === folderId);
          if (!folder) return prev;
          
          const oldPath = getFolderPath(folderId, prev);
          
          // Simulate state for new path
          const tempFolders = prev.map(f => f.id === folderId ? { ...f, parentId } : f);
          const newPath = getFolderPath(folderId, tempFolders);
          
          if (oldPath !== newPath) {
              queueRename(oldPath, newPath);
          }
          
          return prev.map(f => f.id === folderId ? { ...f, parentId } : f);
      });
  };

  const handleRefactorLinks = (oldTitle: string, newTitle: string) => {
      if (oldTitle === newTitle) return;
      
      lastEditTimeRef.current = Date.now();
      const regex = new RegExp(`\\[\\[${oldTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\]`, 'g');
      const newLink = `[[${newTitle}]]`;
      
      setNotes(prev => prev.map(n => {
          if (n.content.match(regex)) {
              unsyncedNoteIds.current.add(n.id);
              return {
                  ...n,
                  content: n.content.replace(regex, newLink),
                  updatedAt: Date.now()
              };
          }
          return n;
      }));
  };
  
  const handleLinkClick = (title: string) => {
      const target = notes.find(n => n.title === title && !n.deletedAt);
      if (target) {
          openNote(target.id);
      } else {
          // Create new note with this title and open it
          lastEditTimeRef.current = Date.now();
          const newNote: Note = {
              id: generateId(),
              folderId: null,
              title: title,
              content: `# ${title}\n`,
              isBookmarked: false,
              updatedAt: Date.now(),
              createdAt: Date.now()
          };
          setNotes(prev => [newNote, ...prev]);
          unsyncedNoteIds.current.add(newNote.id);
          openNote(newNote.id);
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
          setHistory((prev: PaneHistory[]) => {
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
          setHistory((prev: PaneHistory[]) => {
              const newH = [...prev];
              newH[activePaneIndex] = { ...hist, currentIndex: newIndex };
              return newH;
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
      setHistory((prev: PaneHistory[]) => {
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

  const handleTogglePreview = () => {
     window.dispatchEvent(new Event('rhizonote-toggle-preview'));
  };

  const getNoteById = (id: string | null) => notes.find((n) => n.id === id);

  const canGoBack = history[activePaneIndex]?.currentIndex > 0;
  const canGoForward = history[activePaneIndex]?.currentIndex < (history[activePaneIndex]?.stack.length - 1);

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
          const availableWidth = window.innerWidth - (sidebarVisible ? sidebarWidth : 0);
          const relativeX = e.clientX - (sidebarVisible ? sidebarWidth : 0);
          const newRatio = relativeX / availableWidth;
          if (newRatio > 0.2 && newRatio < 0.8) {
              setSplitRatio(newRatio);
          }
      }
  };

  // Edge Swipe Handler
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY
    };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
      if (!touchStartRef.current) return;
      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;
      const deltaX = touchEndX - touchStartRef.current.x;
      const deltaY = Math.abs(touchEndY - touchStartRef.current.y);
      if (touchStartRef.current.x < 40 && deltaX > 50 && deltaY < 50) {
          setMobileMenuOpen(true);
      }
      touchStartRef.current = null;
  };

  const shortcutHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});

  useEffect(() => {
    shortcutHandlerRef.current = (e: KeyboardEvent) => {
        // Respect if default was prevented by child components (e.g. Editor Ctrl+[)
        if (e.defaultPrevented) return;

        const isMod = e.metaKey || e.ctrlKey;
        if ((isMod && e.key === '[') || (e.altKey && e.key === 'ArrowLeft')) {
            e.preventDefault();
            goBack();
        } else if ((isMod && e.key === ']') || (e.altKey && e.key === 'ArrowRight')) {
            e.preventDefault();
            goForward();
        }
        if (isMod && e.altKey && e.key.toLowerCase() === 'n') {
            e.preventDefault();
            handleCreateNote();
        }
        if (isMod && e.key.toLowerCase() === 'd') {
            e.preventDefault();
            handleOpenDailyNote();
        }
        if (e.altKey && e.key.toLowerCase() === 'r') {
            e.preventDefault();
            handleOpenRandomNote();
        }
        if (isMod && e.key.toLowerCase() === 's') {
            e.preventDefault(); 
            handleSync();
        }
        if (isMod && e.key === '\\') {
            e.preventDefault();
            setSidebarVisible((prev: boolean) => !prev);
        }
        if (isMod && (e.key === '?' || e.key === '/')) {
            e.preventDefault();
            setShowShortcuts((prev: boolean) => !prev);
        }
        if (e.altKey && e.key.toLowerCase() === 't') {
            e.preventDefault();
            setShowTasks((prev: boolean) => {
                if (prev) {
                    return false;
                }
                return true;
            });
        }
        if (isMod && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            setIsCommandPaletteOpen(prev => !prev);
        }
    };
  }); 

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (shortcutHandlerRef.current) {
            shortcutHandlerRef.current(e);
        }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const getSortIcon = (field: SortField) => {
      if (sortField !== field) return null;
      return sortDirection === 'asc' ? <ArrowUp size={12} className="ml-1" /> : <ArrowDown size={12} className="ml-1" />;
  };

  const SortButton = ({ field, icon: Icon, label }: { field: SortField, icon: any, label: string }) => (
     <button
        onClick={() => {
            if (sortField === field) {
                setSortDirection((prev: SortDirection) => prev === 'asc' ? 'desc' : 'asc');
            } else {
                setSortField(field);
                setSortDirection(field === 'name' ? 'asc' : 'desc');
            }
        }}
        className={`flex-1 flex items-center justify-center py-2 rounded-md text-sm font-medium transition-colors ${sortField === field ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 shadow-sm border border-indigo-200 dark:border-indigo-800' : 'bg-gray-100 dark:bg-slate-950 text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}
        title={`Sort by ${label}`}
     >
        <div className="flex items-center">
            <Icon size={16} className="mr-2"/>
            {label}
            {sortField === field && getSortIcon(field)}
        </div>
     </button>
  );

  const commands: CommandItem[] = useMemo(() => {
    const baseCommands: CommandItem[] = [
        { id: 'new-note', label: 'Create New Note', icon: <Plus size={16}/>, action: handleCreateNote, shortcut: 'Ctrl+Alt+N', group: 'Actions' },
        { id: 'daily-note', label: 'Open Daily Note', icon: <Calendar size={16}/>, action: handleOpenDailyNote, shortcut: 'Ctrl+D', group: 'Actions' },
        { id: 'random-note', label: 'Open Random Note', icon: <Shuffle size={16}/>, action: handleOpenRandomNote, shortcut: 'Alt+R', group: 'Actions' },
        { id: 'toggle-preview', label: 'Toggle Edit/Preview', icon: <Eye size={16}/>, action: handleTogglePreview, shortcut: 'Ctrl+E', group: 'View' },
        { id: 'split-view', label: 'Toggle Split View', icon: <Columns size={16}/>, action: toggleSplitView, group: 'View' },
        { id: 'sync', label: 'Start Sync', icon: <RefreshCw size={16}/>, action: handleSync, shortcut: 'Ctrl+S', group: 'System' },
        { id: 'tasks', label: 'Show Tasks', icon: <CheckSquare size={16}/>, action: () => setShowTasks(true), shortcut: 'Alt+T', group: 'View' },
        { id: 'settings', label: 'Open Settings', icon: <Terminal size={16}/>, action: () => setShowSettings(true), group: 'System' },
    ];

    const bookmarkCommands: CommandItem[] = notes
        .filter(n => n.isBookmarked && !n.deletedAt)
        .sort((a, b) => (a.bookmarkOrder || 0) - (b.bookmarkOrder || 0))
        .map(n => ({
            id: `bookmark-${n.id}`,
            label: n.title,
            icon: <Bookmark size={16} />,
            action: () => openNote(n.id),
            group: 'Bookmarks'
        }));

    return [...baseCommands, ...bookmarkCommands];
  }, [notes, handleCreateNote, handleOpenDailyNote, handleOpenRandomNote, toggleSplitView, handleSync]);

  return (
    <div 
        className={`flex h-screen w-screen overflow-hidden font-sans bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 transition-colors duration-200`}
        onMouseMove={handleMouseMove}
        onMouseUp={stopResizing}
        onMouseLeave={stopResizing}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
    >
      <CommandPalette 
        isOpen={isCommandPaletteOpen} 
        onClose={() => setIsCommandPaletteOpen(false)} 
        commands={commands} 
      />

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
        onRenameFolder={handleRenameFolder}
        onToggleBookmark={handleToggleBookmark}
        onReorderBookmark={handleReorderBookmark}
        onMoveNote={handleMoveNote}
        onMoveFolder={handleMoveFolder}
        sortField={sortField}
        sortDirection={sortDirection}
        width={sidebarWidth}
        onOpenSettings={() => setShowSettings(true)}
        expandedFolderIds={expandedFolderIds}
        onToggleFolderExpand={handleToggleFolderExpand}
        onRestoreNote={handleRestoreNote}
        onRestoreFolder={handleRestoreFolder}
        onPermanentDeleteNote={handlePermanentDeleteNote}
        onPermanentDeleteFolder={handlePermanentDeleteFolder}
      />

      {sidebarVisible && (
        <div 
            className="w-px bg-gray-200 dark:bg-slate-800 hover:w-1 hover:bg-indigo-500 cursor-col-resize transition-all z-20 flex-shrink-0 hidden md:block"
            onMouseDown={startResizingSidebar}
        />
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full min-w-0">
        <div className="h-10 border-b border-gray-200 dark:border-slate-800 flex items-center justify-between px-4 bg-gray-50 dark:bg-slate-900 gap-2 shrink-0 transition-colors duration-200">
            {/* Toolbar */}
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

                {/* Hide these on Mobile, Show on Desktop */}
                <div className="hidden md:flex items-center">
                    <button
                        onClick={handleOpenDailyNote}
                        className="p-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-slate-700 rounded transition-colors ml-1"
                        title="Open Today's Note (Cmd/Ctrl + D)"
                    >
                        <Calendar size={18} />
                    </button>

                    <button
                        onClick={() => setShowTasks(true)}
                        className="p-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-slate-700 rounded transition-colors ml-1"
                        title="Task List (Alt + T)"
                    >
                        <CheckSquare size={18} />
                    </button>

                    <button
                        onClick={handleOpenRandomNote}
                        className="p-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-slate-700 rounded transition-colors ml-1"
                        title="Open Random Note (Alt + R)"
                    >
                        <Shuffle size={18} />
                    </button>

                    <button
                        onClick={handleCreateNote}
                        className="p-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-slate-700 rounded transition-colors ml-1"
                        title="Create New Note (Ctrl/Cmd + Alt + N)"
                    >
                        <Plus size={18} />
                    </button>

                    <button
                        onClick={handleSync}
                        disabled={!dropboxToken && !dropboxRefreshToken || syncStatus === 'syncing'}
                        className={`p-1 rounded transition-colors ml-1 flex items-center justify-center 
                            ${(!dropboxToken && !dropboxRefreshToken)
                                ? 'text-slate-300 dark:text-slate-700 cursor-not-allowed' 
                                : syncStatus === 'error'
                                    ? 'text-red-500 hover:bg-red-100 dark:hover:bg-red-900/20'
                                    : syncStatus === 'success'
                                        ? 'text-green-500 hover:bg-green-100 dark:hover:bg-green-900/20'
                                        : 'text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-gray-200 dark:hover:bg-slate-700'
                            }`}
                        title={
                            (!dropboxToken && !dropboxRefreshToken)
                            ? "Dropbox Not Connected" 
                            : syncStatus === 'syncing' 
                                ? "Syncing..." 
                                : syncStatus === 'error'
                                    ? "Sync Failed (Click to retry)"
                                    : "Sync to Dropbox (Ctrl/Cmd + S)"
                        }
                    >
                        {syncStatus === 'syncing' ? (
                            <RefreshCw size={18} className="animate-spin" />
                        ) : syncStatus === 'success' ? (
                            <Check size={18} />
                        ) : syncStatus === 'error' ? (
                            <AlertCircle size={18} />
                        ) : (
                            <Cloud size={18} />
                        )}
                    </button>
                </div>
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

        <div className="flex-1 flex overflow-hidden relative">
          <div 
            className={`flex flex-col min-w-0 transition-colors duration-200 ${activePaneIndex === 0 ? 'ring-1 ring-inset ring-indigo-500/30 z-10' : ''}`}
            onClick={() => setActivePaneIndex(0)}
            style={{ flex: panes[1] !== null ? splitRatio : 1 }}
          >
            {getNoteById(panes[0]) ? (
              <div className="flex flex-col h-full pb-20 md:pb-0">
                <Editor
                    note={getNoteById(panes[0])!}
                    allNotes={notes}
                    onUpdate={handleUpdateNote}
                    onLinkClick={handleLinkClick}
                    onRefactorLinks={handleRefactorLinks}
                    onCreateNoteWithContent={handleCreateSpecificNote}
                    fontSize={fontSize}
                    isActive={activePaneIndex === 0}
                />
              </div>
            ) : (
               <EmptyState onCreate={handleCreateNote} />
            )}
          </div>

          {panes[1] !== null && (
               <div 
                   className="w-px bg-gray-200 dark:bg-slate-800 hover:w-1 hover:bg-indigo-500 cursor-col-resize transition-all z-20 flex-shrink-0"
                   onMouseDown={startResizingSplit}
               />
          )}

          {panes[1] !== null && (
             <div 
                className={`flex flex-col min-w-0 transition-colors duration-200 ${activePaneIndex === 1 ? 'ring-1 ring-inset ring-indigo-500/30 z-10' : ''}`}
                onClick={() => setActivePaneIndex(1)}
                style={{ flex: 1 - splitRatio }}
             >
                {getNoteById(panes[1]) ? (
                    <div className="flex flex-col h-full pb-24 md:pb-0">
                        <Editor
                            note={getNoteById(panes[1])!}
                            allNotes={notes}
                            onUpdate={handleUpdateNote}
                            onLinkClick={handleLinkClick}
                            onRefactorLinks={handleRefactorLinks}
                            onCreateNoteWithContent={handleCreateSpecificNote}
                            fontSize={fontSize}
                            isActive={activePaneIndex === 1}
                        />
                    </div>
                ) : (
                    <EmptyState onCreate={handleCreateNote} />
                )}
             </div>
          )}
        </div>
      </div>

      {/* Mobile Bottom Toolbar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white dark:bg-slate-900 border-t border-gray-200 dark:border-slate-800 flex items-center justify-between px-6 pt-3 pb-5">
        <div className="flex items-center gap-6">
            <button
                onClick={handleOpenDailyNote}
                className="text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400"
            >
                <Calendar size={24} strokeWidth={1.5} />
            </button>
            <button
                onClick={() => setShowTasks(true)}
                className="text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400"
            >
                <CheckSquare size={24} strokeWidth={1.5} />
            </button>
            <button
                onClick={handleOpenRandomNote}
                className="text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400"
            >
                <Shuffle size={24} strokeWidth={1.5} />
            </button>
             <button
                onClick={handleSync}
                disabled={!dropboxToken && !dropboxRefreshToken || syncStatus === 'syncing'}
                className={`${
                    (!dropboxToken && !dropboxRefreshToken)
                        ? 'text-slate-300 dark:text-slate-600' 
                        : syncStatus === 'error'
                            ? 'text-red-500'
                            : syncStatus === 'success'
                                ? 'text-green-500'
                                : 'text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400'
                }`}
            >
                {syncStatus === 'syncing' ? (
                    <RefreshCw size={24} strokeWidth={1.5} className="animate-spin" />
                ) : syncStatus === 'success' ? (
                    <Check size={24} strokeWidth={1.5} />
                ) : syncStatus === 'error' ? (
                    <AlertCircle size={24} strokeWidth={1.5} />
                ) : (
                    <Cloud size={24} strokeWidth={1.5} />
                )}
            </button>
        </div>

        <button
            onClick={handleCreateNote}
            className="w-12 h-12 flex items-center justify-center bg-indigo-600 text-white rounded-full shadow-lg shadow-indigo-600/30 active:scale-95 transition-transform"
        >
            <Plus size={24} />
        </button>
      </div>

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
                
                <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-slate-300">
                        <ArrowDownAz size={16} />
                        <span>Note Sorting</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        <SortButton field="updated" icon={Clock} label="Updated" />
                        <SortButton field="created" icon={Calendar} label="Created" />
                        <SortButton field="name" icon={ArrowDownAz} label="Name" />
                    </div>
                </div>

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

                <div className="space-y-3 pt-4 border-t border-gray-200 dark:border-slate-800">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-slate-300">
                            <RefreshCw size={16} />
                            <span>Auto-Sync</span>
                        </div>
                        <button
                            onClick={() => setAutoSync(!autoSync)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                autoSync ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-slate-700'
                            }`}
                        >
                            <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                    autoSync ? 'translate-x-6' : 'translate-x-1'
                                }`}
                            />
                        </button>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        Automatically sync when page becomes active and every 5 minutes
                    </p>
                </div>

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
                            {folders.filter(f => !f.deletedAt).map(f => (
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

                <div className="space-y-3 pt-4 border-t border-gray-200 dark:border-slate-800">
                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-slate-300">
                        <Cloud size={16} />
                        <span>Dropbox Sync</span>
                    </div>
                    <div className="bg-gray-100 dark:bg-slate-950 p-3 rounded-lg space-y-3">
                        {!dropboxToken && !dropboxRefreshToken ? (
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
                                
                                <button 
                                    onClick={handleSync}
                                    disabled={syncStatus === 'syncing'}
                                    className="w-full flex items-center justify-center gap-2 py-2 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-900/50 rounded-md text-xs font-medium transition-colors"
                                    title="Smart Sync (Upload & Download changes)"
                                >
                                    <RefreshCw size={14} className={syncStatus === 'syncing' ? 'animate-spin' : ''} /> Sync Now
                                </button>
                                
                                {syncMessage && (
                                    <div className={`text-xs text-center ${syncStatus === 'error' ? 'text-red-500' : 'text-slate-500'}`}>
                                        {syncMessage}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
      )}

      {showShortcuts && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
           <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowShortcuts(false)}></div>
           <div className="relative bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between border-b border-gray-200 dark:border-slate-800 p-4 shrink-0 bg-white dark:bg-slate-900 z-10">
                    <div className="flex items-center gap-2">
                        <Keyboard size={20} className="text-indigo-600 dark:text-indigo-400" />
                        <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">Keyboard Shortcuts</h2>
                    </div>
                    <button onClick={() => setShowShortcuts(false)} className="text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-white">
                        <X size={20} />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-6 space-y-3">
                     <ShortcutRow keys={['Ctrl', 'K']} description="Open Command Palette" />
                     <ShortcutRow keys={['Ctrl', 'Alt', 'N']} description="Create New Note" />
                     <ShortcutRow keys={['Ctrl', 'E']} description="Toggle Edit/Preview" />
                     <ShortcutRow keys={['Ctrl', 'D']} description="Open Daily Note" />
                     <ShortcutRow keys={['Ctrl', 'S']} description="Sync to Dropbox" />
                     <ShortcutRow keys={['Ctrl', '\\']} description="Toggle Sidebar" />
                     <ShortcutRow keys={['Ctrl', '?']} description="Show Shortcuts" />
                     <ShortcutRow keys={['Alt', 'T']} description="Toggle Task List" />
                     <ShortcutRow keys={['Alt', 'R']} description="Open Random Note" />
                     <ShortcutRow keys={['Ctrl', '[']} description="Go Back" />
                     <ShortcutRow keys={['Ctrl', ']']} description="Go Forward" />
                     <ShortcutRow keys={['Cmd', 'Shift', 'E']} description="Extract Selection" />
                     <ShortcutRow keys={['[[']} description="Trigger Link Autocomplete" />
                     <ShortcutRow keys={['Ctrl', '[']} description="Wrap Selection in WikiLink" />
                </div>
           </div>
        </div>
      )}
      
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
                     {(() => {
                         const visibleNoteTasks = allTasks.map(nt => ({
                             note: nt.note,
                             tasks: nt.tasks.filter(t => !t.isChecked || recentlyCompletedTasks.has(`${nt.note.id}-${t.lineIndex}`))
                         })).filter(nt => nt.tasks.length > 0);

                         if (visibleNoteTasks.length === 0) {
                             return (
                                 <div className="text-center text-slate-500 dark:text-slate-500 py-8">
                                     No pending tasks found.
                                     <br/><span className="text-xs">Completed tasks are hidden.</span>
                                 </div>
                             );
                         }

                         return visibleNoteTasks.map(({ note, tasks }) => (
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
                                     {tasks.map((task) => {
                                         return (
                                             <div key={`${note.id}-${task.lineIndex}`} className={`flex items-start gap-3 group ${task.isChecked ? 'opacity-40 hover:opacity-100 transition-opacity' : ''}`}>
                                                 <input 
                                                    type="checkbox" 
                                                    checked={task.isChecked} 
                                                    onChange={() => handleToggleTaskFromModal(note.id, task.lineIndex, task.isChecked)}
                                                    className="mt-1 rounded border-gray-400 dark:border-slate-600 bg-transparent transform scale-110 cursor-pointer"
                                                 />
                                                 <span 
                                                    className={`text-sm text-slate-700 dark:text-slate-300 ${task.isChecked ? 'line-through' : ''}`}
                                                    dangerouslySetInnerHTML={{ 
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
                         ));
                     })()}
                 </div>
             </div>
          </div>
      )}

      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setConfirmModal({ isOpen: false, message: '', onConfirm: () => {} })}></div>
            <div className="relative bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg shadow-xl p-6 max-w-sm w-full">
                <h3 className="text-lg font-bold mb-2 text-slate-900 dark:text-slate-100">Confirm Action</h3>
                <p className="text-slate-600 dark:text-slate-300 mb-6">{confirmModal.message}</p>
                <div className="flex justify-end gap-2">
                    <button 
                        onClick={() => setConfirmModal({ isOpen: false, message: '', onConfirm: () => {} })}
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

      {inputModal.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setInputModal({ isOpen: false, title: '', value: '', onConfirm: () => {} })}></div>
            <div className="relative bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg shadow-xl p-6 max-w-sm w-full">
                <h3 className="text-lg font-bold mb-4 text-slate-900 dark:text-slate-100">{inputModal.title}</h3>
                <input
                    autoFocus
                    type="text"
                    className="w-full bg-gray-100 dark:bg-slate-950 border border-gray-300 dark:border-slate-800 rounded p-2 mb-6 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                    value={inputModal.value}
                    onChange={(e) => setInputModal((prev: InputModalState) => ({ ...prev, value: e.target.value }))}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') inputModal.onConfirm(inputModal.value);
                        if (e.key === 'Escape') setInputModal({ isOpen: false, title: '', value: '', onConfirm: () => {} });
                    }}
                />
                <div className="flex justify-end gap-2">
                    <button 
                        onClick={() => setInputModal({ isOpen: false, title: '', value: '', onConfirm: () => {} })}
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
            Create New Note (Ctrl/Cmd + Alt + N)
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