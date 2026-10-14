'use client';

export interface DebateItem {
  topic: string;
  pro: string;
  con: string;
  resolved: string;
}

/** 正反交锋：左右对照 + 被推翻结论删除线 + 最终裁决高亮 */
export default function DebateView({ items }: { items: DebateItem[] }) {
  if (!items?.length) return null;
  return (
    <div className="space-y-4">
      {items.map((d, i) => (
        <div key={i} className="bento !p-5">
          <div className="mono-tag mb-2">DEBATE {String(i + 1).padStart(2, '0')}</div>
          <h4 className="mb-3 text-[15px] font-semibold text-[#1d1d1f]">{d.topic}</h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-[#f2f9f2] p-4">
              <div className="mb-1 text-xs font-semibold text-[#3d7a3f]">正方</div>
              <p className="text-[13px] leading-relaxed text-[#1d1d1f]">{d.pro}</p>
            </div>
            <div className="rounded-2xl bg-[#fdf2f1] p-4">
              <div className="mb-1 text-xs font-semibold text-[#b0352b]">反方</div>
              <p className="text-[13px] leading-relaxed text-[#1d1d1f]">{d.con}</p>
            </div>
          </div>
          <div className="mt-3 rounded-2xl bg-[#f0f6ff] p-4">
            <div className="mb-1 text-xs font-semibold text-[#0071e3]">评审裁决</div>
            <p className="text-[13px] font-medium leading-relaxed text-[#1d1d1f]">{d.resolved}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
