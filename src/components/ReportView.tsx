'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Copy,
  Check,
  Zap,
  Fingerprint,
  Circle,
  CheckCircle2,
  TriangleAlert,
  CircleAlert,
  XCircle,
  ShieldCheck,
  ImageDown,
  FileText,
  FileDown,
  LayoutGrid,
  Swords,
  GitBranch,
  ListChecks,
  ShieldAlert,
} from 'lucide-react';
import { drawShareCard } from './shareCard';
import { exportWideCard } from '@/lib/cardCanvas';
import DebateView, { type DebateItem } from './DebateView';
import NeedTree from './NeedTree';
import PrintFrame from './PrintFrame';
import { showToast } from './Toast';
import type { StructuredReport, ClarifyQuestion } from '@/lib/deepChain';

export type ReportMode = 'quick' | 'deep';

export interface ReviewItem {
  item: string;
  status: 'pass' | 'warn' | 'fail';
  note: string;
}

export interface PlagiarismHint {
  caseName: string;
  domain: string;
  result: string;
  redSea: string;
  differentiation: string;
}

export interface EvidenceRef {
  ref: string;
  label: string;
  kind: 'rule' | 'case' | 'boundary';
  text: string;
}

/* ---------- 查重提示卡（风险预警区顶部） ---------- */
function PlagiarismCard({ p }: { p: PlagiarismHint }) {
  return (
    <div className="mb-3 rounded-xl border border-[#f3c1bd] bg-white p-4">
      <div className="flex items-start gap-2.5">
        <CircleAlert className="mt-0.5 h-4.5 w-4.5 shrink-0 text-[#e5484d]" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold leading-6 text-[#1d1d1f]">
            检测到与往届案例《{p.caseName}》方向相似
          </p>
          <p className="mt-1 text-[12.5px] leading-5 text-[#86868b]">
            {p.domain} · {p.result} · {p.redSea}
          </p>
          <p className="mt-1.5 text-[13px] font-medium leading-5 text-[#0071e3]">
            建议差异化：{p.differentiation}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---------- 依据角标（悬停/点击显示原文） ---------- */
function EvidenceBadges({ items }: { items: EvidenceRef[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!items.length) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-[#f3d7d5] pt-3">
      <span className="text-[11.5px] text-[#b08885]">依据：</span>
      {items.map((ev) => (
        <span key={ev.ref} className="relative">
          <button
            onClick={() => setOpen(open === ev.ref ? null : ev.ref)}
            title={ev.text}
            className="rounded-full bg-white px-2 py-[2px] font-mono text-[11px] text-[#8d3a3a] transition-colors hover:bg-[#fdeceb]"
          >
            {ev.label}
          </button>
          {open === ev.ref && (
            <span className="absolute bottom-full left-0 z-[500] mb-1.5 block w-72 rounded-lg border border-[#f0e5e4] bg-white p-3 text-[12px] leading-5 text-[#5b5b60] shadow-[0_8px_28px_rgba(0,0,0,0.14)]">
              <b className="mb-0.5 block text-[#1d1d1f]">
                {ev.label} · {ev.kind === 'rule' ? '评审规则' : ev.kind === 'case' ? '往届案例' : '能力边界'}
              </b>
              {ev.text}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

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

/* 行内 **bold** 与 ~~删除线~~（正反交锋中被推翻结论） */
function InlineText({ text }: { text: string }) {
  const parts = text.split(/(~~[^~]+~~|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} className="font-bold text-[#1d1d1f]">{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('~~') && part.endsWith('~~')) {
          return (
            <del key={i} className="text-[#86868b] line-through decoration-[#c7c7cc]">
              {part.slice(2, -2)}
            </del>
          );
        }
        return <span key={i}>{part}</span>;
      })}
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
    if (line.startsWith('|') && line.endsWith('|')) {
      flushList();
      const cells = line.slice(1, -1).split('|').map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) {
        continue;
      }
      if (!inTable) {
        table = [];
        inTable = true;
      }
      table.push(cells);
      continue;
    }
    flushTable();
    const h = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (h) {
      flushList();
      blocks.push({ type: 'heading', level: h[1].length, text: h[2].trim() });
      continue;
    }
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

/* ---------- 工具：行动卡解析 + 短 hash ---------- */
function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function parseActionCard(text: string): {
  priority?: string;
  duration: string;
  acceptance: string;
  dependency: string;
  core: string;
} {
  const { priority, rest } = extractPriorityFromText(text);
  const body = (rest || text).replace(/^\s*[-*+]\s+/, '');
  let duration = '';
  const dur = body.match(/(?:预计|大概|耗时|用时)[：:]?\s*([\d.]+)\s*(小时|天|分钟|周|月|h)/i);
  if (dur) duration = `${dur[1]}${dur[2]}`;
  const acc = body.match(/(?:验收|验收标准)[：:]\s*([^；;。|]+)/);
  const dep = body.match(/(?:依赖项?|前置|依赖)[：:]\s*([^；;。|]+)/);
  const acceptance = acc ? acc[1].trim() : '';
  const dependency = dep ? dep[1].trim() : '';
  const core = body
    .replace(/(?:预计|大概|耗时|用时)[：:]?\s*[\d.]+\s*(小时|天|分钟|周|月|h)/i, '')
    .replace(/(?:验收|验收标准)[：:]\s*[^；;。|]+/i, '')
    .replace(/(?:依赖项?|前置|依赖)[：:]\s*[^；;。|]+/i, '')
    .replace(/[；;。|，：:]\s*$/, '')
    .replace(/\s*[-*+]\s*$/, '')
    .trim();
  return { priority, duration, acceptance, dependency, core: core || body };
}

function stripDing(text: string): string {
  const m = text.match(/^\s*【(P?\d|高|中|低|紧急|重要)】\s*/);
  return m ? text.slice(m[0].length) : text;
}

function extractPriorityFromText(text: string): { priority?: string; rest: string } {
  const m = text.match(/^\s*【(P?\d|高|中|低|紧急|重要)】\s*/);
  return m
    ? { priority: m[1].toUpperCase(), rest: text.slice(m[0].length) }
    : { priority: undefined, rest: text };
}

/* ---------- 顶层 ---------- */
export function ReportView({
  content,
  mode,
  checklist = [],
  sourceTags = [],
  plagiarism = null,
  evidence = [],
  clarity,
  scene,
  structured = null,
  clarifications = [],
}: {
  content: string;
  mode?: ReportMode;
  checklist?: ReviewItem[];
  sourceTags?: string[];
  plagiarism?: PlagiarismHint | null;
  evidence?: EvidenceRef[];
  clarity?: number;
  scene?: string;
  structured?: StructuredReport | null;
  clarifications?: ClarifyQuestion[];
}) {
  const blocks = useMemo(() => parseMarkdown(content), [content]);
  const listKey = useMemo(() => `req-decomposer:check:${hash(content)}`, [content]);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      const raw = JSON.parse(window.localStorage.getItem(listKey) ?? '{}');
      if (raw && typeof raw === 'object') setChecks(raw);
    } catch {
      /* 本地读取失败则忽略 */
    }
  }, [listKey]);

  const toggle = (k: string) => {
    const next = { ...checks, [k]: !checks[k] };
    setChecks(next);
    try {
      window.localStorage.setItem(listKey, JSON.stringify(next));
    } catch {
      /* 本地写入失败则忽略 */
    }
  };

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
      <ReportHeader
        mode={mode}
        onCopy={copy}
        copied={copied}
        sourceTags={sourceTags}
        clarity={clarity}
        scene={scene}
        title={blocks.find((b) => b.type === 'heading' && b.level === 1)?.text?.trim()}
        checklist={checklist}
        content={content}
        structured={structured}
        docNoStr={docNo(content)}
      />
      {clarifications.length > 0 ? <ClarifyArchive items={clarifications} /> : null}
      {structured ? <StructuredBento s={structured} /> : null}
      <Body blocks={blocks} checks={checks} onToggle={toggle} plagiarism={plagiarism} evidence={evidence} />
      {!hasRiskSection(blocks) && plagiarism ? (
        <div className="px-6 pb-2 sm:px-10">
          <PlagiarismCard p={plagiarism} />
        </div>
      ) : null}
      {checklist.length > 0 ? <ReviewChecklist items={checklist} /> : null}
      <PrintFrame
        full
        title={blocks.find((b) => b.type === 'heading' && b.level === 1)?.text?.trim() || '项目拆解报告'}
        date={new Date().toLocaleDateString('zh-CN')}
        no={docNo(content)}
        structured={structured}
        reportText={content}
      />
      <PrintFrame
        full={false}
        title={blocks.find((b) => b.type === 'heading' && b.level === 1)?.text?.trim() || '项目拆解报告'}
        date={new Date().toLocaleDateString('zh-CN')}
        no={docNo(content)}
        structured={structured}
        reportText={content}
      />
    </article>
  );
}

/* 文档编号：内容 hash → ND-XXXXXX */
function docNo(content: string): string {
  return `ND-${hash(content).toUpperCase().padStart(7, '0').slice(0, 7)}`;
}

/* ---------- 澄清问答（需求档案前置区） ---------- */
function ClarifyArchive({ items }: { items: ClarifyQuestion[] }) {
  return (
    <section className="border-b border-[#f0f0f2] px-6 py-6 sm:px-10">
      <div className="mono-tag mb-2">CLARIFIED</div>
      <h3 className="mb-3 text-[16px] font-semibold text-[#1d1d1f]">先问后拆 · 澄清问答</h3>
      <div className="grid gap-2 sm:grid-cols-1">
        {items.map((c, i) => (
          <div key={i} className="rounded-2xl bg-[#f5f5f7] px-4 py-3">
            <p className="text-[13.5px] font-medium text-[#1d1d1f]">
              {String(i + 1).padStart(2, '0')}　{c.q}
            </p>
            {c.hint ? <p className="mt-1 text-[12.5px] leading-5 text-[#86868b]">追问提示：{c.hint}</p> : null}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-[#86868b]">以上澄清问答已并入需求档案，作为本轮论证的前提。</p>
    </section>
  );
}

/* ---------- 结构化 Bento 区（核心结论主格 + 正反交锋 + 需求地图） ---------- */
function StructuredBento({ s }: { s: StructuredReport }) {
  const debate: DebateItem[] = (s.debate ?? []).map((d) => ({
    topic: d.topic,
    pro: d.pro,
    con: d.con,
    resolved: d.resolved,
  }));
  return (
    <section className="border-b border-[#f0f0f2] px-4 py-6 sm:px-8">
      <div className="bento-grid">
        {/* 2x2 主格：核心结论 */}
        <div className="bento bento-2x2 reveal flex flex-col justify-between">
          <div>
            <div className="mono-tag">KEY VERDICT</div>
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold"
              style={{ background: 'rgba(0,113,227,0.1)', color: '#0071e3' }}>
              <LayoutGrid className="h-3.5 w-3.5" />
              核心结论
            </div>
            <p className="mt-3 text-[17px] font-semibold leading-relaxed text-[#1d1d1f]">
              {s.card?.conclusion || s.summary}
            </p>
          </div>
          <div className="mt-5 flex items-end gap-7">
            <div>
              <div className="bento-num text-[#1d1d1f]">{s.stages.length}</div>
              <div className="mono-tag mt-1">阶段论证</div>
            </div>
            <div>
              <div className="bento-num text-[#1d1d1f]">{s.actions.length}</div>
              <div className="mono-tag mt-1">行动项</div>
            </div>
            <div>
              <div className="bento-num text-[#e5484d]">{s.risks.length}</div>
              <div className="mono-tag mt-1">风险</div>
            </div>
          </div>
        </div>
        {/* 五阶段速览格 */}
        <div className="bento bento-2x1 reveal">
          <div className="mono-tag mb-2">FIVE STAGES</div>
          <div className="grid grid-cols-1 gap-1.5">
            {s.stages.map((st, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="mono-tag mt-0.5 shrink-0">{String(i + 1).padStart(2, '0')}</span>
                <span className="text-[13px] leading-5 text-[#1d1d1f]">
                  <b>{st.name}</b>
                  <span className="text-[#86868b]"> · {st.conclusion}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
        {/* 需求档案格 */}
        <div className="bento reveal">
          <div className="mono-tag mb-2">ARCHIVE</div>
          <h4 className="text-[15px] font-semibold text-[#1d1d1f]">需求档案</h4>
          <p className="mt-2 text-[13px] leading-6 text-[#6e6e73]">{s.summary}</p>
          <div className="mt-2 space-y-1">
            {Object.entries(s.archive ?? {}).slice(0, 6).map(([k, v]) => (
              <p key={k} className="text-[12.5px] leading-5 text-[#6e6e73]">
                <b className="text-[#1d1d1f]">{k}</b>：{v}
              </p>
            ))}
          </div>
        </div>
      </div>

      {/* 正反交锋 */}
      {debate.length > 0 ? (
        <div className="mt-6 reveal">
          <div className="mb-3 flex items-center gap-2">
            <Swords className="h-4.5 w-4.5 text-[#0071e3]" strokeWidth={1.8} />
            <h3 className="text-[18px] font-semibold text-[#1d1d1f]">正反交锋</h3>
            <span className="mono-tag">DEBATE</span>
          </div>
          <DebateView items={debate} />
        </div>
      ) : null}

      {/* 需求地图 */}
      {s.tree?.label ? (
        <div className="mt-6 reveal">
          <div className="mb-3 flex items-center gap-2">
            <GitBranch className="h-4.5 w-4.5 text-[#0071e3]" strokeWidth={1.8} />
            <h3 className="text-[18px] font-semibold text-[#1d1d1f]">需求地图</h3>
            <span className="text-[12px] text-[#86868b]">点击节点展开论证依据</span>
          </div>
          <NeedTree tree={s.tree} />
        </div>
      ) : null}

      {/* 行动清单与风险结构化卡 */}
      <div className="bento-grid mt-6">
        <div className="bento bento-2x1 reveal">
          <div className="mb-2 flex items-center gap-2">
            <ListChecks className="h-4.5 w-4.5 text-[#0071e3]" strokeWidth={1.8} />
            <h4 className="text-[15px] font-semibold text-[#1d1d1f]">行动清单</h4>
            <span className="mono-tag">ACTIONS</span>
          </div>
          <div className="space-y-2">
            {s.actions.map((a, i) => (
              <div key={i} className="rounded-2xl bg-[#f5f5f7] px-4 py-3">
                <p className="text-[13.5px] font-medium text-[#1d1d1f]">
                  {String(i + 1).padStart(2, '0')}　{a.task}
                </p>
                <p className="mt-1 text-[11.5px] text-[#86868b]">
                  {a.role ? `角色：${a.role}` : ''}
                  {a.time ? ` ｜ 时间：${a.time}` : ''}
                  {a.priority ? ` ｜ ${a.priority}` : ''}
                </p>
              </div>
            ))}
          </div>
        </div>
        <div className="bento reveal">
          <div className="mb-2 flex items-center gap-2">
            <ShieldAlert className="h-4.5 w-4.5 text-[#e5484d]" strokeWidth={1.8} />
            <h4 className="text-[15px] font-semibold text-[#1d1d1f]">风险与预案</h4>
          </div>
          <div className="space-y-2">
            {s.risks.map((r, i) => (
              <div key={i} className="rounded-2xl bg-[#fdf2f1] px-4 py-3">
                <p className="text-[13px] font-semibold text-[#b0352b]">{r.risk}</p>
                <p className="mt-0.5 text-[12.5px] leading-5 text-[#6e6e73]">应对：{r.response}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function ReportHeader({
  mode,
  onCopy,
  copied,
  sourceTags = [],
  clarity,
  scene,
  title,
  checklist = [],
  content,
  structured = null,
  docNoStr,
}: {
  mode?: ReportMode;
  onCopy: () => void;
  copied: boolean;
  sourceTags?: string[];
  clarity?: number;
  scene?: string;
  title?: string;
  checklist?: ReviewItem[];
  content: string;
  structured?: StructuredReport | null;
  docNoStr: string;
}) {
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const printDoc = (full: boolean) => {
    const cls = full ? 'print-mode-full' : 'print-mode-quick';
    const other = full ? 'print-mode-quick' : 'print-mode-full';
    document.body.classList.add(cls);
    document.body.classList.remove(other);
    const clean = () => {
      document.body.classList.remove(cls, other);
      window.removeEventListener('afterprint', clean);
    };
    window.addEventListener('afterprint', clean);
    window.print();
    setTimeout(clean, 2000);
  };
  const exportCard = () => {
    try {
      exportWideCard({
        title: structured?.card?.title || title || '项目拆解报告',
        summary: structured?.card?.conclusion || structured?.summary || title || '',
        date: new Date().toLocaleDateString('zh-CN'),
        no: docNoStr,
      });
      showToast('16:9 拆解卡已生成并开始下载');
    } catch {
      showToast('拆解卡生成失败，请重试');
    }
  };
  const exportShareCard = async () => {
    setExporting(true);
    try {
      await drawShareCard({ title: title || '项目拆解报告', mode, clarity, scene, checklist, content });
      setExported(true);
      showToast('分享图已生成并开始下载');
      setTimeout(() => setExported(false), 2000);
    } catch {
      /* 绘制失败静默恢复 */
    } finally {
      setExporting(false);
    }
  };
  return (
    <div className="border-b border-[#f0f0f2] px-6 py-4 sm:px-10">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-[13px] font-medium">
          {mode === 'deep' || !mode ? (
            <>
              <Fingerprint className="h-4 w-4 shrink-0 text-[#0071e3]" />
              <span className="text-[#1d1d1f]">深度论证</span>
              <span className="hidden text-[#86868b] sm:inline">· 逐节点评审</span>
            </>
          ) : (
            <>
              <Zap className="h-4 w-4 shrink-0 text-[#0071e3]" />
              <span className="text-[#1d1d1f]">快速预诊</span>
            </>
          )}
          {scene ? (
            <span className="rounded-full bg-[#f5f5f7] px-2 py-[2px] text-[11px] font-medium text-[#86868b]">
              {scene}
            </span>
          ) : null}
        </div>
        <div className="no-print flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={() => printDoc(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#0071e3] px-3.5 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#0077ed] active:bg-[#0068d1]"
          >
            <FileText className="h-3.5 w-3.5" />
            完整版 PDF
          </button>
          <button
            onClick={() => printDoc(false)}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#e8e8ed] bg-white px-3.5 py-1.5 text-[13px] font-medium text-[#0071e3] transition-colors hover:bg-[#f5f5f7] active:bg-[#ececf0]"
          >
            <FileDown className="h-3.5 w-3.5" />
            速览版 PDF
          </button>
          <button
            onClick={exportCard}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#e8e8ed] bg-white px-3.5 py-1.5 text-[13px] font-medium text-[#0071e3] transition-colors hover:bg-[#f5f5f7] active:bg-[#ececf0]"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            拆解卡 16:9
          </button>
          <button
            onClick={exportShareCard}
            disabled={exporting}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#e8e8ed] bg-white px-3.5 py-1.5 text-[13px] font-medium text-[#0071e3] transition-colors hover:bg-[#f5f5f7] active:bg-[#ececf0] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {exporting ? (
              <>
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#0071e3] border-t-transparent" />
                生成中…
              </>
            ) : exported ? (
              <>
                <Check className="h-3.5 w-3.5" />
                已导出
              </>
            ) : (
              <>
                <ImageDown className="h-3.5 w-3.5" />
                导出分享图
              </>
            )}
          </button>
          <button
            onClick={onCopy}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#e8e8ed] bg-white px-3.5 py-1.5 text-[13px] font-medium text-[#0071e3] transition-colors hover:bg-[#f5f5f7] active:bg-[#ececf0]"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? '已复制' : '一键复制'}
          </button>
        </div>
      </div>
      {sourceTags.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-[#86868b]" />
          {sourceTags.map((tag) => (
            <span
              key={tag}
              className="rounded-full px-2 py-[2px] text-[11px] font-medium"
              style={{ background: 'rgba(0,113,227,0.08)', color: '#0071e3' }}
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function hasRiskSection(blocks: Block[]): boolean {
  return blocks.some((b) => b.type === 'heading' && /风险|预警/.test((b.text ?? '').toLowerCase()));
}

function Body({
  blocks,
  checks,
  onToggle,
  plagiarism = null,
  evidence = [],
}: {
  blocks: Block[];
  checks: Record<string, boolean>;
  onToggle: (k: string) => void;
  plagiarism?: PlagiarismHint | null;
  evidence?: EvidenceRef[];
}) {
  const title = blocks.find((b) => b.type === 'heading' && b.level === 1)?.text?.trim();
  const rest = blocks.filter(
    (b) => !(b.type === 'heading' && b.level === 1 && b.text === title),
  );

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
        const heading = (sec.heading ?? '').toLowerCase();
        const isRisk = /风险|预警/.test(heading);
        const isAction = /行动|action|清单/.test(heading);
        const items = sec.blocks.map((b) => b.items ?? []).flat();
        const textBlocks = sec.blocks.filter(
          (b) => b.type === 'para' || (b.type === 'list' && !isAction && !isRisk),
        );

        /* —— 行动看板：任务卡 + 可勾选 + 本地持久化 —— */
        if (isAction) {
          return (
            <section key={si} className="mb-12">
              <h2 className="text-[22px] font-semibold tracking-tight text-[#1d1d1f]">
                行动看板
              </h2>
              <p className="mt-1 text-[13px] text-[#86868b]">勾选每完成一项 · 进度自动保存</p>
              <div className="mt-4 grid gap-3">
                {items.length ? (
                  items.map((it, ii) => {
                    const key = `a${si}-${ii}`;
                    const card = parseActionCard(it);
                    const done = !!checks[key];
                    const c = priorityColor(card.priority);
                    return (
                      <div
                        key={ii}
                        className={`flex items-start gap-3 rounded-[14px] border border-[#f0f0f2] p-4 transition-opacity ${
                          done ? 'bg-[#fbfbfd] opacity-70' : 'bg-[#fbfbfd]'
                        }`}
                      >
                        <button
                          onClick={() => onToggle(key)}
                          aria-pressed={done}
                          className="mt-0.5 shrink-0 transition-opacity hover:opacity-70"
                        >
                          {done ? (
                            <CheckCircle2 className="h-5 w-5 text-[#0071e3]" />
                          ) : (
                            <Circle className="h-5 w-5 text-[#c7c7cc]" />
                          )}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className="inline-flex shrink-0 items-center rounded-full px-2.5 py-[3px] text-[11px] font-semibold leading-none"
                              style={{ background: c.bg, color: c.text }}
                            >
                              {c.label}
                            </span>
                            {card.duration ? (
                              <span className="text-[11px] text-[#86868b]">⏱ {card.duration}</span>
                            ) : null}
                          </div>
                          <div
                            className={`mt-1.5 text-[15px] leading-6 ${
                              done
                                ? 'text-[#86868b] line-through decoration-[#c7c7cc]'
                                : 'text-[#1d1d1f]'
                            }`}
                          >
                            <InlineText text={card.core} />
                          </div>
                          {card.acceptance || card.dependency ? (
                            <div className="mt-2 space-y-1 text-[12.5px] leading-5 text-[#86868b]">
                              {card.acceptance ? <div>验收标准：{card.acceptance}</div> : null}
                              {card.dependency ? <div>依赖项：{card.dependency}</div> : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-[14px] text-[#86868b]">（暂无行动项）</p>
                )}
              </div>
            </section>
          );
        }

        /* —— 风险预警与降级方案：红色警示区 —— */
        if (isRisk) {
          return (
            <section key={si} className="mb-12">
              <h2 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight text-[#1d1d1f]">
                <TriangleAlert className="h-5 w-5 text-[#e5484d]" />
                风险预警与降级方案
              </h2>
              <div className="mt-4 space-y-3 rounded-r-[14px] border-l-4 border-[#e5484d] bg-[#fff5f5] p-5">
                {plagiarism ? <PlagiarismCard p={plagiarism} /> : null}
                {sec.blocks.map((b, bi) =>
                  b.type === 'list' ? (
                    <ul key={bi} className="space-y-2">
                      {b.items!.map((it, ii) => (
                        <li key={ii} className="text-[14px] leading-6 text-[#8d3a3a]">
                          <InlineText text={stripDing(it)} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p key={bi} className="text-[14px] leading-6 text-[#8d3a3a]">
                      <InlineText text={stripDing(b.text ?? '')} />
                    </p>
                  ),
                )}
                <EvidenceBadges items={evidence} />
              </div>
            </section>
          );
        }

        /* —— 普通分区 —— */
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
            </div>
          </section>
        );
      })}
    </div>
  );
}

/* ---------- 评审检查清单（14 项核查表） ---------- */
function statusIcon(status: ReviewItem['status']) {
  if (status === 'pass') return { icon: CheckCircle2, color: '#2EA043', label: '通过' };
  if (status === 'fail') return { icon: XCircle, color: '#E5484D', label: '不通过' };
  return { icon: CircleAlert, color: '#E8A33D', label: '警示' };
}

function ReviewChecklist({ items }: { items: ReviewItem[] }) {
  const pass = items.filter((i) => i.status === 'pass').length;
  const iconFor = (s: ReviewItem['status']) => statusIcon(s).icon;
  const colorFor = (s: ReviewItem['status']) => statusIcon(s).color;
  return (
    <section className="border-t border-[#f0f0f2] px-6 py-8 sm:px-10">
      <div className="flex items-center justify-between">
        <h2 className="text-[22px] font-semibold tracking-tight text-[#1d1d1f]">
          评审检查项 · <span className="text-[#0071e3]">{items.length}项专项检查</span>
        </h2>
        <div className="text-[12px] text-[#86868b]">
          通过 {pass} · 警示 {items.filter((i) => i.status === 'warn').length} · 不通过{' '}
          {items.filter((i) => i.status === 'fail').length}
        </div>
      </div>
      <div className="mt-4 overflow-hidden rounded-[14px] border border-[#f0f0f2]">
        {items.map((it, i) => {
          const Icon = iconFor(it.status);
          const color = colorFor(it.status);
          return (
            <div
              key={`${it.item}-${i}`}
              className={`flex items-start gap-3 px-5 py-3.5 ${i % 2 ? 'bg-[#fbfbfd]' : 'bg-white'}`}
            >
              <Icon className="mt-0.5 h-[18px] w-[18px] shrink-0" style={{ color }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-semibold text-[#1d1d1f]">{it.item}</span>
                  <span className="rounded-full px-2 py-[2px] text-[11px] font-medium" style={{ background: `${color}1f`, color }}>
                    {statusIcon(it.status).label}
                  </span>
                </div>
                {it.note ? <div className="mt-1 text-[13px] leading-6 text-[#86868b]">{it.note}</div> : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}