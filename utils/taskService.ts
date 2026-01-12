// utils/taskService.ts

import { db } from '../db';
import { Note, TaskItem } from '../types';

/**
 * ノートのコンテンツからタスクを抽出し、DBのtasksテーブルを更新する
 */
export const updateTasksForNote = async (note: Note) => {
  // ゴミ箱にあるノートのタスクは削除する
  if (note.deletedAt) {
    await db.tasks.where('noteId').equals(note.id).delete();
    return;
  }

  const lines = note.content.split('\n');
  const tasks: TaskItem[] = [];

  lines.forEach((line, index) => {
    // タスク行のマッチング (インデント、マーカー、内容)
    const match = line.match(/^(\s*)(-\s\[([ x])\]\s)(.*)/);
    if (match) {
      tasks.push({
        noteId: note.id,
        lineIndex: index,
        isChecked: match[3] === 'x', // 'x' なら true
        content: match[4].trim(), // タスク本文
        rawContent: line // HTML表示用に元の行を保持
      });
    }
  });

  // トランザクションで「既存の削除」と「新規追加」を一括実行
  await db.transaction('rw', db.tasks, async () => {
    // このノートに関連する古いタスクインデックスを削除
    await db.tasks.where('noteId').equals(note.id).delete();
    
    // 新しいタスクを一括登録
    if (tasks.length > 0) {
      await db.tasks.bulkPut(tasks);
    }
  });
};

/**
 * 全ノートを再スキャンしてタスクDBを構築する（マイグレーション用）
 */
export const reindexAllTasks = async (notes: Note[]) => {
  await db.transaction('rw', db.tasks, async () => {
    await db.tasks.clear();
    for (const note of notes) {
      if (!note.deletedAt) {
         // ここでループ内でupdateTasksForNoteのロジックを展開して呼ぶか、
         // 簡単のために個別に処理する（件数が多い場合は最適化が必要）
         const lines = note.content.split('\n');
         const tasks: TaskItem[] = [];
         lines.forEach((line, index) => {
            const match = line.match(/^(\s*)(-\s\[([ x])\]\s)(.*)/);
            if (match) {
                tasks.push({
                    noteId: note.id,
                    lineIndex: index,
                    isChecked: match[3] === 'x',
                    content: match[4].trim(),
                    rawContent: line
                });
            }
         });
         if (tasks.length > 0) await db.tasks.bulkPut(tasks);
      }
    }
  });
};

/**
 * ノート削除時の処理
 */
export const removeTasksForNote = async (noteId: string) => {
    await db.tasks.where('noteId').equals(noteId).delete();
};