'use client';

/**
 * 需求拆解报告渲染器。
 * 兼容工作流返回的两种形态：
 *  1. 结构化 JSON（含 sections / actionList 等字段）
 *  2. 自由文本 / Markdown（标题、列表、加粗、优先级标签、表格）
 * 统一输出精致的「工程蓝图」风格排版，并内联支持打印标记。
 */
import { useMemo } from 'react';
import { FileText, ListChecks, CircleDot, Printer } from 'lucide-react';

interface ActionRow {
  title?: string;
  desc?: string;
  priority?: string;
  effort?: string;
}

interface Section {
  title?: string;
  body?: string;
  actions?: ActionRow[];
}

type Model =
  | { kind: 'json'; title: string; summary: string; sections: Section[]; actions: ActionRow[] }
  | { kind: 'blocks'; blocks: Block[] };

type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'list'; items: { text: string; priority?: string }[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'para'; text: string }
  | { type: 'rule' };

/** 解析优先级标签，如 【P0】/P0/【紧急】/高优先级/低 */
function parsePriority(text: string): { priority?: string; rest: string } {
  const m = text.match(/^\s*(?:[-*]\s*)?(\[(P\d)\]|【(P?\d|高|中|低|紧急|重要)】|^(P\d)\s*[：:]\s*)/i);
  if (!m) return { rest: text };
  const p = (m[2] || m[3] || m[4]).toUpperCase();
  return { priority: p, rest: text.replace(m[0], '').trim() };
}

const PRIORITY_META: Record<string, { label: string; tone: string }> = {
  P0: { label: 'P0', tone: 'amber' },
  P1: { label: 'P1', tone: 'blue' },
  P2: { label: 'P2', tone: 'muted' },
  P3: { label: 'P3', tone: 'muted' },
  紧急: { label: '紧急', tone: 'amber' },
  高: { label: '高', tone: 'amber' },
  中: { label: '中', tone: 'blue' },
  低: { label: '低', tone: 'muted' },
  重要: { label: '重要', tone: 'amber' },
};

