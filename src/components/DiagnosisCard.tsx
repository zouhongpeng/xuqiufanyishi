'use client';

export interface DiagnosticOption {
  label: string;
  hint: string;
}

export function DiagnosisCard({
  clarity,
  category,
  clarity_desc,
  missing_info = [],
  options = [],
  nextQuestion,
  onPick,
}: {
  clarity: number;
  category: string;
  clarity_desc?: string;
  missing_info?: string[];
  options?: DiagnosticOption[];
  nextQuestion?: string;
  onPick: (label: string) => void;
}) {
  const point = Math.max(0, Math.min(3, clarity));
  return (
    <div className="w-full max-w-[420px] rounded-2xl rounded-bl-sm border border-[#f0f0f2] bg-white p-5 shadow-[0_4px_24px_rgba(0,0,0,0.06)]">
      {/* 头部：标题 + 场景 */}
      <div className="flex items-center justify-between">
        <div className="text-[13px] font-semibold text-[#1d1d1f]">需求诊断</div>
        {category && category !== '其他' ? (
          <span
            className="rounded-full px-2.5 py-[3px] text-[11px] font-semibold"
            style={{ background: 'rgba(0,113,227,0.1)', color: '#0071e3' }}
          >
            {category}
          </span>
        ) : null}
      </div>

      {/* 清晰度环形进度：每轮 +1 多填一段，3 分填满 */}
      <div className="mt-3.5 flex items-center gap-2">
        <svg width="34" height="34" viewBox="0 0 34 34" className="shrink-0" aria-label={`清晰度 ${point} / 3`}>
          <circle cx="17" cy="17" r="13" fill="none" stroke="#e8e8ed" strokeWidth="4" />
          <circle
            cx="17"
            cy="17"
            r="13"
            fill="none"
            stroke="#0071e3"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={`${((point / 3) * 2 * Math.PI * 13).toFixed(2)} ${(2 * Math.PI * 13).toFixed(2)}`}
            transform="rotate(-90 17 17)"
            style={{ transition: 'stroke-dasharray 600ms cubic-bezier(0.25, 0.1, 0.25, 1)' }}
          />
          <text x="17" y="21" textAnchor="middle" fontSize="9.5" fontWeight="600" fill="#1d1d1f">
            {point}/3
          </text>
        </svg>
        <span className="text-[12px] text-[#86868b]">清晰度 {point} / 3</span>
      </div>

      {nextQuestion ? (
        <p className="mt-3.5 text-[14px] font-medium leading-[1.7] text-[#1d1d1f]">{nextQuestion}</p>
      ) : null}

      {clarity_desc ? (
        <p className="mt-3.5 text-[13px] leading-[1.7] text-[#424245]">{clarity_desc}</p>
      ) : null}

      {/* 本轮聚焦：一次只围绕一个最关键缺失点提问，其余留到后续轮次 */}
      {missing_info.length > 0 ? (
        <div className="mt-4">
          <div className="text-[12px] font-medium text-[#86868b]">本轮先聚焦</div>
          <p className="mt-2 flex items-start gap-2 text-[13px] leading-6 text-[#424245]">
            <span className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-[#0071e3]/60" />
            {missing_info[0]}
          </p>
        </div>
      ) : null}

      {/* 可点选项 */}
      {options.length > 0 ? (
        <div className="mt-4">
          <div className="text-[12px] font-medium text-[#86868b]">选一个继续</div>
          <div className="mt-2 grid gap-2">
            {options.map((opt, i) => (
              <button
                key={i}
                onClick={() => onPick(opt.label)}
                className="group w-full rounded-full border border-[#e8e8ed] bg-white px-4 py-2 text-left text-[13.5px] transition-colors hover:border-[#0071e3] hover:text-[#0071e3]"
              >
                {opt.label}
                {opt.hint ? (
                  <span className="ml-2 text-[12px] text-[#86868b] transition-colors group-hover:text-[#86868b]">
                    {opt.hint}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-3 text-[11px] text-[#c7c7cc]">也可以直接在下方输入你的回答</div>
    </div>
  );
}