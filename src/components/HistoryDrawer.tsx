'use client';

import { useEffect, useState } from 'react';
import { X, Trash2, ChevronRight, History, ShieldCheck, GitCompare } from 'lucide-react';
import { ReportView } from '@/components/ReportView';
import DiffView from '@/components/DiffView';
import ConfirmDialog from '@/components/ConfirmDialog';
import { showToast } from '@/components/Toast';
import {
  loadHistory,
  removeHistory,
  clearHistory,
  type HistoryEntry,
} from '@/lib/history';

function fmtTime(t: number): string {
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function HistoryDrawer({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<HistoryEntry[]>([]);
  const [detail, setDetail] = useState<HistoryEntry | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<HistoryEntry | null>(null);
  const [diffPair, setDiffPair] = useState<{ cur: HistoryEntry; prev: HistoryEntry } | null>(null);

  useEffect(() => {
    setList(loadHistory());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-[#1d1d1f]/20 p-5 backdrop-blur-[7px] sm:p-12"
      onClick={onClose}
    >
      <div
        className="lg-card modal-pop flex h-[82vh] max-h-[760px] w-full max-w-[560px] flex-col !rounded-3xl"
        style={{ background: 'rgba(251, 251, 253, 0.86)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#f0f0f2] px-5 py-4">
          <div className="flex items-center gap-2">
            <History className="h-4.5 w-4.5 text-[#0071e3]" />
            <h2 className="text-[16px] font-semibold text-[#1d1d1f]">历史记录</h2>
            {list.length ? (
              <span className="rounded-full bg-[#f5f5f7] px-2 py-[2px] text-[11px] text-[#86868b]">
                {list.length}/20
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {list.length ? (
              <button
                onClick={() => setConfirmClear(true)}
                className="rounded-full border border-[#f0d9d8] px-3 py-1.5 text-[12px] font-medium text-[#e5484d] transition-colors hover:bg-[#fdf1f0] active:bg-[#fbe5e3]"
              >
                清空
              </button>
            ) : null}
            <button
              onClick={onClose}
              aria-label="关闭历史记录"
              className="flex h-9 w-9 items-center justify-center rounded-full text-[#86868b] transition-colors hover:bg-[#f5f5f7] hover:text-[#1d1d1f]"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {diffPair ? (
          <div className="flex-1 overflow-y-auto p-4">
            <button
              onClick={() => setDiffPair(null)}
              className="mb-3 inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-[13px] font-medium text-[#0071e3] shadow-[0_1px_4px_rgba(0,0,0,0.06)] transition-colors hover:bg-[#f5f9ff]"
            >
              ← 返回列表
            </button>
            <div className="mb-3 rounded-[14px] border border-[#f0f0f2] bg-white px-4 py-3">
              <p className="text-[13.5px] font-semibold text-[#1d1d1f]">{diffPair.cur.summary.slice(0, 60)}</p>
              <p className="mt-1 text-[12px] text-[#86868b]">
                新：{fmtTime(diffPair.cur.time)}（{diffPair.cur.mode === 'deep' ? '深度论证' : '快速预诊'}）
                　vs　旧：{fmtTime(diffPair.prev.time)}（{diffPair.prev.mode === 'deep' ? '深度论证' : '快速预诊'}）
              </p>
            </div>
            <DiffView oldText={diffPair.prev.content} newText={diffPair.cur.content} />
          </div>
        ) : detail ? (
          <div className="flex-1 overflow-y-auto p-4">
            <button
              onClick={() => setDetail(null)}
              className="mb-3 inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-[13px] font-medium text-[#0071e3] shadow-[0_1px_4px_rgba(0,0,0,0.06)] transition-colors hover:bg-[#f5f9ff]"
            >
              ← 返回列表
            </button>
            <ReportView
              content={detail.content}
              mode={detail.mode}
              checklist={detail.checklist}
              sourceTags={detail.source_tags}
              plagiarism={detail.plagiarism}
              evidence={detail.evidence}
              clarity={detail.clarity}
              scene={detail.scene}
            />
          </div>
        ) : list.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
            <History className="h-10 w-10 text-[#e0e0e4]" />
            <p className="text-[14px] text-[#86868b]">还没有诊断记录，去输入你的第一个想法吧</p>
            <p className="inline-flex items-center gap-1.5 text-[12px] text-[#c7c7cc]">
              <ShieldCheck className="h-3.5 w-3.5" />
              记录仅保存在你自己的浏览器中
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4">
            <p className="mb-3 text-[12px] text-[#c7c7cc]">记录仅保存在你自己的浏览器中</p>
            <div className="grid gap-2">
              {list.map((h) => (
                <div
                  key={h.id}
                  className="group flex items-center gap-3 rounded-[14px] border border-[#f0f0f2] bg-white px-4 py-3 transition-colors hover:border-[#d8e8fb]"
                >
                  <button onClick={() => setDetail(h)} className="min-w-0 flex-1 text-left">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-[rgba(0,113,227,0.08)] px-2 py-[2px] text-[11px] font-medium text-[#0071e3]">
                        {h.mode === 'deep' ? '深度论证' : '快速预诊'}
                      </span>
                      {h.scene ? (
                        <span className="rounded-full bg-[#f5f5f7] px-2 py-[2px] text-[11px] text-[#86868b]">
                          {h.scene}
                        </span>
                      ) : null}
                      <span className="text-[11px] text-[#c7c7cc]">{fmtTime(h.time)}</span>
                    </div>
                    <p className="mt-1 truncate text-[13.5px] text-[#1d1d1f]">{h.summary}</p>
                  </button>
                  {list.indexOf(h) < list.length - 1 ? (
                    <button
                      onClick={() => setDiffPair({ cur: h, prev: list[list.indexOf(h) + 1] })}
                      aria-label="与上一条对比差异"
                      title="与上一条对比差异"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#c7c7cc] transition-colors hover:bg-[#f0f6ff] hover:text-[#0071e3]"
                    >
                      <GitCompare className="h-4 w-4" />
                    </button>
                  ) : null}
                  <button
                    onClick={() => setConfirmDelete(h)}
                    aria-label="删除该条记录"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#c7c7cc] transition-colors hover:bg-[#fdf1f0] hover:text-[#e5484d]"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[#e0e0e4]" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmClear}
        title="清空历史记录"
        message={`将删除全部 ${list.length} 条诊断记录，此操作不可恢复。`}
        confirmLabel="清空"
        onConfirm={() => {
          setList(clearHistory());
          setConfirmClear(false);
          showToast('历史记录已清空');
        }}
        onCancel={() => setConfirmClear(false)}
      />
      <ConfirmDialog
        open={!!confirmDelete}
        title="删除该条记录"
        message={confirmDelete ? `将删除「${confirmDelete.summary.slice(0, 24)}…」这条诊断记录。` : ''}
        confirmLabel="删除"
        onConfirm={() => {
          if (confirmDelete) setList(removeHistory(confirmDelete.id));
          setConfirmDelete(null);
          showToast('记录已删除');
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
