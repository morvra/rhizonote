import JSZip from 'jszip';
import saveAs from 'file-saver';
import { Note, Folder } from '../types';
import { getNotePath } from './dropboxService';

// Markdownを簡易HTMLに変換するヘルパー
const convertMarkdownToHtml = (title: string, content: string): string => {
  let htmlBody = content
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") // Escape
    .replace(/^# (.*$)/gm, '<h1>$1</h1>')
    .replace(/^## (.*$)/gm, '<h2>$1</h2>')
    .replace(/^### (.*$)/gm, '<h3>$1</h3>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/~~(.*?)~~/g, '<del>$1</del>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/- \[x\] (.*)/g, '<li class="task done"><input type="checkbox" checked disabled> $1</li>')
    .replace(/- \[ \] (.*)/g, '<li class="task"><input type="checkbox" disabled> $1</li>')
    .replace(/^> (.*$)/gm, '<blockquote>$1</blockquote>')
    .replace(/\n/g, '<br />');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 2rem; color: #333; }
    h1 { border-bottom: 1px solid #eaeaea; padding-bottom: 0.5rem; }
    blockquote { border-left: 4px solid #ddd; padding-left: 1rem; color: #666; margin: 1rem 0; }
    code { background: #f4f4f4; padding: 0.2rem 0.4rem; border-radius: 4px; font-family: monospace; }
    img { max-width: 100%; height: auto; border-radius: 8px; }
    .task { list-style: none; margin-left: -1.5rem; }
    .task.done { text-decoration: line-through; color: #888; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  ${htmlBody}
</body>
</html>`;
};

// 単一ノート: Markdownエクスポート
export const exportNoteAsMarkdown = (note: Note) => {
  const blob = new Blob([note.content], { type: 'text/markdown;charset=utf-8' });
  saveAs(blob, `${note.title || 'Untitled'}.md`);
};

// 単一ノート: HTMLエクスポート
export const exportNoteAsHtml = (note: Note) => {
  const htmlContent = convertMarkdownToHtml(note.title, note.content);
  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
  saveAs(blob, `${note.title || 'Untitled'}.html`);
};

// 全ノート: ZIPエクスポート
export const exportAllAsZip = async (notes: Note[], folders: Folder[]) => {
  const zip = new JSZip();

  // フォルダ構造に基づいてファイルを配置
  notes.forEach((note) => {
    if (note.deletedAt) return; // ゴミ箱のファイルは除外

    // getNotePathを利用してパスを取得（先頭の / を削除）
    const fullPath = getNotePath(note.title, note.folderId, folders).replace(/^\//, '');
    
    zip.file(fullPath, note.content);
  });

  // ZIP生成とダウンロード
  const content = await zip.generateAsync({ type: 'blob' });
  const dateStr = new Date().toISOString().split('T')[0];
  saveAs(content, `Rhizonote_Backup_${dateStr}.zip`);
};