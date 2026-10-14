'use client';

import { useMemo } from 'react';

type Row = { type: 'same' | 'add' | 'del'; text: string };

/** 行级 LCS diff：新增绿底、删除红底删除线，其余正常 */
function diffLines(a: string, b: string): Row[] {
  const A = a.split('\n');
  const B = b.split('\n');
  const n = A.length;
  const m = B.length;
  // 防御超大文本
  if (n * m > 160000) {
    return [
      { type: 'del', text: a.slice(0, 400) },
      { type: 'add', text: b.slice(0, 400) },
    ];
  }
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows: Row[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      rows.push({ type: 'same', text: A[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: 'del', text: A[i] });
      i++;
    } else {
      rows.push({ type: 'add', text: B[j] });
      j++;
    }
  }
  while (i < n) rows.push({ type: 'del', text: A[i++] });
  while (j < m) rows.push({ type: 'add', text: B[j++] });
  return rows;
}

export default function DiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const rows = useMemo(() => diffLines(oldText, newText), [oldText, newText]);
  const addN = rows.filter((r) => r.type === 'add').length;
  const delN = rows.filter((r) => r.type === 'del').length;
  return (
    <div>
      <div className="mb-2 flex items-center gap-3 text-[12px]">
        <span className="rounded-full bg-[#e8f6ec] px-2 py-[2px] font-medium text-[#2EA043]">新增 {addN} 行</span>
        <span className="rounded-full bg-[#fdecec] px-2 py-[2px] font-medium text-[#e5484d]">调整 {delN} 行</span>
        <span className="text-[#86868b]">差异行已高亮</span>
      </div>
      <div className="max-h-[55vh] overflow-y-auto rounded-2xl border border-[#f0f0f2] bg-white p-4">
        {rows.map((r, i) =>
          r.type === 'same' ? (
            <p key={i} className="whitespace-pre-wrap text-[12.5px] leading-6 text-[#c7c7cc]">
              {r.text || ' '}
            </p>
          ) : r.type === 'add' ? (
            <p key={i} className="whitespace-pre-wrap rounded bg-[#e9f7ee] px-2 text-[12.5px] font-medium leading-6 text-[#1a7f37]">
              + {r.text || ' '}
            </p>
          ) : (
            <p key={i} className="whitespace-pre-wrap rounded bg-[#fdecec] px-2 text-[12.5px] leading-6 text-[#c93c37] line-through decoration-[#f3b6b3]">
              - {r.text || ' '}
            </p>
          ),
        )}
      </div>
    </div>
  );
}
