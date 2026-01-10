import React, { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { Note } from '../types';
import WikiLinkPopup from './WikiLinkPopup';
import { Edit3, Eye, RefreshCw, Bold, Italic, Strikethrough, Code, Link as LinkIcon, FilePlus, Link2, Info, AlertTriangle, Merge } from 'lucide-react';

interface EditorProps {
  note: Note;
  allNotes: Note[];
  onUpdate: (id: string, updates: Partial<Note>) => void;
  onLinkClick: (title: string) => void;
  onRefactorLinks: (oldTitle: string, newTitle: string) => void;
  onCreateNoteWithContent?: (title: string, content: string) => void;
  onMergeNotes?: (sourceId: string, targetId: string, oldSourceTitle: string) => void;
  fontSize: number;
  isActive?: boolean;
  highlightedLine?: { noteId: string; lineIndex: number } | null;
}

// Helper to extract [[links]] from content, ignoring code blocks
const extractLinks = (content: string): string[] => {
    const regex = /(?:```[\s\S]*?```|`[^`]*`)|\[\[(.*?)\]\]/g;
    const links: string[] = [];
    let match;
    while ((match = regex.exec(content)) !== null) {
        if (match[1]) {
            links.push(match[1]);
        }
    }
    return links;
};

interface NoteCardProps {
  note: Note;
  onLinkClick: (t: string) => void;
}

const NoteCard: React.FC<NoteCardProps> = ({ note, onLinkClick }) => {
    return (
        <div 
            className={`
                bg-white dark:bg-slate-900 border rounded-lg p-3 shadow-sm hover:shadow-md transition-shadow cursor-pointer flex flex-col min-h-24
                ${note.isGhost 
                    ? 'border-dashed border-slate-300 dark:border-slate-700 opacity-90' 
                    : 'border-gray-200 dark:border-slate-800'}
            `}
            onClick={() => onLinkClick(note.title)}
        >
            <h3 className={`font-bold mb-1.5 truncate text-sm ${note.isGhost ? 'text-slate-600 dark:text-slate-400 italic' : 'text-slate-800 dark:text-slate-200'}`}>
                {note.title}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-3 mb-auto whitespace-pre-wrap leading-relaxed">
                {note.isGhost 
                    ? <span className="opacity-50 italic">Click to create this note...</span>
                    : note.content.replace(/#/g, '').replace(/\[\[/g, '').replace(/\]\]/g, '')
                }
            </p>
        </div>
    );
};

// Simple Markdown Parser for Preview Mode
const parseInline = (text: string, existingTitles?: Set<string>) => {
    const placeholders: string[] = [];
    const addPlaceholder = (content: string) => {
        placeholders.push(content);
        return `__PH_${placeholders.length - 1}__`;
    };

    let processed = text
        .replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-slate-900 dark:text-white">$1</strong>')
        .replace(/\*(.*?)\*/g, '<em class="italic">$1</em>')
        .replace(/~~(.*?)~~/g, '<del class="line-through text-slate-400">$1</del>')
        .replace(/`([^`]+)`/g, (_match, code) => {
             return addPlaceholder(`<code class="bg-gray-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-sm font-mono text-indigo-600 dark:text-indigo-400">${code}</code>`);
        })
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, src) => {
            return addPlaceholder(`<img src="${src}" alt="${alt}" class="max-w-full rounded-lg my-2 border border-gray-200 dark:border-slate-800" />`);
        })
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, txt, href) => {
            return addPlaceholder(`<a href="${href}" target="_blank" rel="noopener noreferrer" class="text-blue-600 dark:text-blue-400 hover:underline">${txt}</a>`);
        })
        .replace(/\[\[(.*?)\]\]/g, (_match, title) => {
            const exists = existingTitles ? existingTitles.has(title) : true;
            const className = exists
                ? "wiki-link text-indigo-600 dark:text-indigo-400 cursor-pointer hover:underline font-medium"
                : "wiki-link text-red-500 dark:text-red-400 cursor-pointer hover:underline opacity-80";

            return addPlaceholder(`<span class="${className}" data-link="${title}">${title}</span>`);
        })
        .replace(/(https?:\/\/[^\s)]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-blue-600 dark:text-blue-400 hover:underline">$1</a>');

    placeholders.forEach((content, i) => {
        processed = processed.replace(`__PH_${i}__`, content);
    });

    return processed;
};

const renderMarkdown = (content: string, existingTitles?: Set<string>) => {
    let html = '';
    let inCodeBlock = false;
    let taskIndex = 0;

    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        if (line.trim().startsWith('```')) {
            inCodeBlock = !inCodeBlock;
            html += inCodeBlock 
                ? '<pre class="bg-gray-100 dark:bg-slate-800 p-4 rounded-lg overflow-x-auto my-4 font-mono text-sm text-slate-800 dark:text-slate-200"><code>' 
                : '</code></pre>';
            continue;
        }

        if (inCodeBlock) {
            html += line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") + '\n';
            continue;
        }

        if (line.startsWith('# ')) {
            html += `<h1 class="text-3xl font-bold mb-4 mt-2 text-slate-900 dark:text-white">${parseInline(line.slice(2), existingTitles)}</h1>`;
            continue;
        }
        if (line.startsWith('## ')) {
            html += `<h2 class="text-2xl font-bold mb-3 mt-6 text-slate-800 dark:text-slate-100 border-b border-gray-200 dark:border-slate-800 pb-2">${parseInline(line.slice(3), existingTitles)}</h2>`;
            continue;
        }
        if (line.startsWith('### ')) {
            html += `<h3 class="text-xl font-bold mb-2 mt-4 text-slate-800 dark:text-slate-100">$${parseInline(line.slice(4), existingTitles)}</h3>`;
            continue;
        }
        
        if (line.startsWith('> ')) {
            html += `<blockquote class="border-l-4 border-gray-300 dark:border-slate-700 pl-4 italic my-4 text-slate-600 dark:text-slate-400">${parseInline(line.slice(2), existingTitles)}</blockquote>`;
            continue;
        }

        const taskMatch = line.match(/^(\s*)([-*]|\d+\.)\s+\[([ x])\]\s(.*)$/);
        if (taskMatch) {
            const indentSpace = taskMatch[1].length;
            const isChecked = taskMatch[3] === 'x';
            const text = taskMatch[4];
            const currentTaskIndex = taskIndex++;
            const marginLeft = indentSpace * 12;

            html += `<div class="flex items-start gap-2 my-1" style="margin-left: ${marginLeft}px">
                <input type="checkbox" ${isChecked ? 'checked' : ''} class="mt-1.5 cursor-pointer" data-task-index="${currentTaskIndex}">
                <span class="${isChecked ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-700 dark:text-slate-300'}">${parseInline(text, existingTitles)}</span>
            </div>`;
            continue;
        }

        const ulMatch = line.match(/^(\s*)-\s(.*)$/);
        if (ulMatch) {
             const indentSpace = ulMatch[1].length;
             const marginLeft = 20 + (indentSpace * 12);
             html += `<li class="list-disc text-slate-700 dark:text-slate-300" style="margin-left: ${marginLeft}px">${parseInline(ulMatch[2], existingTitles)}</li>`;
             continue;
        }
        
        const olMatch = line.match(/^(\s*)\d+\.\s(.*)$/);
        if (olMatch) {
             const indentSpace = olMatch[1].length;
             const marginLeft = 20 + (indentSpace * 12);
             html += `<li class="list-decimal text-slate-700 dark:text-slate-300" style="margin-left: ${marginLeft}px">${parseInline(olMatch[2], existingTitles)}</li>`;
             continue;
        }

        if (line.trim() === '---' || line.trim() === '***') {
            html += '<hr class="my-6 border-gray-200 dark:border-slate-800" />';
            continue;
        }

        if (line.trim() === '') {
            html += '<br>';
            continue;
        }

        html += `<p class="mb-2 text-slate-700 dark:text-slate-300 leading-relaxed">${parseInline(line, existingTitles)}</p>`;
    }

    return { __html: html };
};

