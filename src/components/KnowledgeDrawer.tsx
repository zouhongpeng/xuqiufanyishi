'use client';

import { useEffect, useState } from 'react';
import { X, BookOpen, ShieldCheck, Fingerprint } from 'lucide-react';
import kbRulesData from '@/data/knowledge/rules.json';
import kbCasesData from '@/data/knowledge/cases.json';
import kbBoundariesData from '@/data/knowledge/boundaries.json';

interface KbRule {
  id: string;
  dimension: string;
  content: string;
  weight: string;
  deduction: string;
}
interface KbCase {
  id: string;
  name: string;
  domain: string;
  result: string;
  seaStatus: string;
  redSea: string;
  differentiation: string;
}
interface KbBoundary {
  id: string;
  item: string;
  safe: boolean;
  risk: string;
  fallback: string;
}

const TABS = [
  { key: 'rules', label: '评审规则', icon: BookOpen },
  { key: 'cases', label: '往届案例', icon: ShieldCheck },
  { key: 'boundaries', label: '能力边界', icon: Fingerprint },
] as const;

export default function KnowledgeDrawer({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('rules');

  useEffect(() => {
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

  const rules = kbRulesData as KbRule[];
  const cases = kbCasesData as KbCase[];
  const boundaries = kbBoundariesData as KbBoundary[];

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/30 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="fade-in flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-[20px] bg-white shadow-[0_24px_64px_rgba(0,0,0,0.18)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#f0f0f2] px-5 py-4">
          <div>
            <h2 className="text-[16px] font-semibold text-[#1d1d1f]">评审知识库说明</h2>
            <p className="mt-0.5 text-[12px] text-[#86868b]">
              拆解与评审判断所依据的结构化数据 · {rules.length}条规则 · {cases.length}个案例 ·{' '}
              {boundaries.length}项边界
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭知识库说明"
            className="flex h-9 w-9 items-center justify-center rounded-full text-[#86868b] transition-colors hover:bg-[#f5f5f7] hover:text-[#1d1d1f]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex gap-1 px-5 pt-3">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                tab === t.key
                  ? 'bg-[#0071e3] text-white'
                  : 'bg-[#f5f5f7] text-[#1d1d1f] hover:bg-[#ececf0]'
              }`}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-5 pt-3">
          {tab === 'rules' && (
            <div className="grid gap-2.5">
              {rules.map((r) => (
                <div
                  key={r.id}
                  className="rounded-xl border border-[#f0f0f2] bg-[#fbfbfd] px-4 py-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-[#f5f5f7] px-1.5 py-0.5 font-mono text-[11px] text-[#86868b]">
                      {r.id}
                    </span>
                    <span className="text-[13.5px] font-semibold text-[#1d1d1f]">{r.dimension}</span>
                    <span
                      className={`rounded-full px-2 py-[2px] text-[11px] font-medium ${
                        r.weight === '高' || r.weight === '权重最高' || r.weight === '权重次高'
                          ? 'bg-[rgba(0,113,227,0.1)] text-[#0071e3]'
                          : 'bg-[#f5f5f7] text-[#86868b]'
                      }`}
                    >
                      权重：{r.weight}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[13px] leading-5 text-[#1d1d1f]">{r.content}</p>
                  <p className="mt-1 text-[12.5px] text-[#b45309]">常见扣分点：{r.deduction}</p>
                </div>
              ))}
            </div>
          )}

          {tab === 'cases' && (
            <div className="grid gap-2.5">
              <p className="text-[12px] text-[#c7c7cc]">示例数据，持续补充</p>
              {cases.map((c) => (
                <div
                  key={c.id}
                  className="rounded-xl border border-[#f0f0f2] bg-[#fbfbfd] px-4 py-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13.5px] font-semibold text-[#1d1d1f]">{c.name}</span>
                    <span className="rounded-full bg-[#f5f5f7] px-2 py-[2px] text-[11px] text-[#86868b]">
                      {c.domain}
                    </span>
                    <span className="rounded-full bg-[#f5f5f7] px-2 py-[2px] text-[11px] text-[#86868b]">
                      {c.result}
                    </span>
                    <span
                      className={`rounded-full px-2 py-[2px] text-[11px] font-medium ${
                        c.seaStatus === '红海'
                          ? 'bg-[rgba(232,163,61,0.14)] text-[#b45309]'
                          : 'bg-[rgba(52,199,89,0.12)] text-[#1e7e34]'
                      }`}
                    >
                      {c.seaStatus}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[12.5px] leading-5 text-[#86868b]">
                    雷区分析：{c.redSea}
                  </p>
                  <p className="mt-0.5 text-[12.5px] leading-5 text-[#0071e3]">
                    差异化建议：{c.differentiation}
                  </p>
                </div>
              ))}
            </div>
          )}

          {tab === 'boundaries' && (
            <div className="grid gap-2.5">
              {boundaries.map((b) => (
                <div
                  key={b.id}
                  className="rounded-xl border border-[#f0f0f2] bg-[#fbfbfd] px-4 py-3"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-[2px] text-[11px] font-medium ${
                        b.safe
                          ? 'bg-[rgba(52,199,89,0.12)] text-[#1e7e34]'
                          : 'bg-[rgba(255,59,48,0.1)] text-[#d0342c]'
                      }`}
                    >
                      {b.safe ? '安全区' : '高风险'}
                    </span>
                    <span className="text-[13.5px] font-semibold text-[#1d1d1f]">{b.item}</span>
                  </div>
                  <p className="mt-1.5 text-[12.5px] leading-5 text-[#86868b]">{b.risk}</p>
                  {b.fallback !== '-' && (
                    <p className="mt-0.5 text-[12.5px] leading-5 text-[#0071e3]">
                      降级建议：{b.fallback}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
