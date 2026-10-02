'use client';

import { useMemo, useState } from 'react';
import { Copy, Check, Printer, Zap, Fingerprint } from 'lucide-react';

export type ReportMode = 'quick' | 'deep';

/* ---------- 解析：优先级标签（【高】/【P0】/高优先级…） ---------- */
function parsePriority(text: string): { priority?: string; rest: string } {
  const m = text.match(
    /^\s*(?:[-*]\s*)?(\[(P\d)\]|【(P?\d|高|中|低|紧急|重要)】|^([Pp]\d)\s*[：:]\s*)/,
  );
  if (!m) return { rest: text };
  const p = (m[2] || m[3] || m[4]).toUpperCase();
  return { priority: p, rest: text.replace(m[0], '').trim() };
}

/* 低饱和优先级配色：高=#FF6B6B 中=#FFA94D 低=#ADB5BD */
function priorityColor(priority?: string): { bg: string; text: string; label: string } {
  if (!priority) return { bg: 'rgba(173,181,189,0.16)', text: '#636B74', label: '普通' };
  const hi = /^(P0|P1|高|紧急|重要)$/.test(priority);
  const mid = /^(P2|中)$/.test(priority);
  if (hi) return { bg: 'rgba(255,107,107,0.14)', text: '#E5484D', label: priority };
  if (mid) return { bg: 'rgba(255,169,77,0.18)', text: '#D97706', label: priority };
  return { bg: 'rgba(173,181,189,0.16)', text: '#636B74', label: priority };
}

/* 行内 **bold** */
function InlineText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={i} className="font-bold text-[#1d1d1f]">{part.slice(2, -2)}</strong>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

/* ---------- Markdown 解析（草案级）：标题 / 列表 / 段落 / 表格 ---------- */
interface Block {
  type: 'heading' | 'list' | 'para' | 'rule' | 'table';
  level?: number;
  text?: string;
  items?: string[];
  headers?: string[];
  rows?: string[][];
}

function parseMarkdown(src: string): Block[] {
  const lines = src.split('\n');
  const blocks: Block[] = [];
  let listening = false;
  let items: string[] | null = null;
  let inTable = false;
  let table: string[][] = [];

  const flushList = () => {
    if (items) {
      blocks.push({ type: 'list', items: [...items] });
      items = null;
    }
  };
  const flushTable = () => {
    if (inTable && table.length) {
      if (table.length > 1) {
        blocks.push({ type: 'table', headers: table[0], rows: table.slice(1) });
      }
      inTable = false;
      table = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushList();
      flushTable();
      continue;
    }
    // 表格行
    if (line.startsWith('|') && line.endsWith('|')) {
      flushList();
      const cells = line.slice(1, -1).split('|').map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) {
        continue; // 分隔行
      }
      if (!inTable) {
        table = [];
        inTable = true;
      }
      table.push(cells);
      continue;
    }
    flushTable();
    // 标题
    const h = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (h) {
      flushList();
      blocks.push({ type: 'heading', level: h[1].length, text: h[2].trim() });
      continue;
    }
    // 列表项
    const li = line.match(/^\s*[-*+]\s+(.*)$/) || line.match(/^\s*\d+[.、)]\s+(.*)$/);
    if (li) {
      const { priority, rest } = parsePriority(li[1]);
      const text = priority ? `【${priority}】${rest}` : rest;
      if (!items) items = [];
      items.push(text);
      continue;
    }
    flushList();
    blocks.push({ type: 'para', text: line.trim() });
  }
  flushList();
  flushTable();
  return blocks;
}

/* ---------- 顶层 ---------- */
export function ReportView({ content, mode }: { content: string; mode?: ReportMode }) {
  const blocks = useMemo(() => parseMarkdown(content), [content]);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* 剪贴板不可用则忽略 */
    }
  };

  return (
    <article className="report-sheet relative mx-auto w-full max-w-3xl rounded-[16px] bg-white text-left shadow-[0_4px_24px_rgba(0,0,0,0.06)]">
      <ReportHeader mode={mode} onCopy={copy} copied={copied} />
      <Body blocks={blocks} />
    </article>
  );
}