const Editor: React.FC<EditorProps> = ({ note, allNotes, onUpdate, onLinkClick, onRefactorLinks, onCreateNoteWithContent, onMergeNotes, fontSize, isActive = true, highlightedLine }) => {
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  // -- Content State Management --
  // We use local state for the textarea to prevent cursor jumping due to async DB updates/re-renders
  const [localContent, setLocalContent] = useState(note.content);
  const [originalTitle, setOriginalTitle] = useState(note.title);
  const lastEditTimeRef = useRef<number>(0);
  const prevNoteIdRef = useRef(note.id);

  // If the note ID changes, we must reset the local content immediately (during render) to avoid showing old content
  if (prevNoteIdRef.current !== note.id) {
      prevNoteIdRef.current = note.id;
      setOriginalTitle(note.title);
      setLocalContent(note.content);
  }

  // Handle external updates (e.g. Sync) to the *same* note
  useEffect(() => {
      // If content is different and we haven't edited locally recently (buffer for debounce/lag)
      if (note.id === prevNoteIdRef.current && note.content !== localContent) {
          const timeSinceEdit = Date.now() - lastEditTimeRef.current;
          if (timeSinceEdit > 2000) {
              setLocalContent(note.content);
          }
      }
  }, [note.content, note.id]);

  // Helper to update both local state and persist to DB
  const updateContent = (newContent: string) => {
      setLocalContent(newContent);
      lastEditTimeRef.current = Date.now();
      onUpdate(note.id, { content: newContent });
  };

  // Duplicate detection
  const duplicateNote = useMemo(() => {
    if (!note.title.trim()) return null;
    return allNotes.find(n => 
        n.id !== note.id && 
        !n.deletedAt && 
        n.title.trim().toLowerCase() === note.title.trim().toLowerCase()
    );
  }, [note.title, allNotes, note.id]);

  // Markdown記号を除去して文字数をカウントする関数
  const getCleanCharCount = (text: string) => {
    return text
      .replace(/^#+\s/gm, '')
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .replace(/(\*|_)(.*?)\1/g, '$2')
      .replace(/~~(.*?)~~/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
      .replace(/\[\[(.*?)\]\]/g, '$1')
      .replace(/\n/g, '')
      .length;
  };
  
  // 日付フォーマット関数
  const formatDate = (ts: number) => new Date(ts).toLocaleString();

  useEffect(() => {
    const handleWindowKeyDown = (e: KeyboardEvent) => {
        if (!isActive) return;
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'e') {
            e.preventDefault();
            setMode(prev => prev === 'edit' ? 'preview' : 'edit');
        }
    };
    const handleCustomToggle = () => {
        if (isActive) setMode(prev => prev === 'edit' ? 'preview' : 'edit');
    };
    window.addEventListener('keydown', handleWindowKeyDown);
    window.addEventListener('rhizonote-toggle-preview', handleCustomToggle);
    return () => {
        window.removeEventListener('keydown', handleWindowKeyDown);
        window.removeEventListener('rhizonote-toggle-preview', handleCustomToggle);
    };
  }, [isActive]);

  useEffect(() => {
      const checkMobile = () => setIsMobile(window.innerWidth < 768);
      checkMobile();
      window.addEventListener('resize', checkMobile);
      return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const prevSelectionRef = useRef<number>(0);
  const [currentLineIndex, setCurrentLineIndex] = useState<number>(-1);
  const pendingCursorRef = useRef<number | null>(null);
  const [hoveredImageUrl, setHoveredImageUrl] = useState<string | null>(null);
  const pendingSelectionRef = useRef<{ start: number; end: number; scrollLineIndex?: number } | null>(null);
  const [showPopup, setShowPopup] = useState(false);
  const [popupQuery, setPopupQuery] = useState('');
  const [popupPos, setPopupPos] = useState<{ top?: number; bottom?: number; left: number }>({ top: 0, left: 0 });
  const [cursorIndex, setCursorIndex] = useState(0);

  const [selectionMenu, setSelectionMenu] = useState<{
    top: number;
    left: number;
    text: string;
    start: number;
    end: number;
    showBelow?: boolean;
  } | null>(null);

  const isLinkClickRef = useRef(false);
  const touchCursorRef = useRef<{ startX: number; startY: number; startSelection: number; active: boolean } | null>(null);

  const lastHighlightRef = useRef<any>(null);

  useEffect(() => {
    if (highlightedLine && highlightedLine !== lastHighlightRef.current && highlightedLine.noteId === note.id) {
        lastHighlightRef.current = highlightedLine;
        setTimeout(() => {
             if (backdropRef.current) {
                const lineEl = backdropRef.current.querySelector(`[data-line="${highlightedLine.lineIndex}"]`);
                if (lineEl) {
                    lineEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    if (textareaRef.current) {
                        const lines = localContent.split('\n');
                        let charIndex = 0;
                        for(let i=0; i<highlightedLine.lineIndex; i++) {
                            charIndex += (lines[i]?.length || 0) + 1; 
                        }
                        textareaRef.current.focus();
                        textareaRef.current.setSelectionRange(charIndex, charIndex);
                        setCurrentLineIndex(highlightedLine.lineIndex);
                    }
                }
             }
        }, 50);
    }
  }, [highlightedLine, note.id, localContent]);


  const linkedNotesCount = useMemo(() => {
    if (!originalTitle || originalTitle === note.title) return 0;
    const escapedTitle = originalTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\[\\[${escapedTitle}\\]\\]`);
    return allNotes.filter(n => n.id !== note.id && !n.deletedAt && n.content.match(regex)).length;
  }, [note.title, originalTitle, allNotes, note.id]);

  const networkData = useMemo<{ direct: Note[]; hubs: Record<string, Note[]> }>(() => {
      const activeAllNotes = allNotes.filter(n => !n.deletedAt);
      const currentTitle = note.title;
      const currentId = note.id;
      const getLinks = (content: string) => extractLinks(content);

      // 1. Outgoing (本文に出てくる順序) のリストを作成
      const rawLinks = getLinks(localContent); // リンクテキストの配列（出現順）
      const outgoingNotes: Note[] = [];
      const seenIds = new Set<string>(); // 重復防止用
      seenIds.add(currentId); // 自分自身は除外

      rawLinks.forEach(linkTitle => {
          let target = activeAllNotes.find(n => n.title === linkTitle);
          
          if (target) {
              if (!seenIds.has(target.id)) {
                  outgoingNotes.push(target);
                  seenIds.add(target.id);
              }
          } else {
              // Ghost (まだ存在しないノート) の場合
              const alreadyAdded = outgoingNotes.some(n => n.title === linkTitle);
              if (!alreadyAdded) {
                  const ghost: Note = {
                      id: `ghost-${linkTitle}`,
                      folderId: null,
                      title: linkTitle,
                      content: 'Missing Note',
                      isGhost: true,
                      updatedAt: Date.now(),
                      createdAt: Date.now(),
                      isBookmarked: false
                  };
                  outgoingNotes.push(ghost);
                  seenIds.add(ghost.id);
              }
          }
      });

      // 2. Backlinks (このノートへリンクしているノート) のリストを作成
      // Outgoingに含まれていないものだけを抽出し、更新日時順(新しい順)に並べる
      const backlinkNotes = activeAllNotes
          .filter(n => {
              if (n.id === currentId) return false;
              if (seenIds.has(n.id)) return false; // 既にOutgoingにあるなら除外
              
              // 相手の本文に自分のタイトルが含まれているか
              return getLinks(n.content).includes(currentTitle);
          })
          .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

      // 3. Direct References の完成 (Outgoing順 + Backlink更新順)
      const sortedDirectNotes = [...outgoingNotes, ...backlinkNotes];

      // 4. Hubs (Related Via) の計算
      const hubs: Record<string, Note[]> = {};

      sortedDirectNotes.forEach(neighbor => {
          // Neighbor自体がHubとなって繋がっている先のノートを探す
          const relatedNotes: Note[] = [];

          if (neighbor.isGhost) {
              // Ghostの場合: 他のノートで「このGhostへのリンク」を持っているものを探す (Siblings)
              const siblings = activeAllNotes.filter(n => {
                  if (n.id === currentId) return false;
                  return getLinks(n.content).includes(neighbor.title);
              });
              relatedNotes.push(...siblings);

          } else {
              // 実在ノートの場合: 
              // A (Current) <-> B (Neighbor) <-> C (Related)
              
              // パターン1: Neighbor -> C (NeighborがCへリンクしている)
              const neighborLinks = getLinks(neighbor.content);
              neighborLinks.forEach(link => {
                  if (link === currentTitle) return; // 自分への戻りリンクは除外
                  if (link === neighbor.title) return; // 自己参照は除外

                  let target = activeAllNotes.find(n => n.title === link);
                  if (!target) {
                       // 2-hop先のGhost
                       target = {
                           id: `ghost-via-${neighbor.id}-${link}`,
                           title: link,
                           content: 'Missing Note',
                           isGhost: true,
                           folderId: null,
                           updatedAt: Date.now(),
                           createdAt: Date.now(),
                           isBookmarked: false
                       };
                  }

                  // 自分自身でなければリストに追加
                  if (target.id !== currentId) {
                      relatedNotes.push(target);
                  }
              });

              // パターン2: C -> Neighbor (CがNeighborへリンクしている)
              const incoming = activeAllNotes.filter(n => {
                  if (n.id === currentId) return false;
                  if (n.id === neighbor.id) return false;
                  return getLinks(n.content).includes(neighbor.title);
              });
              relatedNotes.push(...incoming);
          }

          if (relatedNotes.length > 0) {
              // Hub内のノートも重複排除し、更新順にしておく
              const unique = relatedNotes
                  .filter((n, i, self) => i === self.findIndex(s => s.title === n.title))
                  .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
              
              if (unique.length > 0) {
                  hubs[neighbor.title] = unique;
              }
          }
      });

      return {
          direct: sortedDirectNotes,
          hubs: hubs
      };
  }, [localContent, note.title, allNotes, note.id]);

  const linkCandidates = useMemo(() => {
    // 1. まずは既存のノートを候補に入れる
    const candidates = [...allNotes];
    const existingTitles = new Set(allNotes.map(n => n.title));
    const seenGhostTitles = new Set<string>();

    // 2. 全ノート(削除済み除く)の本文を走査して、[[リンク]] を抽出する
    allNotes.forEach(n => {
        if (n.deletedAt) return;

        const links = extractLinks(n.content);
        links.forEach(link => {
            // まだノートが存在せず、かつリストに追加していない場合
            if (!existingTitles.has(link) && !seenGhostTitles.has(link)) {
                seenGhostTitles.add(link);
                // 擬似的なノートオブジェクトを作成して追加
                candidates.push({
                    id: `ghost-${link}`,
                    title: link,
                    content: '',
                    folderId: null,
                    isBookmarked: false,
                    updatedAt: 0,
                    createdAt: 0,
                    isGhost: true // WikiLinkPopup側で区別できるようにフラグを立てる
                } as Note);
            }
        });
    });
    return candidates;
  }, [allNotes]);

  useEffect(() => {
      if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
      if (textareaRef.current) {
          textareaRef.current.scrollTop = 0;
          textareaRef.current.setSelectionRange(0, 0);
          prevSelectionRef.current = 0;
          setCurrentLineIndex(-1);
          if (isActive && mode === 'edit') setTimeout(() => textareaRef.current?.focus(), 10);
      }
      if (backdropRef.current) backdropRef.current.scrollTop = 0;
      setShowPopup(false);
  }, [note.id]);

  useEffect(() => {
    if (mode === 'edit' && textareaRef.current && isActive) textareaRef.current.focus();
  }, [mode, isActive]);

  useLayoutEffect(() => {
    if (textareaRef.current) {
        if (pendingSelectionRef.current) {
            const { start, end, scrollLineIndex } = pendingSelectionRef.current;
            textareaRef.current.setSelectionRange(start, end);
            if (scrollLineIndex !== undefined && backdropRef.current) {
                const lineEl = backdropRef.current.querySelector(`[data-line="${scrollLineIndex}"]`);
                if (lineEl) lineEl.scrollIntoView({ block: 'nearest' });
            }
            const line = localContent.substring(0, start).split('\n').length - 1;
            setCurrentLineIndex(line);
            prevSelectionRef.current = start;
            pendingSelectionRef.current = null;
            pendingCursorRef.current = null;
        } else if (pendingCursorRef.current !== null) {
            textareaRef.current.setSelectionRange(pendingCursorRef.current, pendingCursorRef.current);
            const pos = pendingCursorRef.current;
            prevSelectionRef.current = pos;
            const line = localContent.substring(0, pos).split('\n').length - 1;
            setCurrentLineIndex(line);
            pendingCursorRef.current = null;
        }
    }
  });

  const updateLineTracking = () => {
      if (textareaRef.current) {
          const pos = textareaRef.current.selectionStart;
          prevSelectionRef.current = pos;
          const line = localContent.substring(0, pos).split('\n').length - 1;
          setCurrentLineIndex(line);
      }
  };

  const checkAutocomplete = (currentCursor: number, text: string) => {
    const textBefore = text.slice(0, currentCursor);
    const lastOpen = textBefore.lastIndexOf('[[');
    const lastClose = textBefore.lastIndexOf(']]');
    if (lastOpen !== -1 && lastOpen > lastClose) {
        const query = textBefore.slice(lastOpen + 2);
        if (!query.includes('\n') && !query.includes('`')) {
            setPopupQuery(query);
            setShowPopup(true);
            const coords = measureSelection(lastOpen, lastOpen + 2);
            if (coords && containerRef.current) {
                 const containerRect = containerRef.current.getBoundingClientRect();
                 const lineHeight = 24; 
                 const topPos = containerRect.top + coords.top + lineHeight; 
                 const left = containerRect.left + coords.left;
                 const POPUP_EST_HEIGHT = 180; 
                 const viewportHeight = window.innerHeight;
                 if (topPos + POPUP_EST_HEIGHT > viewportHeight) {
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
    
    updateContent(newVal);
    
    setCursorIndex(newCursorPos);
    prevSelectionRef.current = newCursorPos;
    const line = newVal.substring(0, newCursorPos).split('\n').length - 1;
    setCurrentLineIndex(line);
    setSelectionMenu(null);
    checkAutocomplete(newCursorPos, newVal);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLTextAreaElement>) => {
      if (!textareaRef.current) return;
      
      // テキストエリアのポインターイベントを一瞬無効化して、背面の要素を取得するハック
      textareaRef.current.style.pointerEvents = 'none';
      const el = document.elementFromPoint(e.clientX, e.clientY);
      textareaRef.current.style.pointerEvents = 'auto';
      
      let cursor = 'text';
      let newHoveredImage = null;

      if (el) {
          // リンクタイトルの判定
          if (el.hasAttribute('data-link-title') || el.hasAttribute('data-url')) {
              cursor = 'pointer';
          }
          
          // 画像プレビュー対象かどうかの判定 (data-image-preview属性を確認)
          const imgUrl = el.getAttribute('data-image-preview');
          if (imgUrl) {
              newHoveredImage = imgUrl;
          }
      }
      
      // カーソルスタイルの適用
      if (textareaRef.current.style.cursor !== cursor) textareaRef.current.style.cursor = cursor;
      // ホバー中の画像状態を更新（変更があった場合のみ再レンダリング）
      if (hoveredImageUrl !== newHoveredImage) {
          setHoveredImageUrl(newHoveredImage);
      }
  };
  
  const measureSelection = (start: number, end: number) => {
    if (!textareaRef.current) return null;
    const textarea = textareaRef.current;
    const div = document.createElement('div');
    const styles = window.getComputedStyle(textarea);
    const props = [
        'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'line-height', 
        'text-transform', 'word-spacing', 'text-indent', 'white-space', 'word-break', 'overflow-wrap',
        'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
        'border-width', 'box-sizing'
    ];
    props.forEach(prop => div.style.setProperty(prop, styles.getPropertyValue(prop)));
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
    return { top: relativeTop, left: relativeLeft + (width / 2) };
  };

  const updateSelectionMenu = () => {
    if (!textareaRef.current || !containerRef.current) return;
    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    if (start !== end) {
        const text = localContent.substring(start, end);
        let top = 0;
        let left = 0;
        const coords = measureSelection(start, end);
        let showBelow = false; 
        if (coords) {
            top = coords.top;
            left = coords.left;
            if (top < 50) showBelow = true;
        }
        setSelectionMenu({ top, left, text, start, end, showBelow });
    } else {
        setSelectionMenu(null);
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLTextAreaElement>) => {
      if (textareaRef.current) {
          textareaRef.current.style.pointerEvents = 'none';
          const el = document.elementFromPoint(e.clientX, e.clientY);
          textareaRef.current.style.pointerEvents = 'auto';
          if (el) {
              const url = el.getAttribute('data-url');
              const wikiLink = el.getAttribute('data-link-title');
              if (url || wikiLink) {
                  e.preventDefault(); 
                  e.stopPropagation(); 
                  isLinkClickRef.current = true; 
                  if (url) window.open(url, '_blank');
                  if (wikiLink) onLinkClick(wikiLink);
                  return;
              }
          }
          prevSelectionRef.current = textareaRef.current.selectionStart;
      }
      isLinkClickRef.current = false;
  };

  const handleMouseUp = () => {
    if (isLinkClickRef.current) {
        isLinkClickRef.current = false;
        return; 
    }
    updateSelectionMenu();
    if (textareaRef.current) {
        const pos = textareaRef.current.selectionStart;
        const line = localContent.substring(0, pos).split('\n').length - 1;
        setCurrentLineIndex(line);
        checkAutocomplete(pos, localContent);
    }
  };

  // タッチ開始時の座標とカーソル位置を記録
  const handleTouchStart = (e: React.TouchEvent<HTMLTextAreaElement>) => {
    if (e.touches.length !== 1 || !textareaRef.current) return;
    if (textareaRef.current.selectionStart !== textareaRef.current.selectionEnd) {
        return;
    }

    const touch = e.touches[0];
    touchCursorRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        startSelection: textareaRef.current.selectionStart,
        active: false // まだスワイプ動作とは確定していない
    };
  };

  // タッチ移動時の計算（横移動ならカーソル操作、縦ならスクロール）
  const handleTouchMove = (e: React.TouchEvent<HTMLTextAreaElement>) => {
    if (!touchCursorRef.current || !textareaRef.current) return;

    const touch = e.touches[0];
    const deltaX = touch.clientX - touchCursorRef.current.startX;
    const deltaY = touch.clientY - touchCursorRef.current.startY;

    // まだカーソルモードになっていない場合、判定を行う
    if (!touchCursorRef.current.active) {
        // 横移動が10px以上、かつ縦移動よりも明らかに大きい場合、カーソルモードとみなす
        if (Math.abs(deltaX) > 10 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
            touchCursorRef.current.active = true;
        } else if (Math.abs(deltaY) > 10) {
            // 縦移動が大きい場合はスクロールとみなし、追跡をキャンセル
            touchCursorRef.current = null;
            return;
        }
    }

    // カーソルモード中の処理
    if (touchCursorRef.current?.active) {
        // ブラウザの「戻る/進む」やスクロールを防ぐ
        if (e.cancelable) e.preventDefault();

        // 感度調整: 12pxにつき1文字移動
        const charsMove = Math.round(deltaX / 12);
        const newPos = Math.max(0, Math.min(localContent.length, touchCursorRef.current.startSelection + charsMove));

        if (textareaRef.current.selectionStart !== newPos) {
            textareaRef.current.setSelectionRange(newPos, newPos);
            
            // UI更新（行ハイライトなど）
            const line = localContent.substring(0, newPos).split('\n').length - 1;
            setCurrentLineIndex(line);
            setCursorIndex(newPos);
            
            // 選択メニューなどを閉じる
            setSelectionMenu(null);
        }
    }
  };

  // タッチ終了時のクリーンアップ
  const handleTouchEnd = () => {
    touchCursorRef.current = null;
    handleMouseUp(); // 既存のhandleMouseUp（オートコンプリートチェック等）も呼ぶ
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
    const newValue = localContent.substring(0, start) + prefix + text + suffix + localContent.substring(end);
    updateContent(newValue);
    setSelectionMenu(null);
    if(textareaRef.current) {
        textareaRef.current.focus();
        pendingCursorRef.current = start + prefix.length + text.length + suffix.length;
    }
  };

  const handleExtractNote = () => {
    if (!selectionMenu || !onCreateNoteWithContent) return;
    const { start, end, text } = selectionMenu;
    const lines = text.split('\n');
    const title = lines[0].trim();
    let content = lines.length > 1 ? lines.slice(1).join('\n').trim() : '';
    content += `\n\nfrom [[${note.title}]]`;
    if (!title) return;
    onCreateNoteWithContent(title, content);
    const newValue = localContent.substring(0, start) + `[[${title}]]` + localContent.substring(end);
    updateContent(newValue);
    setSelectionMenu(null);
    if(textareaRef.current) {
        textareaRef.current.focus();
        pendingCursorRef.current = start + title.length + 4; 
    }
  };

  const handleContentClick = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    updateSelectionMenu();
    const target = e.target as HTMLTextAreaElement;
    const currentClickIndex = target.selectionStart;
    const content = localContent;
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
            updateContent(newContent);
            updateLineTracking(); 
            return;
        }
    }
    updateLineTracking();
    checkAutocomplete(currentClickIndex, content);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const target = e.currentTarget;
    // --- 太字 (Ctrl+B / Cmd+B) ---
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        const start = target.selectionStart;
        const end = target.selectionEnd;
        
        // テキストが選択されている場合のみ実行
        if (start !== end) {
            const text = target.value.substring(start, end);
            const wrapper = '**';
            
            // 前後に ** を追加して更新
            const newValue = target.value.substring(0, start) + wrapper + text + wrapper + target.value.substring(end);
            updateContent(newValue);
            
            // 更新後に選択範囲を維持するための処理
            // 文字数が4文字（**と**）増えるため、選択範囲も調整します
            pendingSelectionRef.current = { 
                start: start, 
                end: end + 4 
            };
        }
        return;
    }

    // --- 斜体 (Ctrl+I / Cmd+I) ---
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        const start = target.selectionStart;
        const end = target.selectionEnd;
        
        // テキストが選択されている場合のみ実行
        if (start !== end) {
            const text = target.value.substring(start, end);
            const wrapper = '*';
            
            // 前後に * を追加して更新
            const newValue = target.value.substring(0, start) + wrapper + text + wrapper + target.value.substring(end);
            updateContent(newValue);
            
            // 更新後に選択範囲を維持するための処理
            // 文字数が2文字（*と*）増えるため、選択範囲も調整します
            pendingSelectionRef.current = { 
                start: start, 
                end: end + 2 
            };
        }
        return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === '[') {
        const start = target.selectionStart;
        const end = target.selectionEnd;
        if (start !== end) {
            e.preventDefault();
            e.stopPropagation(); 
            const text = target.value.substring(start, end);
            const newValue = target.value.substring(0, start) + `[[${text}]]` + target.value.substring(end);
            updateContent(newValue);
            pendingCursorRef.current = end + 4; 
            return;
        }
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        const start = target.selectionStart;
        const end = target.selectionEnd;
        if (start !== end) {
            const text = localContent.substring(start, end);
            if (!onCreateNoteWithContent) return;
            const lines = text.split('\n');
            const title = lines[0].trim();
            let content = lines.length > 1 ? lines.slice(1).join('\n').trim() : '';
            content += `\n\nfrom [[${note.title}]]`;
            if (title) {
                 onCreateNoteWithContent(title, content);
                 const newValue = localContent.substring(0, start) + `[[${title}]]` + localContent.substring(end);
                 pendingCursorRef.current = start + title.length + 4;
                 updateContent(newValue);
                 setSelectionMenu(null); 
            }
        }
        return;
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        const start = target.selectionStart;
        const value = target.value;
        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        let lineEnd = value.indexOf('\n', start);
        if (lineEnd === -1) lineEnd = value.length;
        const currentLine = value.slice(lineStart, lineEnd);
        let newLine = currentLine;
        let newPos = start;
        const taskMatch = currentLine.match(/^(\s*)-\s\[([ x])\]\s(.*)$/);
        if (taskMatch) {
            const indent = taskMatch[1];
            const isChecked = taskMatch[2] === 'x';
            const content = taskMatch[3];
            if (!isChecked) {
                newLine = `${indent}- [x] ${content}`;
            } else {
                newLine = `${indent}${content}`;
                if (start >= lineStart + indent.length + 6) newPos = start - 6;
                else if (start > lineStart + indent.length) newPos = lineStart + indent.length;
            }
        } else {
            const listMatch = currentLine.match(/^(\s*)-\s(.*)$/);
            if (listMatch) {
                newLine = `${listMatch[1]}- [ ] ${listMatch[2]}`;
                if (start >= lineStart + listMatch[1].length + 2) newPos = start + 4;
            } else {
                const indentMatch = currentLine.match(/^(\s*)(.*)$/);
                const indent = indentMatch ? indentMatch[1] : '';
                const content = indentMatch ? indentMatch[2] : currentLine;
                newLine = `${indent}- [ ] ${content}`;
                 if (start >= lineStart + indent.length) newPos = start + 6;
            }
        }
        const newValue = value.slice(0, lineStart) + newLine + value.slice(lineEnd);
        updateContent(newValue);
        pendingCursorRef.current = newPos;
        return;
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const start = target.selectionStart;
        const end = target.selectionEnd;
        const value = target.value;
        const lines = value.split('\n');
        const startLineIndex = value.substring(0, start).split('\n').length - 1;
        let endLineIndex = value.substring(0, end).split('\n').length - 1;
        if (end > start && value[end - 1] === '\n') {
             const linesUntilEnd = value.substring(0, end).split('\n');
             if (linesUntilEnd[linesUntilEnd.length - 1] === '') {
                 endLineIndex = Math.max(startLineIndex, endLineIndex - 1);
             }
        }
        if (e.key === 'ArrowUp' && startLineIndex > 0) {
            const lineToMoveDown = lines[startLineIndex - 1];
            const blockToMove = lines.slice(startLineIndex, endLineIndex + 1);
            lines.splice(startLineIndex, blockToMove.length);
            lines.splice(startLineIndex - 1, 0, ...blockToMove);
            const newContent = lines.join('\n');
            updateContent(newContent);
            const shiftAmount = -(lineToMoveDown.length + 1);
            pendingSelectionRef.current = { start: start + shiftAmount, end: end + shiftAmount, scrollLineIndex: startLineIndex - 1 };
        } 
        else if (e.key === 'ArrowDown' && endLineIndex < lines.length - 1) {
             const lineToMoveUp = lines[endLineIndex + 1];
             const blockToMove = lines.slice(startLineIndex, endLineIndex + 1);
             lines.splice(startLineIndex, blockToMove.length);
             lines.splice(startLineIndex + 1, 0, ...blockToMove);
             const newContent = lines.join('\n');
             updateContent(newContent);
             const shiftAmount = lineToMoveUp.length + 1;
             pendingSelectionRef.current = { start: start + shiftAmount, end: end + shiftAmount, scrollLineIndex: endLineIndex + 1 };
        }
        return;
    }
    if (e.key === 'Tab') {
        e.preventDefault();
        const start = target.selectionStart;
        const end = target.selectionEnd;
        const value = target.value;

        // 1. 選択範囲が含まれる「行の範囲」を特定する
        const startLineStart = value.lastIndexOf('\n', start - 1) + 1;
        let endLineEnd = value.indexOf('\n', end);
        if (endLineEnd === -1) endLineEnd = value.length;

        // 末尾が改行文字ちょうどの場合の調整
        if (end > start && value[end - 1] === '\n' && endLineEnd === end - 1) {
             // 必要であればここで調整（現状はそのままでOK）
        }

        // 2. 影響を受ける行だけを配列として取り出す
        const activeLines = value.substring(startLineStart, endLineEnd).split('\n');

        if (e.shiftKey) {
            // --- Shift + Tab (アンインデント: 削除) ---
            const newLines = activeLines.map(line => {
                if (line.startsWith('  ')) return line.substring(2);
                if (line.startsWith('\t')) return line.substring(1);
                return line;
            });

            const newBlock = newLines.join('\n');
            const newValue = value.substring(0, startLineStart) + newBlock + value.substring(endLineEnd);

            updateContent(newValue);

            if (start === end) {
                // 選択なし（カーソルのみ）：カーソル位置を調整して選択はしない
                const deletedLength = activeLines[0].length - newLines[0].length;
                pendingCursorRef.current = Math.max(startLineStart, start - deletedLength);
            } else {
                // 範囲選択あり：行全体を選択状態で維持する
                pendingSelectionRef.current = {
                    start: startLineStart,
                    end: startLineStart + newBlock.length
                };
            }

        } else {
            // --- Tab (インデント: 追加) ---

            if (start === end) {
                // 選択なし（カーソルのみ）：行頭にスペースを挿入する
                const newValue = value.substring(0, startLineStart) + '  ' + value.substring(startLineStart);
                updateContent(newValue);
                pendingCursorRef.current = start + 2;
                return;
            }

            // 範囲選択あり：選択された行すべてのアタマにスペースを追加
            const newLines = activeLines.map(line => '  ' + line);
            const newBlock = newLines.join('\n');
            const newValue = value.substring(0, startLineStart) + newBlock + value.substring(endLineEnd);
            
            updateContent(newValue);
            
            // 選択範囲を行全体に広げて維持する
            pendingSelectionRef.current = {
                start: startLineStart,
                end: startLineStart + newBlock.length
            };
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
        const taskRegex = /^(\s*)([-*]|\d+\.)\s+\[([ x])\]\s/;
        const taskMatch = currentLine.match(taskRegex);
        const fullPrefix = taskMatch ? taskMatch[0] : basePrefix;
        if (currentLine.trim() === fullPrefix.trim()) {
            const newValue = value.slice(0, currentLineStart) + value.slice(start);
            pendingCursorRef.current = currentLineStart;
            updateContent(newValue);
        } else {
            let nextPrefix = basePrefix;
            const numMatch = basePrefix.match(/^(\s*)(\d+)\.\s/);
            if (numMatch) {
                const num = parseInt(numMatch[2], 10);
                nextPrefix = `${numMatch[1]}${num + 1}. `;
            }
            if (taskMatch) nextPrefix = nextPrefix.trimEnd() + ' [ ] ';
            const newValue = value.slice(0, start) + '\n' + nextPrefix + value.slice(start);
            pendingCursorRef.current = start + 1 + nextPrefix.length;
            updateContent(newValue);
        }
      }
    }
  };

  const handleKeyUp = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    updateLineTracking();
    updateSelectionMenu();
    const target = e.target as HTMLTextAreaElement;
    checkAutocomplete(target.selectionStart, localContent);
  };

  const insertWikiLink = (title: string) => {
    if (!textareaRef.current) return;
    const value = localContent;
    const textBeforeCursor = value.slice(0, cursorIndex);
    const lastOpenBracket = textBeforeCursor.lastIndexOf('[[');
    if (lastOpenBracket !== -1) {
      const newValue = value.slice(0, lastOpenBracket) + `[[${title}]]` + value.slice(cursorIndex);
      pendingCursorRef.current = lastOpenBracket + 2 + title.length + 2;
      updateContent(newValue);
      setShowPopup(false);
    }
  };

  const renderBackdrop = (content: string, activeLine: number) => {
      const lines = content.split('\n');
      const existingTitles = new Set(allNotes.filter(n => !n.deletedAt).map(n => n.title));
      
      return lines.map((line, index) => {
          const isActive = index === activeLine;
          
          if (isActive) {
              return (
                <div 
                    key={index} 
                    className="whitespace-pre-wrap break-words bg-transparent min-h-[1.5em] w-full text-slate-800 dark:text-slate-300"
                    data-line={index}
                >
                    {line || <br/>}
                </div>
              );
          }

          let contentNode: React.ReactNode = line;
          const regex = /(`[^`]+`|!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\)|\[\[[^\]]+\]\]|https?:\/\/[^\s)]+)/g;
          const parts = line.split(regex);
          if (parts.length > 1) {
             contentNode = parts.map((part, i) => {
                 if (part.startsWith('`')) {
                     return <span key={i} className="text-amber-600 dark:text-amber-200">{part}</span>;
                 }
                 if (part.startsWith('![') && part.includes('](') && part.endsWith(')')) {
                    const match = part.match(/!\[([^\]]*)\]\(([^)]+)\)/);
                    if (match) {
                        const alt = match[1];
                        const url = match[2];
                        return (
                            <span key={i} className="text-amber-600 dark:text-amber-500 relative inline-block">
                                {'!['}{alt}{']('}
                                <span 
                                    className="underline decoration-amber-500 cursor-pointer pointer-events-auto relative z-10"
                                    data-url={url}
                                    data-line-index={index}
                                    data-image-preview={url}
                                >
                                    {url}
                                </span>
                                {')'}

                                {/* CSSホバーではなく、State (hoveredImageUrl) に基づいて表示を制御 */}
                                <span 
                                    className={`
                                        absolute left-0 top-full mt-2 z-50 pointer-events-none select-none px-2
                                        ${hoveredImageUrl === url ? 'block' : 'hidden'}
                                    `}
                                >
                                    <div className="bg-white dark:bg-slate-800 p-1 border border-gray-200 dark:border-slate-700 shadow-xl animate-in fade-in zoom-in-95 duration-150">
                                        <img 
                                            src={url} 
                                            alt={alt} 
                                            className="max-w-[360px] max-h-[300px] object-contain bg-gray-50 dark:bg-slate-900"
                                            onError={(e) => {
                                                e.currentTarget.style.display = 'none';
                                            }}
                                        />
                                    </div>
                                </span>
                            </span>
                        );
                    }
                    return <span key={i} className="text-amber-600 dark:text-amber-500">{part}</span>;
                 }
                 if (part.startsWith('[') && !part.startsWith('[[') && part.includes('](') && part.endsWith(')')) {
                    const match = part.match(/\[([^\]]+)\]\(([^)]+)\)/);
                    if (match) {
                        const text = match[1];
                        const url = match[2];
                        return (
                            <span key={i} className="text-blue-600 dark:text-blue-400">
                                {'['}
                                <span className="text-blue-600 dark:text-blue-400">{text}</span>
                                {']('}
                                <span 
                                    className="underline decoration-blue-500 cursor-pointer pointer-events-auto relative"
                                    data-url={url}
                                    data-line-index={index}
                                >
                                    {url}
                                </span>
                                {')'}
                            </span>
                        );
                    }
                    return <span key={i} className="text-blue-600 dark:text-blue-400">{part}</span>;
                 }
                 if (part.startsWith('[[') && part.endsWith(']]')) {
                     const title = part.slice(2, -2);
                     const exists = existingTitles.has(title);
                     return (
                         <span 
                            key={i} 
                            className={`
                                ${exists 
                                    ? 'text-indigo-600 dark:text-indigo-400 underline decoration-indigo-500 pointer-events-auto'
                                    : 'text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 underline opacity-60 pointer-events-auto'
                                }
                                relative
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
                            className="text-blue-600 dark:text-blue-400 underline decoration-blue-500 pointer-events-auto relative"
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
            <div 
                key={index} 
                className="whitespace-pre-wrap break-words bg-white dark:bg-slate-950 min-h-[1.5em] w-full" 
                data-line={index}
            >
                {contentNode}
            </div>
          );
      });
  };

  const handlePreviewTaskToggle = (taskIndex: number) => {
    const lines = localContent.split('\n');
    let currentTaskCount = 0;
    let inCodeBlock = false;
    const newLines = lines.map(line => {
        if (line.trim().startsWith('```')) {
            inCodeBlock = !inCodeBlock;
            return line;
        }
        if (inCodeBlock) return line;
        const taskRegex = /^(\s*)([-*]|\d+\.)\s+\[([ x])\]\s(.*)$/;
        const match = line.match(taskRegex);
        if (match) {
            const isTarget = currentTaskCount === taskIndex;
            currentTaskCount++;
            if (isTarget) {
                const isChecked = match[3] === 'x';
                const newStatus = isChecked ? ' ' : 'x';
                return `${match[1]}${match[2]} [${newStatus}] ${match[4]}`;
            }
        }
        return line;
    });
    updateContent(newLines.join('\n'));
  };

  const handlePreviewClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('wiki-link')) {
      const link = target.getAttribute('data-link');
      if (link) onLinkClick(link);
      return;
    }
    if (target.tagName === 'INPUT' && target.getAttribute('type') === 'checkbox') {
        const indexStr = target.getAttribute('data-task-index');
        if (indexStr !== null) {
            const index = parseInt(indexStr, 10);
            handlePreviewTaskToggle(index);
        }
    }
  };

  const hasRelatedNotes = networkData.direct.length > 0 || Object.keys(networkData.hubs).length > 0;

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-950 relative group transition-colors duration-200">
      {/* Header */}
      <div className="flex flex-col px-6 py-3 border-b border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50 z-20">
        <div className="flex items-center justify-between">
            <textarea
                value={note.title}
                onChange={(e) => {
                    onUpdate(note.id, { title: e.target.value });
                    e.target.style.height = 'auto';
                    e.target.style.height = e.target.scrollHeight + 'px';
                }}
                ref={(el) => {
                    if (el) {
                        el.style.height = 'auto';
                        el.style.height = el.scrollHeight + 'px';
                    }
                }}
                rows={1}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') e.preventDefault();
                }}
                className="bg-transparent text-xl font-bold text-slate-800 dark:text-slate-200 focus:outline-none w-full mr-4 placeholder-slate-400 dark:placeholder-slate-600 resize-none overflow-hidden"
                placeholder="Note Title"
            />
            <div className="flex items-center gap-2">
                <div 
                    className="relative"
                    onMouseEnter={() => setShowInfo(true)}
                    onMouseLeave={() => setShowInfo(false)}
                >
                    <button
                        className={`p-1.5 rounded transition-colors ${showInfo ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}
                        title="Note Info"
                    >
                        <Info size={18} />
                    </button>

                    {showInfo && (
                        /* ポップアップ本体 */
                        <div className="absolute right-0 top-full pt-2 z-50">
                            <div className="w-64 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg shadow-xl p-4 text-sm animate-in fade-in zoom-in-95 duration-100">
                                <div className="space-y-3">
                                    <div>
                                        <div className="text-xs text-slate-400 uppercase tracking-wider font-semibold mb-1">Created</div>
                                        <div className="text-slate-700 dark:text-slate-300 font-mono text-xs">
                                            {formatDate(note.createdAt)}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-slate-400 uppercase tracking-wider font-semibold mb-1">Updated</div>
                                        <div className="text-slate-700 dark:text-slate-300 font-mono text-xs">
                                            {formatDate(note.updatedAt)}
                                        </div>
                                    </div>
                                    <div className="pt-2 border-t border-gray-100 dark:border-slate-800">
                                        <div className="flex justify-between items-center">
                                            <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Characters</span>
                                            <span className="text-indigo-600 dark:text-indigo-400 font-bold font-mono">
                                                {getCleanCharCount(localContent).toLocaleString()}
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center mt-1">
                                            <span className="text-xs text-slate-400">Raw Length</span>
                                            <span className="text-slate-500 dark:text-slate-500 text-xs font-mono">
                                                {localContent.length.toLocaleString()}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        )}
                    </div>
                <div className="flex items-center gap-2 bg-gray-200 dark:bg-slate-800 rounded p-1">
                <button
                    onClick={() => setMode('edit')}
                    className={`p-1.5 rounded transition-colors ${mode === 'edit' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}
                    title="Edit Mode (Ctrl/Cmd + E)"
                >
                    <Edit3 size={16} />
                </button>
                <button
                    onClick={() => setMode('preview')}
                    className={`p-1.5 rounded transition-colors ${mode === 'preview' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}
                    title="Reading Mode (Ctrl/Cmd + E)"
                >
                    <Eye size={16} />
                </button>
                </div>
            </div>
        </div>

        {/* Duplicate Warning Banner */}
        {duplicateNote && (
            <div className="mt-2 flex items-center justify-between bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800/50 rounded-md px-3 py-2 animate-in fade-in slide-in-from-top-1 duration-200">
                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 text-sm">
                    <AlertTriangle size={16} className="shrink-0" />
                    <span>
                        Title already exists in <b>{duplicateNote.title}</b>
                    </span>
                </div>
                {onMergeNotes && (
                    <button
                        onClick={() => onMergeNotes(note.id, duplicateNote.id, originalTitle)}
                        className="flex items-center gap-1.5 px-3 py-1 bg-amber-100 dark:bg-amber-800/50 hover:bg-amber-200 dark:hover:bg-amber-800 text-amber-800 dark:text-amber-200 rounded text-xs font-semibold transition-colors"
                        title="Merge this note into the existing one and update links"
                    >
                        <Merge size={14} />
                        Merge
                    </button>
                )}
            </div>
        )}
        
        {linkedNotesCount > 0 && !duplicateNote && (
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
                <div 
                    ref={backdropRef}
                    className={`min-h-full px-8 pt-4 pb-12 font-sans text-slate-800 dark:text-slate-300 whitespace-pre-wrap break-words pointer-events-none z-0`}
                    style={{ fontSize: `${fontSize}px`, lineHeight: 1.6 }}
                    aria-hidden="true"
                >
                    {renderBackdrop(localContent, currentLineIndex)}
                </div>

                <textarea
                ref={textareaRef}
                value={localContent}
                onChange={handleChange}
                onClick={handleContentClick}
                onSelect={updateSelectionMenu}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseLeave={() => { if(textareaRef.current) textareaRef.current.style.cursor = 'text'; }}
                onMouseUp={handleMouseUp}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onKeyDown={handleKeyDown}
                onKeyUp={handleKeyUp}
                onBlur={() => setSelectionMenu(null)}
                className={`absolute inset-0 w-full h-full px-8 pt-4 pb-12 bg-transparent caret-indigo-600 dark:caret-slate-200 font-sans resize-none focus:outline-none overflow-hidden z-10 text-transparent`}
                style={{ fontSize: `${fontSize}px`, lineHeight: 1.6 }}
                placeholder="Start typing..."
                spellCheck={false}
                />
                
                {selectionMenu && (
                    <div 
                        className={`
                            z-50 flex items-center bg-slate-900 dark:bg-slate-200 shadow-xl border border-slate-700 dark:border-slate-300 gap-0.5 animate-in fade-in duration-100
                            ${isMobile 
                                ? 'absolute rounded-full px-3 py-2 shadow-2xl -translate-x-1/2 mt-8' 
                                : selectionMenu.showBelow
                                    ? 'absolute rounded-md p-1 -translate-x-1/2 mt-8 zoom-in-95'
                                    : 'absolute rounded-md p-1 -translate-x-1/2 -translate-y-full mt-[-10px] zoom-in-95'
                            }
                        `}
                        style={{ top: selectionMenu.top, left: selectionMenu.left }} 
                        onMouseDown={(e) => e.preventDefault()} 
                    >
                        {!selectionMenu.text.includes('\n') && (
                            <>
                                <button onClick={() => handleWrapText('**')} className="p-1.5 md:p-1 text-slate-300 dark:text-slate-800 hover:text-white dark:hover:text-black hover:bg-slate-700 dark:hover:bg-slate-300 rounded" title="Bold"><Bold size={14} /></button>
                                <button onClick={() => handleWrapText('*')} className="p-1.5 md:p-1 text-slate-300 dark:text-slate-800 hover:text-white dark:hover:text-black hover:bg-slate-700 dark:hover:bg-slate-300 rounded" title="Italic"><Italic size={14} /></button>
                                <button onClick={() => handleWrapText('~~')} className="p-1.5 md:p-1 text-slate-300 dark:text-slate-800 hover:text-white dark:hover:text-black hover:bg-slate-700 dark:hover:bg-slate-300 rounded" title="Strikethrough"><Strikethrough size={14} /></button>
                                <button onClick={() => handleWrapText('`')} className="p-1.5 md:p-1 text-slate-300 dark:text-slate-800 hover:text-white dark:hover:text-black hover:bg-slate-700 dark:hover:bg-slate-300 rounded" title="Code"><Code size={14} /></button>
                                <button onClick={() => handleWrapText('[[')} className="p-1.5 md:p-1 text-slate-300 dark:text-slate-800 hover:text-white dark:hover:text-black hover:bg-slate-700 dark:hover:bg-slate-300 rounded" title="Link"><LinkIcon size={14} /></button>
                            </>
                        )}
                        {selectionMenu.text.includes('\n') && (
                            <button onClick={handleExtractNote} className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-slate-300 dark:text-slate-800 hover:text-white dark:hover:text-black hover:bg-slate-700 dark:hover:bg-slate-300 rounded" title="Extract to New Note (Cmd+Shift+E)"><FilePlus size={14} /><span>Extract Note</span></button>
                        )}
                        {!isMobile && (
                            <div className={`
                                absolute left-1/2 w-2 h-2 bg-slate-900 dark:bg-slate-200 -translate-x-1/2 rotate-45
                                ${selectionMenu.showBelow
                                    ? 'top-0 -translate-y-1/2 border-l border-t border-slate-700 dark:border-slate-300'
                                    : 'bottom-0 translate-y-1/2 border-r border-b border-slate-700 dark:border-slate-300'
                                }
                            `}></div>
                        )}
                    </div>
                )}
                {showPopup && (
                <WikiLinkPopup
                    query={popupQuery}
                    notes={linkCandidates}
                    onSelect={insertWikiLink}
                    position={popupPos}
                    onClose={() => setShowPopup(false)}
                    currentNoteId={note.id}
                />
                )}
            </div>
            ) : (
            <div 
                className="w-full h-full px-8 pt-4 pb-12 prose prose-slate dark:prose-invert max-w-none transition-colors duration-200 flex-1 min-h-[200px] break-words"
                style={{ fontSize: `${fontSize}px` }}
                dangerouslySetInnerHTML={renderMarkdown(
                    localContent, 
                    new Set(allNotes.filter(n => !n.deletedAt).map(n => n.title))
                )}
                onClick={handlePreviewClick}
            />
            )}

            {/* Footer: Related Notes (Cosense-like Layout) */}
            {hasRelatedNotes && (
                <div className="border-t border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-950/50 p-6 shrink-0 mt-auto">
                    
                    {/* 1. Direct References (Standard Grid) */}
                    {networkData.direct.length > 0 && (
                        <div className="mb-8">
                            <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4">Direct References</h3>
                            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                                {networkData.direct.map(n => (
                                    <NoteCard 
                                        key={n.id} 
                                        note={n} 
                                        onLinkClick={onLinkClick} 
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* 2. Indirect (2-Hop) Links Grouped by Hub */}
                    {Object.keys(networkData.hubs).length > 0 && (
                        <div>
                             <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4">Related via...</h3>
                             <div className="space-y-8">
                                {(Object.entries(networkData.hubs) as [string, Note[]][]).map(([hubTitle, connectedNotes]) => (
                                    <div key={hubTitle} className="">
                                        <div 
                                            className="inline-flex items-center gap-1.5 px-2 py-1 mb-3 rounded text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer hover:underline"
                                            onClick={() => onLinkClick(hubTitle)}
                                        >
                                            <Link2 size={14} className="text-indigo-400 dark:text-indigo-500" />
                                            {hubTitle}
                                        </div>
                                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                                            {connectedNotes.map(n => (
                                                <NoteCard 
                                                    key={n.id} 
                                                    note={n} 
                                                    onLinkClick={onLinkClick} 
                                                />
                                            ))}
                                        </div>
                                    </div>
                                ))}
                             </div>
                        </div>
                    )}
                </div>
            )}
        </div>
      </div>
    </div>
  );
};

export default Editor;