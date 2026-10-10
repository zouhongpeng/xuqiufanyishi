'use client';

import type { PlagiarismHint, EvidenceRef, ReviewItem, ReportMode } from '@/components/ReportView';

export interface HistoryEntry {
  id: string;
  time: number;
  mode: ReportMode;
  scene: string;
  summary: string;
  clarity?: number;
  category?: string;
  content: string;
  checklist?: ReviewItem[];
  source_tags?: string[];
  plagiarism?: PlagiarismHint | null;
  evidence?: EvidenceRef[];
}

const KEY = 'req-decomposer:history';
const MAX = 20;

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveHistory(list: HistoryEntry[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* 存储满或不可用则忽略 */
  }
}

export function addHistory(entry: Omit<HistoryEntry, 'id' | 'time'>): HistoryEntry[] {
  const list = loadHistory();
  const full: HistoryEntry = { ...entry, id: `h${Date.now()}${Math.random().toString(36).slice(2, 6)}`, time: Date.now() };
  const next = [full, ...list].slice(0, MAX);
  saveHistory(next);
  return next;
}

export function removeHistory(id: string): HistoryEntry[] {
  const next = loadHistory().filter((h) => h.id !== id);
  saveHistory(next);
  return next;
}

export function clearHistory(): HistoryEntry[] {
  saveHistory([]);
  return [];
}