function ReportHeader({
  mode,
  onCopy,
  copied,
}: {
  mode?: ReportMode;
  onCopy: () => void;
  copied: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-b border-[#f0f0f2] px-6 py-4 sm:px-10">
      <div className="flex items-center gap-2 text-[13px] font-medium">
        {mode === 'deep' || !mode ? (
          <>
            <Fingerprint className="h-4 w-4 text-[#0071e3]" />
            <span className="text-[#1d1d1f]">深度拆解</span>
            <span className="text-[#86868b]">· 已完成专项分析节点</span>
          </>
        ) : (
          <>
            <Zap className="h-4 w-4 text-[#0071e3]" />
            <span className="text-[#1d1d1f]">快速拆解</span>
          </>
        )}
      </div>
      <div className="no-print flex items-center gap-2">
        <button
          onClick={onCopy}
          className="inline-flex items-center gap-1.5 rounded-full border border-[#e8e8ed] bg-white px-3.5 py-1.5 text-[13px] font-medium text-[#0071e3] transition-colors hover:bg-[#f5f5f7]"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? '已复制' : '一键复制'}
        </button>
        <button
          onClick={() => window.print()}
          className="no-print inline-flex items-center gap-1.5 rounded-full border border-[#e8e8ed] bg-white px-3.5 py-1.5 text-[13px] font-medium text-[#1d1d1f] transition-colors hover:bg-[#f5f5f7]"
        >
          <Printer className="h-3.5 w-3.5" />
          打印
        </button>
      </div>
    </div>
  );
}

function Body({ blocks }: { blocks: Block[] }) {
  // 报告大标题：# 需求拆解报告（居中）
  const title = blocks.find((b) => b.type === 'heading' && b.level === 1)?.text?.trim();
  const rest = blocks.filter(
    (b) => !(b.type === 'heading' && b.level === 1 && b.text === title),
  );

  // 组装分区：## 之后的块归入该分区
  const sections: { heading?: string; blocks: Block[] }[] = [];
  for (const b of rest) {
    if (b.type === 'heading' && b.level && b.level >= 2) {
      sections.push({ heading: b.text, blocks: [] });
    } else if (sections.length) {
      sections[sections.length - 1].blocks.push(b);
    }
  }

  return (
    <div className="px-6 py-8 sm:px-10 sm:py-12">
      {title ? (
        <header className="mb-10 text-center">
          <h1 className="text-[32px] font-bold leading-tight tracking-tight text-[#1d1d1f] sm:text-[38px]">
            {title}
          </h1>
          <div className="mx-auto mt-4 h-px w-12 bg-[#0071e3]" />
        </header>
      ) : null}

      {sections.map((sec, si) => {
        const isAction = sec.heading ? /行动|action/i.test(sec.heading) : false;
        const items = sec.blocks.map((b) => b.items ?? []).flat();
        const textBlocks = sec.blocks.filter((b) => b.type === 'para' || (b.type === 'list' && !isAction));
        return (
          <section key={si} className="mb-12">
            {sec.heading ? (
              <h2 className="text-[22px] font-semibold tracking-tight text-[#1d1d1f]">
                {sec.heading}
              </h2>
            ) : null}
            <div className="mt-4 space-y-4">
              {textBlocks.map((b, bi) =>
                b.type === 'list' ? (
                  <ul key={bi} className="space-y-2.5">
                    {b.items!.map((it, ii) => (
                      <li key={ii} className="flex items-start gap-2 text-[15px] leading-7 text-[#424245]">
                        <span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-[#0071e3]/50" />
                        <span>
                          <InlineText text={stripDing(it)} />
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p key={bi} className="text-[15px] leading-7 text-[#424245]">
                    <InlineText text={stripDing(b.text ?? '')} />
                  </p>
                ),
              )}

              {isAction && items.length > 0 ? (
                <div className="grid gap-3">
                  {items.map((it, ii) => {
                    const parts = it.split('】');
                    const labelPart = parts[0].replace(/^【/, '').replace(/^[【]/, '');
                    const { priority, rest } = extractPriorityFromText(it);
                    const c = priorityColor(priority);
                    return (
                      <div
                        key={ii}
                        className="flex items-start gap-3 rounded-[14px] border border-[#f0f0f2] bg-[#fbfbfd] p-4"
                      >
                        <span
                          className="mt-0.5 inline-flex shrink-0 items-center rounded-full px-2.5 py-[3px] text-[11px] font-semibold leading-none"
                          style={{ background: c.bg, color: c.text }}
                        >
                          {c.label}
                        </span>
                        <div className="min-w-0 text-[14px] leading-6 text-[#424245]">
                          <InlineText text={rest || labelPart} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function stripDing(text: string): string {
  // 去掉行首已解析的优先级标签 【高】…
  const m = text.match(/^\s*【(P?\d|高|中|低|紧急|重要)】\s*/);
  return m ? text.slice(m[0].length) : text;
}

function extractPriorityFromText(text: string): { priority?: string; rest: string } {
  const m = text.match(/^\s*【(P?\d|高|中|低|紧急|重要)】\s*/);
  return m
    ? { priority: m[1].toUpperCase(), rest: text.slice(m[0].length) }
    : { priority: undefined, rest: text };
}