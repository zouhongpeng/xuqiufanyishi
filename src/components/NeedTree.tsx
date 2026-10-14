'use client';

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { NeedTreeNode } from '@/lib/deepChain';

function Node({ node, depth }: { node: NeedTreeNode; depth: number }) {
  const [open, setOpen] = useState(false);
  const hasBasis = Boolean(node.basis);
  const kids = node.children ?? [];
  return (
    <div className={depth === 0 ? '' : 'border-l border-[#e8e8ed] pl-4'}>
      <button
        type="button"
        onClick={() => hasBasis && setOpen((v) => !v)}
        className={`press flex w-full items-start gap-2 rounded-xl px-2 py-2 text-left ${
          hasBasis ? 'cursor-pointer hover:bg-[#f5f5f7]' : 'cursor-default'
        }`}
      >
        {hasBasis ? (
          <ChevronRight
            className={`mt-1 h-3.5 w-3.5 shrink-0 text-[#86868b] transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
          />
        ) : (
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#c7c7cc]" />
        )}
        <span>
          <span
            className={`text-[14px] ${
              depth === 0 ? 'text-base font-semibold text-[#1d1d1f]' : 'font-medium text-[#1d1d1f]'
            }`}
          >
            {node.label}
          </span>
          {open && hasBasis && (
            <span className="mt-1 block rounded-lg bg-[#f0f6ff] px-3 py-2 text-[12px] leading-relaxed text-[#4a5568]">
              论证依据：{node.basis}
            </span>
          )}
        </span>
      </button>
      {kids.length > 0 && (
        <div className="ml-2 space-y-0.5">
          {kids.map((c, i) => (
            <Node key={i} node={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

/** 需求地图：核心需求 → 子需求 → 行动任务，节点点击展开论证依据 */
export default function NeedTree({ tree }: { tree: NeedTreeNode }) {
  if (!tree?.label) return null;
  return (
    <div className="bento">
      <div className="mono-tag mb-2">NEED MAP</div>
      <h4 className="mb-3 text-[15px] font-semibold text-[#1d1d1f]">需求地图</h4>
      <Node node={tree} depth={0} />
    </div>
  );
}
