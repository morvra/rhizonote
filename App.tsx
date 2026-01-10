import React, { useState, useRef, useEffect, useMemo } from 'react';
import Sidebar from './components/Sidebar';
import Editor from './components/Editor';
import CommandPalette, { CommandItem } from './components/CommandPalette';
import { Note, Folder, SortField, SortDirection, Theme } from './types';
import { INITIAL_NOTES, INITIAL_FOLDERS } from './constants';
import { Columns, Minimize2, Menu, ChevronLeft, ChevronRight, X, Moon, Sun, Monitor, Type, PanelLeft, Calendar, Plus, Keyboard, CheckSquare, Cloud, RefreshCw, LogOut, FileText, Clock, ArrowDownAz, ArrowUp, ArrowDown, Check, AlertCircle, Shuffle, Eye, Bookmark, Terminal } from 'lucide-react';
import { getDropboxAuthUrl, parseAuthTokenFromUrl, syncDropboxData, getNotePath, getFolderPath, RenameOperation, exchangeCodeForToken } from './utils/dropboxService';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';

const generateId = () => Math.random().toString(36).substr(2, 9);
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// Local Storage Keys
const LS_KEY_NOTES = 'rhizonote_notes'; // Deprecated, used for migration
const LS_KEY_FOLDERS = 'rhizonote_folders'; // Deprecated, used for migration
const LS_KEY_MIGRATED = 'rhizonote_migrated_v1';
const LS_KEY_THEME = 'rhizonote_theme';
const LS_KEY_DB_TOKEN = 'rhizonote_dropbox_token'; 
const LS_KEY_DB_REFRESH_TOKEN = 'rhizonote_dropbox_refresh_token';
const LS_KEY_PANES = 'rhizonote_panes';
const LS_KEY_ACTIVE_PANE = 'rhizonote_active_pane';
const LS_KEY_SORT = 'rhizonote_sort';
const LS_KEY_EXPANDED = 'rhizonote_expanded';
const LS_KEY_UI_SETTINGS = 'rhizonote_ui_settings';
const LS_KEY_DAILY_PREFS = 'rhizonote_daily_prefs';
const LS_KEY_DELETED_PATHS = 'rhizonote_deleted_paths';
const LS_KEY_PENDING_RENAMES = 'rhizonote_pending_renames';
const LS_KEY_UNSYNCED_IDS = 'rhizonote_unsynced_ids';

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
  // --- Data Layer: Dexie (IndexedDB) ---
  const notes = useLiveQuery(() => db.notes.toArray()) ?? [];
  const folders = useLiveQuery(() => db.folders.toArray()) ?? [];
  
  // Migration Logic: LocalStorage -> IndexedDB
  useEffect(() => {
    const migrate = async () => {
        const isMigrated = localStorage.getItem(LS_KEY_MIGRATED);
        
        if (!isMigrated) {
            // Check for existing LocalStorage data
            const lsNotesStr = localStorage.getItem(LS_KEY_NOTES);
            const lsFoldersStr = localStorage.getItem(LS_KEY_FOLDERS);
            
            const existingNotes = lsNotesStr ? JSON.parse(lsNotesStr) : [];
            const existingFolders = lsFoldersStr ? JSON.parse(lsFoldersStr) : [];
            
            await (db as any).transaction('rw', db.notes, db.folders, async () => {
                const notesCount = await db.notes.count();
                if (notesCount === 0) {
                    if (existingNotes.length > 0) {
                        await db.notes.bulkAdd(existingNotes);
                        await db.folders.bulkAdd(existingFolders);
                    } else {
                        // Initialize with default data if totally fresh
                        await db.notes.bulkAdd(INITIAL_NOTES);
                        await db.folders.bulkAdd(INITIAL_FOLDERS);
                    }
                }
            });
            
            localStorage.setItem(LS_KEY_MIGRATED, 'true');
            // Clean up old data to free space, but maybe wait a bit in a real app
            // localStorage.removeItem(LS_KEY_NOTES);
            // localStorage.removeItem(LS_KEY_FOLDERS);
        }
    };
    migrate();
  }, []);

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

  // 未同期の変更を追跡 (Initialize from localStorage)
  // Use a nullable ref for initialization check to avoid TS errors
  const unsyncedNoteIdsRef = useRef<Set<string> | null>(null);
  if (unsyncedNoteIdsRef.current === null) {
      try {
          const saved = localStorage.getItem(LS_KEY_UNSYNCED_IDS);
          unsyncedNoteIdsRef.current = saved ? new Set(JSON.parse(saved)) : new Set<string>();
      } catch {
          unsyncedNoteIdsRef.current = new Set<string>();
      }
  }
  // Cast to non-null for usage
  const unsyncedNoteIds = unsyncedNoteIdsRef as React.MutableRefObject<Set<string>>;

  // Helper to update unsynced IDs and persist
  const addUnsyncedId = (id: string) => {
      unsyncedNoteIds.current.add(id);
      localStorage.setItem(LS_KEY_UNSYNCED_IDS, JSON.stringify(Array.from(unsyncedNoteIds.current)));
  };

  const clearUnsyncedIds = () => {
      unsyncedNoteIds.current.clear();
      localStorage.removeItem(LS_KEY_UNSYNCED_IDS);
  };
  
  // 最終編集時刻を追跡（自動同期の抑制に使用）
  const lastEditTimeRef = useRef<number>(0);

  const [recentlyCompletedTasks, setRecentlyCompletedTasks] = useState<Set<string>>(new Set());
  
  // Task Selection for Keyboard Navigation
  const [taskSelectedIndex, setTaskSelectedIndex] = useState(0);
  const taskListRef = useRef<HTMLDivElement>(null);
  
  // Highlighted line for jump-to-task
  const [highlightedLine, setHighlightedLine] = useState<{ noteId: string; lineIndex: number } | null>(null);

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

  // -- LocalStorage Effects (Only for UI/Settings/Tracking) --

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

  // Browser Title
  useEffect(() => {
    const activeId = panes[activePaneIndex];
    const currentNote = notes.find(n => n.id === activeId);
    if (currentNote) {
        const displayTitle = currentNote.title.trim() || 'Untitled';
        document.title = `${displayTitle} - Rhizonote`;
    } else {
        document.title = 'Rhizonote';
    }
  }, [notes, panes, activePaneIndex]);

  // Cleanup expired trash on mount
  useEffect(() => {
      // Small timeout to ensure DB is loaded
      setTimeout(() => cleanupExpiredTrash(), 1000);
  }, []); 

  const cleanupExpiredTrash = async () => {
      const now = Date.now();
      
      // Since `notes` and `folders` in scope might be stale/loading, fetch direct from DB
      const allNotes = await db.notes.toArray();
      const allFolders = await db.folders.toArray();

      const expiredNotes = allNotes.filter(n => n.deletedAt && (now - n.deletedAt > THIRTY_DAYS_MS));
      const expiredFolders = allFolders.filter(f => f.deletedAt && (now - f.deletedAt > THIRTY_DAYS_MS));

      if (expiredNotes.length === 0 && expiredFolders.length === 0) return;

      const newDeletedPaths = [...deletedPaths];

      // Queue paths for permanent deletion
      expiredNotes.forEach(n => {
          newDeletedPaths.push(getNotePath(n.title, n.folderId, allFolders));
      });
      expiredFolders.forEach(f => {
          newDeletedPaths.push(getFolderPath(f.id, allFolders));
      });

      setDeletedPaths(newDeletedPaths);

      // Delete from DB
      await db.notes.bulkDelete(expiredNotes.map(n => n.id));
      await db.folders.bulkDelete(expiredFolders.map(f => f.id));
  };

  const authCodeProcessed = useRef(false);

  // Dropbox Auth Check
  useEffect(() => {
      const handleAuth = async () => {
          const urlParams = new URLSearchParams(window.location.search);
          const code = urlParams.get('code');
          
          if (code) {
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
                  window.history.replaceState({}, document.title, window.location.pathname);
              }
              return;
          }

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
          // Sync logic needs snapshots
          const currentNotes = await db.notes.toArray();
          const currentFolders = await db.folders.toArray();
          
          const auth = {
              accessToken: dropboxToken,
              refreshToken: dropboxRefreshToken
          };

          const data = await syncDropboxData(
              auth, 
              currentNotes,
              currentFolders, 
              deletedPaths, 
              pendingRenames,
              unsyncedNoteIds.current
          );
          
          if (data) {
              // Update DB with results
              await (db as any).transaction('rw', db.notes, db.folders, async () => {
                  await db.notes.bulkPut(data.notes);
                  await db.folders.bulkPut(data.folders);
              });
              
              setDeletedPaths([]);
              setPendingRenames([]);
              
              clearUnsyncedIds();
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

  const isSyncingRef = useRef(false);
  const lastSyncTimeRef = useRef<number>(0);

  // Auto-sync
  useEffect(() => {
      if (!autoSync || (!dropboxToken && !dropboxRefreshToken)) return;

      let intervalId: number | undefined;
      const MIN_SYNC_INTERVAL = 3 * 60 * 1000; 

      const syncIfNeeded = async (force = false) => {
          const now = Date.now();
          const timeSinceLastSync = now - lastSyncTimeRef.current;
          const timeSinceLastEdit = now - lastEditTimeRef.current;
          
          const hasChanges = unsyncedNoteIds.current.size > 0;

          if (isSyncingRef.current) return;

          if (!force) {
              if (timeSinceLastEdit < 5000) return;
              if (timeSinceLastSync < MIN_SYNC_INTERVAL) return;
          } else {
              if (!hasChanges) return;
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

      const handleVisibilityChange = () => {
          if (document.visibilityState === 'visible') {
              syncIfNeeded(false);
          } else if (document.visibilityState === 'hidden') {
              syncIfNeeded(true);
          }
      };

      const handleWindowFocus = () => syncIfNeeded(false);
      const handleWindowBlur = () => syncIfNeeded(true);

      intervalId = window.setInterval(() => {
          syncIfNeeded(false);
      }, 5 * 60 * 1000);

      document.addEventListener('visibilitychange', handleVisibilityChange);
      window.addEventListener('focus', handleWindowFocus);
      window.addEventListener('blur', handleWindowBlur);

      const initialSyncTimeout = setTimeout(() => {
          syncIfNeeded(false);
      }, 1500);

      return () => {
          if (intervalId) clearInterval(intervalId);
          clearTimeout(initialSyncTimeout);
          document.removeEventListener('visibilitychange', handleVisibilityChange);
          window.removeEventListener('focus', handleWindowFocus);
          window.removeEventListener('blur', handleWindowBlur);
      };
  }, [autoSync, dropboxToken, dropboxRefreshToken]);

  // Extract tasks
  const allTasks = useMemo<NoteTasks[]>(() => {
      const result: NoteTasks[] = [];
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

  const visibleFlatTasks = useMemo(() => {
      const flat: { note: Note; task: ExtractedTask }[] = [];
      allTasks.forEach(noteGroup => {
          const visible = noteGroup.tasks.filter(t => !t.isChecked || recentlyCompletedTasks.has(`${noteGroup.note.id}-${t.lineIndex}`));
          visible.forEach(task => {
              flat.push({ note: noteGroup.note, task });
          });
      });
      return flat;
  }, [allTasks, recentlyCompletedTasks]);

  useEffect(() => {
      if (showTasks) {
          setTaskSelectedIndex(0);
      }
  }, [showTasks]);

  useEffect(() => {
      if (!showTasks) return;

      const handleKeyDown = (e: KeyboardEvent) => {
          if (e.key === 'Escape') {
              e.preventDefault();
              handleCloseTasks();
              return;
          }
          if (visibleFlatTasks.length === 0) return;

          if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
              e.preventDefault();
              setTaskSelectedIndex(prev => (prev + 1) % visibleFlatTasks.length);
          } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setTaskSelectedIndex(prev => (prev - 1 + visibleFlatTasks.length) % visibleFlatTasks.length);
          } else if (e.key === ' ' && !e.repeat) {
              e.preventDefault();
              const selected = visibleFlatTasks[taskSelectedIndex];
              if (selected) {
                  handleToggleTaskFromModal(selected.note.id, selected.task.lineIndex, selected.task.isChecked);
              }
          } else if (e.key === 'Enter') {
              e.preventDefault();
              const selected = visibleFlatTasks[taskSelectedIndex];
              if (selected) {
                  setHighlightedLine({ noteId: selected.note.id, lineIndex: selected.task.lineIndex });
                  openNote(selected.note.id);
                  handleCloseTasks();
              }
          }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showTasks, visibleFlatTasks, taskSelectedIndex]);

  useEffect(() => {
      if (!showTasks || !taskListRef.current) return;
      const selectedEl = taskListRef.current.querySelector('[data-selected="true"]');
      if (selectedEl) {
          selectedEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
  }, [taskSelectedIndex, showTasks]);

  const handleCloseTasks = () => {
      setShowTasks(false);
      setRecentlyCompletedTasks(new Set());
  };

  const handleToggleTaskFromModal = async (noteId: string, lineIndex: number, currentChecked: boolean) => {
      lastEditTimeRef.current = Date.now();
      if (!currentChecked) {
          setRecentlyCompletedTasks((prev: Set<string>) => {
              const newSet = new Set(prev);
              newSet.add(`${noteId}-${lineIndex}`);
              return newSet;
          });
      }

      const note = await db.notes.get(noteId);
      if (!note) return;

      const lines = note.content.split('\n');
      if (lineIndex >= lines.length) return; 

      const line = lines[lineIndex];
      const newStatus = currentChecked ? '[ ]' : '[x]';
      const newLine = line.replace(/\[([ x])\]/, newStatus);
      lines[lineIndex] = newLine;

      const newContent = lines.join('\n');
      await db.notes.update(noteId, { content: newContent, updatedAt: Date.now() });
      addUnsyncedId(noteId);
  };

  const openNote = (id: string) => {
    setPanes(prev => {
        const newPanes = [...prev];
        newPanes[activePaneIndex] = id;
        return newPanes;
    });
    setHistory(prev => {
        const newHistory = [...prev];
        if (!newHistory[activePaneIndex]) {
            newHistory[activePaneIndex] = { stack: [], currentIndex: -1 };
        }
        const paneHist = newHistory[activePaneIndex];
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

  const handleCreateNote = async () => {
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
    
    await db.notes.add(newNote);
    
    addUnsyncedId(newNote.id);
    
    openNote(newNote.id);
    setMobileMenuOpen(false); 
  };

  const handleCreateSpecificNote = async (title: string, content: string) => {
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
    await db.notes.add(newNote);
    addUnsyncedId(newNote.id);
  };

  const handleOpenDailyNote = async () => {
    const todayTitle = formatDate(new Date(), dailyNoteFormat);
    const targetFolderId = dailyNoteFolderId && folders.find(f => f.id === dailyNoteFolderId) ? dailyNoteFolderId : null;
    
    // Check if note exists
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
        await db.notes.add(newNote);
        addUnsyncedId(newNote.id);
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
        onConfirm: async (name) => {
            if (name) {
                const newFolder = { 
                    id: generateId(), 
                    name, 
                    parentId, 
                    createdAt: Date.now() 
                };
                await db.folders.add(newFolder);
                
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
        onConfirm: async (newName) => {
            if (newName && newName !== folder.name) {
                // For folders, getFolderPath uses the *current* state.
                const oldPath = getFolderPath(id, folders);
                
                // Simulate new state to calculate new path
                const simulatedFolders = folders.map(f => f.id === id ? { ...f, name: newName } : f);
                const newPath = getFolderPath(id, simulatedFolders);
                
                if (oldPath !== newPath) {
                    queueRename(oldPath, newPath);
                }

                await db.folders.update(id, { name: newName });
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

  const handleDeleteFolder = (id: string) => {
    const folder = folders.find(f => f.id === id);
    const name = folder ? folder.name : 'this folder';
    
    setConfirmModal({
        isOpen: true,
        message: `Move folder "${name}" and its contents to trash?`,
        onConfirm: async () => {
            const now = Date.now();
            const descendantIds = getDescendantFolderIds(id, folders);
            const allAffectedFolderIds = [id, ...descendantIds];

            // Update Folders
            await db.folders.bulkUpdate(allAffectedFolderIds.map(fid => ({ key: fid, changes: { deletedAt: now } })));
            
            // Update Notes
            const affectedNotes = notes.filter(n => n.folderId && allAffectedFolderIds.includes(n.folderId));
            await db.notes.bulkUpdate(affectedNotes.map(n => ({ key: n.id, changes: { deletedAt: now, updatedAt: now } })));
            
            // Sync tracking
            affectedNotes.forEach(n => addUnsyncedId(n.id));

            // Close affected panes
            const deletedNoteIds = affectedNotes.map(n => n.id);
            setPanes(prev => prev.map(pid => (pid && deletedNoteIds.includes(pid)) ? null : pid));

            setConfirmModal({ isOpen: false, message: '', onConfirm: () => {} });
        }
    });
  };

  const handleDeleteNote = (id: string) => {
    const noteToDelete = notes.find(n => n.id === id);
    const title = noteToDelete ? noteToDelete.title : 'this note';
    setConfirmModal({
        isOpen: true,
        message: `Move note "${title}" to trash?`,
        onConfirm: async () => {
            const now = Date.now();
            addUnsyncedId(id);
            await db.notes.update(id, { deletedAt: now, updatedAt: now });
            setPanes(prev => prev.map(paneId => paneId === id ? null : paneId));
            setConfirmModal({ isOpen: false, message: '', onConfirm: () => {} });
        }
    });
  };

  const handlePermanentDeleteFolder = async (id: string) => {
      const descendantIds = getDescendantFolderIds(id, folders);
      const allAffectedFolderIds = [id, ...descendantIds];
      
      const newDeletedPaths = [...deletedPaths];
      allAffectedFolderIds.forEach(fid => {
           newDeletedPaths.push(getFolderPath(fid, folders));
      });
      const topPath = getFolderPath(id, folders);
      setDeletedPaths(prev => [...prev, topPath]);
      
      // Delete from DB
      await db.folders.bulkDelete(allAffectedFolderIds);
      const notesToDelete = notes.filter(n => n.folderId && allAffectedFolderIds.includes(n.folderId)).map(n => n.id);
      await db.notes.bulkDelete(notesToDelete);
  };

  const handlePermanentDeleteNote = async (id: string) => {
      const note = notes.find(n => n.id === id);
      if (note) {
          const path = getNotePath(note.title, note.folderId, folders);
          setDeletedPaths(prev => [...prev, path]);
          await db.notes.delete(id);
      }
  };

  const handleRestoreNote = async (id: string) => {
      addUnsyncedId(id);
      await db.notes.update(id, { deletedAt: undefined, updatedAt: Date.now() });
  };

  const handleRestoreFolder = async (id: string) => {
      const descendantIds = getDescendantFolderIds(id, folders);
      const allAffectedFolderIds = [id, ...descendantIds];

      await db.folders.bulkUpdate(allAffectedFolderIds.map(fid => ({ key: fid, changes: { deletedAt: undefined } })));
      
      const affectedNotes = notes.filter(n => n.folderId && allAffectedFolderIds.includes(n.folderId));
      await db.notes.bulkUpdate(affectedNotes.map(n => ({ key: n.id, changes: { deletedAt: undefined, updatedAt: Date.now() } })));
      
      affectedNotes.forEach(n => addUnsyncedId(n.id));
  };

  const handleToggleBookmark = async (id: string) => {
      const note = notes.find(n => n.id === id);
      if (!note) return;
      
      addUnsyncedId(id);
      
      if (note.isBookmarked) {
          await db.notes.update(id, { isBookmarked: false, bookmarkOrder: undefined });
      } else {
          const bookmarkedNotes = notes.filter(n => n.isBookmarked);
          const maxOrder = Math.max(0, ...bookmarkedNotes.map(n => n.bookmarkOrder || 0));
          await db.notes.update(id, { isBookmarked: true, bookmarkOrder: maxOrder + 1 });
      }
  };

  const handleReorderBookmark = async (draggedId: string, targetId: string) => {
      const bookmarked = notes.filter(n => n.isBookmarked).sort((a, b) => (a.bookmarkOrder || 0) - (b.bookmarkOrder || 0));
      const draggedIndex = bookmarked.findIndex(n => n.id === draggedId);
      const targetIndex = bookmarked.findIndex(n => n.id === targetId);

      if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) return;

      const item = bookmarked[draggedIndex];
      const newOrderList = [...bookmarked];
      newOrderList.splice(draggedIndex, 1);
      newOrderList.splice(targetIndex, 0, item);

      // Batch update logic would be ideal here
      await (db as any).transaction('rw', db.notes, async () => {
          await Promise.all(newOrderList.map((n, idx) => {
               return db.notes.update(n.id, { bookmarkOrder: idx });
          }));
      });
  };

  const handleUpdateNote = async (id: string, updates: Partial<Note>) => {
    lastEditTimeRef.current = Date.now();
    const oldNote = notes.find(n => n.id === id);
    if (!oldNote) return;
    
    // Handle Rename/Move
    if (
        (updates.title && updates.title !== oldNote.title) || 
        (updates.folderId !== undefined && updates.folderId !== oldNote.folderId)
    ) {
            const oldPath = getNotePath(oldNote.title, oldNote.folderId, folders);
            
            const newTitle = updates.title !== undefined ? updates.title : oldNote.title;
            const newFolderId = updates.folderId !== undefined ? updates.folderId : oldNote.folderId;
            const newPath = getNotePath(newTitle, newFolderId, folders);

            if (oldPath !== newPath) {
                queueRename(oldPath, newPath);
            }
    }

    addUnsyncedId(id);

    await db.notes.update(id, { ...updates, updatedAt: Date.now() });
  };

  const handleMoveNote = (noteId: string, folderId: string | null) => {
      handleUpdateNote(noteId, { folderId });
  };

  const handleMoveFolder = async (folderId: string, parentId: string | null) => {
      if (folderId === parentId) return;
      
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

      const folder = folders.find(f => f.id === folderId);
      if (!folder) return;
      
      const oldPath = getFolderPath(folderId, folders);
      
      // Simulate state for new path calculation - a bit tricky without state.
      // We construct a temporary folders array
      const tempFolders = folders.map(f => f.id === folderId ? { ...f, parentId } : f);
      const newPath = getFolderPath(folderId, tempFolders);
      
      if (oldPath !== newPath) {
          queueRename(oldPath, newPath);
      }
      
      await db.folders.update(folderId, { parentId });
  };

  const handleRefactorLinks = async (oldTitle: string, newTitle: string) => {
      if (oldTitle === newTitle) return;
      
      lastEditTimeRef.current = Date.now();
      const regex = new RegExp(`\\[\\[${oldTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\]`, 'g');
      const newLink = `[[${newTitle}]]`;
      
      const notesToUpdate = notes.filter(n => n.content.match(regex));
      
      await (db as any).transaction('rw', db.notes, async () => {
          await Promise.all(notesToUpdate.map(n => {
              addUnsyncedId(n.id);
              return db.notes.update(n.id, {
                  content: n.content.replace(regex, newLink),
                  updatedAt: Date.now()
              });
          }));
      });
  };
  
  const handleLinkClick = async (title: string) => {
      const target = notes.find(n => n.title === title && !n.deletedAt);
      if (target) {
          openNote(target.id);
      } else {
          lastEditTimeRef.current = Date.now();
          const newNote: Note = {
              id: generateId(),
              folderId: null,
              title: title,
              content: '',
              isBookmarked: false,
              updatedAt: Date.now(),
              createdAt: Date.now()
          };
          await db.notes.add(newNote);
          addUnsyncedId(newNote.id);
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
        if (e.altKey && e.key.toLowerCase() === 'd') {
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
        if (isMod && e.shiftKey && e.key.toLowerCase() === 'v') {
            e.preventDefault();
            toggleSplitView();
        }
        if (isMod && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            setIsCommandPaletteOpen(prev => !prev);
        }
        if (isMod && e.key.toLowerCase() === 'p') {
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
        { id: 'daily-note', label: 'Open Daily Note', icon: <Calendar size={16}/>, action: handleOpenDailyNote, shortcut: 'Alt+D', group: 'Actions' },
        { id: 'random-note', label: 'Open Random Note', icon: <Shuffle size={16}/>, action: handleOpenRandomNote, shortcut: 'Alt+R', group: 'Actions' },
        { id: 'toggle-preview', label: 'Toggle Edit/Preview', icon: <Eye size={16}/>, action: handleTogglePreview, shortcut: 'Ctrl+E', group: 'View' },
        { id: 'split-view', label: 'Toggle Split View', icon: <Columns size={16}/>, action: toggleSplitView, shortcut: 'Ctrl+Shift+V', group: 'View' },
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
        notes={notes}
        onSelectNote={(id) => {
             setHighlightedLine(null); // ハイライトをリセット
             openNote(id);
        }}
      />

      <Sidebar
        isOpen={mobileMenuOpen}
        isVisible={sidebarVisible}
        onCloseMobile={() => setMobileMenuOpen(false)}
        notes={notes}
        folders={folders}
        activeNoteId={activeNoteId}
        onSelectNote={(id) => {
            setHighlightedLine(null);
            openNote(id);
        }}
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
                        title="Open Today's Note (Alt + D)"
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
                    highlightedLine={highlightedLine}
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
                            highlightedLine={highlightedLine}
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
                     <ShortcutRow keys={['Ctrl', 'P']} description="Open Command Palette" />
                     <ShortcutRow keys={['Ctrl', 'Alt', 'N']} description="Create New Note" />
                     <ShortcutRow keys={['Ctrl', 'E']} description="Toggle Edit/Preview" />
                     <ShortcutRow keys={['Ctrl', 'S']} description="Sync to Dropbox" />
                     <ShortcutRow keys={['Ctrl', '\\']} description="Toggle Sidebar" />
                     <ShortcutRow keys={['Ctrl', 'Shift', 'V']} description="Toggle Split View" />
                     <ShortcutRow keys={['Ctrl', '?']} description="Show Shortcuts" />
                     <ShortcutRow keys={['Alt', 'D']} description="Open Daily Note" />
                     <ShortcutRow keys={['Alt', 'T']} description="Toggle Task List" />
                     <ShortcutRow keys={['Alt', 'R']} description="Open Random Note" />
                     <ShortcutRow keys={['Ctrl', '[']} description="Go Back" />
                     <ShortcutRow keys={['Ctrl', ']']} description="Go Forward" />
                     <ShortcutRow keys={['Ctrl', 'Shift', 'E']} description="Extract Selection" />
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
                     <div className="flex items-center gap-3">
                        <div className="hidden sm:flex items-center gap-2 text-[10px] text-slate-400 mr-2">
                            <span className="bg-gray-100 dark:bg-slate-800 px-1.5 py-0.5 rounded border border-gray-200 dark:border-slate-700">Space</span> to toggle
                            <span className="bg-gray-100 dark:bg-slate-800 px-1.5 py-0.5 rounded border border-gray-200 dark:border-slate-700">Enter</span> to open
                            <span className="bg-gray-100 dark:bg-slate-800 px-1.5 py-0.5 rounded border border-gray-200 dark:border-slate-700">Esc</span> to close
                        </div>
                        <button onClick={handleCloseTasks} className="text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-white">
                            <X size={20} />
                        </button>
                     </div>
                 </div>
                 <div className="flex-1 overflow-y-auto p-4 space-y-6" ref={taskListRef}>
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

                         let globalTaskIndex = 0;

                         return visibleNoteTasks.map(({ note, tasks }) => (
                             <div key={note.id} className="space-y-2">
                                 <div 
                                    className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2 cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                                    onClick={() => {
                                        setHighlightedLine(null);
                                        openNote(note.id);
                                        handleCloseTasks();
                                    }}
                                 >
                                    <FileText size={12} />
                                    {note.title}
                                 </div>
                                 <div className="pl-4 space-y-1">
                                     {tasks.map((task) => {
                                         const isSelected = globalTaskIndex === taskSelectedIndex;
                                         globalTaskIndex++; // Increment for next task

                                         return (
                                             <div 
                                                key={`${note.id}-${task.lineIndex}`} 
                                                className={`flex items-center gap-3 p-2 rounded-md group transition-all duration-200
                                                    ${isSelected 
                                                        ? 'bg-indigo-50 dark:bg-indigo-900/20 shadow-sm border-l-4 border-indigo-500' 
                                                        : 'border-l-4 border-transparent hover:bg-gray-50 dark:hover:bg-slate-800/50'
                                                    }
                                                    ${task.isChecked ? 'opacity-50' : ''}
                                                `}
                                                data-selected={isSelected}
                                                onClick={() => setTaskSelectedIndex(globalTaskIndex - 1)} // Allow click selection
                                             >
                                                 <input 
                                                    type="checkbox" 
                                                    checked={task.isChecked} 
                                                    onChange={() => handleToggleTaskFromModal(note.id, task.lineIndex, task.isChecked)}
                                                    className="rounded border-gray-400 dark:border-slate-600 bg-transparent transform scale-110 cursor-pointer"
                                                 />
                                                 <div 
                                                    className="flex-1 cursor-pointer"
                                                    onClick={() => {
                                                        setHighlightedLine({ noteId: note.id, lineIndex: task.lineIndex });
                                                        openNote(note.id);
                                                        handleCloseTasks();
                                                    }}
                                                 >
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
                                                 <div className={`hidden sm:block text-[10px] text-slate-400 font-mono self-center transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0'}`}>
                                                     ↩
                                                 </div>
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