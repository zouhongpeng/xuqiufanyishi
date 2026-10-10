'use client';

import { useEffect } from 'react';
import { X, TriangleAlert } from 'lucide-react';

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '确认',
  danger = true,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/30 p-4 backdrop-blur-[2px]"
      onClick={onCancel}
    >
      <div
        className="fade-in w-full max-w-sm rounded-[20px] bg-white p-6 shadow-[0_24px_64px_rgba(0,0,0,0.18)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            {danger ? <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-[#e5484d]" /> : null}
            <h3 className="text-[16px] font-semibold text-[#1d1d1f]">{title}</h3>
          </div>
          <button
            onClick={onCancel}
            aria-label="关闭确认框"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#86868b] transition-colors hover:bg-[#f5f5f7]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-2.5 text-[13.5px] leading-6 text-[#86868b]">{message}</p>
        <div className="mt-5 flex justify-end gap-2.5">
          <button
            onClick={onCancel}
            className="rounded-full border border-[#e8e8ed] bg-white px-4 py-2 text-[13px] font-medium text-[#1d1d1f] transition-colors hover:bg-[#f5f5f7] active:bg-[#ececf0]"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className={`rounded-full px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-85 active:opacity-70 ${
              danger ? 'bg-[#e5484d]' : 'bg-[#0071e3]'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