function PriorityBadge({ priority }: { priority?: string }) {
  if (!priority) return null;
  const meta = PRIORITY_META[priority] ?? { label: priority, tone: 'muted' };
  const tones: Record<string, string> = {
    amber: 'bg-amber-100 text-[#B97A25] ring-amber-200/70',
    blue: 'bg-blue-50 text-[#2E47A8] ring-blue-200/70',
    muted: 'bg-neutral-100 text-[#5B6472] ring-neutral-200/70',
  };
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-[2px] text-[11px] font-semibold leading-none ring-1 ${tones[meta.tone]}`}
    >
      {meta.label}
    </span>
  );
}

/** 把一段行内文本中的 **bold** 渲染为加粗 */
function InlineText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={i} className="font-semibold text-[#1C2433]">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export function ReportView({ content }: { content: string }) {
  const model = useMemo<Model>(() => buildModel(content), [content]);

  return (
    <div className="report-sheet relative w-full overflow-hidden rounded-2xl border border-[#E6E9EF] bg-[#FFFFFF] text-left shadow-[0_1px_2px_rgba(28,36,51,0.04),0_12px_32px_-18px_rgba(28,36,51,0.22)]">
      {/* 蓝图参考线 */}
      <div className="gridline absolute inset-0 pointer-events-none" />

      {model.kind === 'json' ? (
        <JsonReport model={model} />
      ) : (
        <BlocksReport model={model} />
      )}
    </div>
  );
}

function JsonReport({ model }: { model: Extract<Model, { kind: 'json' }> }) {
  return (
    <div className="relative">
      <ReportHeader title={model.title} summary={model.summary} />
      <div className="px-6 pb-6 sm:px-8 sm:pb-8">
        {model.sections.map((s, i) => (
          <section key={i} className="mt-6">
            <SectionHeading index={i + 1} title={s.title ?? '分区'} />
            {s.body ? (
              <p className="mt-2 whitespace-pre-wrap text-[14px] leading-7 text-[#3A4353]">
                <InlineText text={s.body} />
              </p>
            ) : null}
            {s.actions && s.actions.length > 0 ? (
              <ActionList actions={s.actions} />
            ) : null}
          </section>
        ))}
        {model.actions.length > 0 ? (
          <section className="mt-6">
            <SectionHeading index={model.sections.length + 1} title="行动清单" />
            <ActionList actions={model.actions} />
          </section>
        ) : null}
      </div>
    </div>
  );
}

function BlocksReport({ model }: { model: Extract<Model, { kind: 'blocks' }> }) {
  const { titleBlock, summaryText, sectionOrder } = useMemo(() => {
    const blocks = model.blocks;
    const titleBlock = blocks.find(
      (b): b is Extract<Block, { type: 'heading' }> => b.type === 'heading' && b.level === 1,
    );
    const summaryText = titleBlock
      ? blocks
          .slice(0, blocks.indexOf(titleBlock))
          .filter((b): b is Extract<Block, { type: 'para' }> => b.type === 'para')
          .map((b) => b.text)
          .join(' ')
      : '';
    const order = new Map<number, number>();
    let n = 0;
    blocks.forEach((b, i) => {
      if (b.type === 'heading' && b !== titleBlock) {
        n += 1;
        order.set(i, n);
      }
    });
    return { titleBlock, summaryText, sectionOrder: order };
  }, [model.blocks]);

  return (
    <div className="relative">
      {titleBlock ? (
        <ReportHeader title={titleBlock.text} summary={summaryText} />
      ) : null}
      <div className="px-6 pb-6 sm:px-8 sm:pb-8">
        {model.blocks.map((block, i) => {
          if (block.type === 'heading') {
            if (block === titleBlock) return null;
            if (block.level >= 2) {
              return (
                <SectionHeading
                  key={i}
                  index={sectionOrder.get(i) ?? 0}
                  title={block.text}
                  size={block.level === 2 ? 'md' : 'sm'}
                />
              );
            }
            return null;
          }
          if (block.type === 'list') {
            return (
              <ul key={i} className="mt-3 space-y-2.5">
                {block.items.map((item, j) => {
                  const { priority, rest } = parsePriority(item.text);
                  return (
                    <li key={j} className="flex items-start gap-2.5">
                      {priority ? (
                        <span className="mt-[3px]">
                          <PriorityBadge priority={priority} />
                        </span>
                      ) : (
                        <CircleDot className="mt-[5px] h-3.5 w-3.5 shrink-0 text-[#2E47A8]" />
                      )}
                      <span className="text-[14px] leading-7 text-[#3A4353]">
                        <InlineText text={rest} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            );
          }
          if (block.type === 'table') {
            return <SimpleTable key={i} headers={block.headers} rows={block.rows} />;
          }
          if (block.type === 'rule') {
            return <hr key={i} className="my-6 border-[#EEF0F4]" />;
          }
          return (
            <p key={i} className="mt-3 whitespace-pre-wrap text-[14px] leading-7 text-[#3A4353]">
              <InlineText text={block.text} />
            </p>
          );
        })}
      </div>
    </div>
  );
}

function ReportHeader({ title, summary }: { title: string; summary: string }) {
  return (
    <header className="relative border-b border-dashed border-[#DADEE6] px-6 pb-5 pt-6 sm:px-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#2E47A8] text-white">
            <FileText className="h-4 w-4" />
          </span>
          <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#2E47A8]">
            需求拆解报告
          </span>
        </div>
        <button
          className="no-print inline-flex items-center gap-1.5 rounded-lg border border-[#E2E6EC] bg-white px-2.5 py-1.5 text-[12px] font-medium text-[#3A4353] transition-colors hover:bg-[#F4F6F9]"
          onClick={() => window.print()}
        >
          <Printer className="h-3.5 w-3.5" />
          打印
        </button>
      </div>
      <h2 className="mt-4 text-[22px] font-semibold leading-tight tracking-tight text-[#1C2433]">
        {title || '需求拆解报告'}
      </h2>
      {summary ? (
        <p className="mt-2 text-[13px] leading-6 text-[#5B6472]">{summary}</p>
      ) : null}
    </header>
  );
}

function SectionHeading({
  index,
  title,
  size = 'md',
}: {
  index: number;
  title: string;
  size?: 'md' | 'sm';
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={`grid place-items-center rounded-md bg-[#2E47A8]/8 font-semibold tabular-nums text-[#2E47A8] ${
          size === 'md' ? 'h-6 w-6 text-[12px]' : 'h-5 w-5 text-[11px]'
        }`}
      >
        {String(index).padStart(2, '0')}
      </span>
      <h3
        className={`font-semibold tracking-tight text-[#1C2433] ${
          size === 'md' ? 'text-[16px]' : 'text-[14px]'
        }`}
      >
        {title}
      </h3>
      <span className="h-px flex-1 bg-[#EEF0F4]" />
    </div>
  );
}

function ActionList({ actions }: { actions: ActionRow[] }) {
  return (
    <ul className="mt-3 space-y-2.5">
      {actions.map((a, i) => (
        <li key={i} className="flex items-start gap-3 rounded-xl border border-[#EEF0F4] bg-[#FAFBFC] px-4 py-3">
          <ListChecks className="mt-[3px] h-4 w-4 shrink-0 text-[#2E47A8]" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {a.title ? (
                <span className="text-[14px] font-semibold text-[#1C2433]">{a.title}</span>
              ) : null}
              {a.priority ? <PriorityBadge priority={a.priority} /> : null}
            </div>
            {a.desc ? (
              <p className="mt-0.5 text-[13px] leading-6 text-[#5B6472]">{a.desc}</p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function SimpleTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-[#E6E9EF]">
      <table className="w-full border-collapse text-left text-[13px]">
        {headers.length > 0 ? (
          <thead>
            <tr className="bg-[#F6F8FB]">
              {headers.map((h, i) => (
                <th key={i} className="border-b border-[#E6E9EF] px-4 py-2.5 font-semibold text-[#1C2433]">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="odd:bg-white even:bg-[#FAFBFC]">
              {row.map((cell, j) => (
                <td key={j} className="border-b border-[#EEF0F4] px-4 py-2.5 align-top text-[#3A4353]">
                  <InlineText text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- 解析逻辑 ---------------- */

function buildModel(content: string): Model {
  if (!content) return { kind: 'blocks', blocks: [{ type: 'para', text: '（暂无内容）' }] };

  const trimmed = content.trim();

  // 尝试结构化 JSON
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const json = JSON.parse(trimmed);
      const built = buildJsonModel(json);
      if (built) return built;
    } catch {
      /* 不是 JSON，继续按文本解析 */
    }
  }

  return { kind: 'blocks', blocks: buildBlocks(content) };
}

function buildJsonModel(json: any): Model | null {
  const title = json.title ? String(json.title) : '';
  const summary = json.summary ? String(json.summary) : '';
  const actionMap = (list: any): ActionRow[] =>
    Array.isArray(list)
      ? list.map((a) => ({
          title: a.title !== undefined ? String(a.title) : a.name !== undefined ? String(a.name) : a.text !== undefined ? String(a.text) : '',
          desc: a.desc !== undefined ? String(a.desc) : a.description !== undefined ? String(a.description) : a.detail !== undefined ? String(a.detail) : '',
          priority: a.priority !== undefined ? String(a.priority) : a.level !== undefined ? String(a.level) : '',
          effort: a.effort !== undefined ? String(a.effort) : '',
        }))
      : [];

  const flatten = (node: any, acc: Section[] = []): Section[] => {
    if (!node || typeof node !== 'object') return acc;
    if (Array.isArray(node)) {
      node.forEach((n) => flatten(n, acc));
      return acc;
    }
    if (node.title !== undefined || node.name !== undefined) {
      const s: Section = {
        title: node.title !== undefined ? String(node.title) : String(node.name),
      };
      if (node.body !== undefined) s.body = String(node.body);
      else if (node.desc !== undefined) s.body = String(node.desc);
      else if (node.description !== undefined) s.body = String(node.description);
      if (node.content !== undefined && typeof node.content === 'string') s.body = node.content;
      if (node.actions !== undefined || node.items !== undefined || node.list !== undefined) {
        const li = node.actions ?? node.items ?? node.list;
        s.actions = actionMap(li);
      }
      acc.push(s);
      return acc;
    }
    Object.values(node).forEach((v) => flatten(v as any, acc));
    return acc;
  };

  const actions = actionMap(json.actionList ?? json.actions ?? json.action_list);
  const sections = flatten(json.sections ?? json.section_list ?? json);

  if (!title && !summary && actions.length === 0 && sections.length === 0) return null;

  return { kind: 'json', title, summary, sections, actions };
}

function buildBlocks(content: string): Block[] {
  const lines = content.split('\n');
  const blocks: Block[] = [];
  let i = 0;
  const trimEnd = (s: string) => s.replace(/\s+$/, '');

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      blocks.push({ type: 'rule' });
      i++;
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }

    const tableLine = line.match(/^\s*\|(.+)\|\s*$/);
    if (tableLine) {
      const rows: string[][] = [];
      let headers: string[] = [];
      let j = i;
      while (j < lines.length) {
        const tl = lines[j].match(/^\s*\|(.+)\|\s*$/);
        if (!tl) break;
        const cells = tl[1].split('|').map((c) => trimEnd(c.trim()));
        // 跳过分隔行 |---|---|
        if (cells.some((c) => /^:?-+:?$/.test(c)) && cells.length > 0) {
          j++;
          continue;
        }
        if (headers.length === 0) headers = cells;
        else rows.push(cells);
        j++;
      }
      if (rows.length || headers.length) {
        blocks.push({ type: 'table', headers, rows });
        i = j;
        continue;
      }
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: { text: string }[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push({ text: lines[i].replace(/^\s*[-*]\s+/, '') });
        i++;
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    if (/^\s*\d+[.、)]\s+/.test(line)) {
      const items: { text: string }[] = [];
      while (i < lines.length && /^\s*\d+[.、)]\s+/.test(lines[i])) {
        items.push({ text: lines[i].replace(/^\s*\d+[.、)]\s+/, '') });
        i++;
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    if (line.trim() === '') {
      i++;
      continue;
    }

    // 普通段落
    blocks.push({ type: 'para', text: trimEnd(line) });
    i++;
  }

  return blocks;
}