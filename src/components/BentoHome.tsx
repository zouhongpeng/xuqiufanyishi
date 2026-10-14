'use client';

import { useRef } from 'react';
import { GitBranch, ListChecks, ShieldAlert, Swords, MessageCircleQuestion, History } from 'lucide-react';
import { useCountUp } from '@/lib/useReveal';

function Num({ value, className = '' }: { value: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useCountUp(() => ref.current, value, [value]);
  return (
    <div ref={ref} className={className}>
      0
    </div>
  );
}

interface BentoHomeProps {
  rulesCount: number;
  casesCount: number;
  boundariesCount: number;
  onExample: (text: string) => void;
}

const EXAMPLES = [
  '我想做一个智能垃圾分类桶，帮社区自动识别垃圾种类',
  '校园二手书交易小程序，学生扫码即可发布和购买',
  '基于 AI 的背单词 App，根据遗忘曲线自动安排复习',
];

const FEATURES = [
  {
    icon: MessageCircleQuestion,
    tag: 'STEP 01',
    title: '先问后拆',
    desc: '先提 1-3 个关键澄清问题，补齐目标用户、使用场景与成功标准，再启动论证。',
    cls: 'bento-2x1',
  },
  {
    icon: Swords,
    tag: 'STEP 02',
    title: '正反交锋',
    desc: '评审团多视角对垒，被推翻的结论划线留痕，最终裁决高亮呈现。',
    cls: '',
  },
  {
    icon: GitBranch,
    tag: 'STEP 03',
    title: '需求地图',
    desc: '核心需求逐层拆到行动任务，节点可点开论证依据。',
    cls: '',
  },
  {
    icon: ListChecks,
    tag: 'STEP 04',
    title: '14 项评审清单',
    desc: '按大赛评审口径逐项体检：三自原则、创新性、科学性、查重比对。',
    cls: 'bento-2x1',
  },
  {
    icon: ShieldAlert,
    tag: 'GUARD',
    title: '红海预警',
    desc: '撞车往届案例即时提示，给出差异化转向建议。',
    cls: '',
  },
  {
    icon: History,
    tag: 'LOG',
    title: '历史对比',
    desc: '同一需求重新拆解，两次结论差异自动高亮。',
    cls: '',
  },
];

export default function BentoHome({ rulesCount, casesCount, boundariesCount, onExample }: BentoHomeProps) {
  return (
    <section aria-label="产品能力">
      <div className="bento-grid">
        {/* 主格：核心引擎 */}
        <div className="bento bento-2x2 reveal flex flex-col justify-between">
          <div>
            <div className="mono-tag">ENGINE</div>
            <h3 className="mt-2 text-2xl font-bold tracking-tight text-[#1d1d1f]">五阶段深度论证</h3>
            <p className="mt-3 max-w-[30rem] text-[15px] leading-relaxed text-[#6e6e73]">
              需求诊断 → 多视角论证 → 评委质询 → 报告整合 → 评审清单。每一步实时可见，
              思维链全程直播，报告按大赛评审口径落到可执行。
            </p>
          </div>
          <div className="mt-6 flex items-end gap-8">
            <div>
              <Num value={5} className="bento-num text-[#0071e3]" />
              <div className="mono-tag mt-1">STAGE</div>
            </div>
            <div>
              <Num value={6} className="bento-num text-[#1d1d1f]" />
              <div className="mono-tag mt-1">SECTIONS</div>
            </div>
            <div>
              <Num value={14} className="bento-num text-[#1d1d1f]" />
              <div className="mono-tag mt-1">CHECKS</div>
            </div>
          </div>
        </div>

        {FEATURES.map((f) => (
          <div key={f.title} className={`bento reveal ${f.cls}`}>
            <f.icon className="h-5 w-5 text-[#0071e3]" strokeWidth={1.8} />
            <div className="mono-tag mt-3">{f.tag}</div>
            <h4 className="mt-1 text-[16px] font-semibold text-[#1d1d1f]">{f.title}</h4>
            <p className="mt-2 text-[13px] leading-relaxed text-[#6e6e73]">{f.desc}</p>
          </div>
        ))}

        {/* 知识库背书 */}
        <div className="bento bento-2x1 reveal">
          <div className="mono-tag">KNOWLEDGE BASE</div>
          <div className="mt-3 flex items-end gap-8">
            <div>
              <Num value={rulesCount} className="bento-num text-[#1d1d1f]" />
              <div className="mono-tag mt-1">评审规则</div>
            </div>
            <div>
              <Num value={casesCount} className="bento-num text-[#1d1d1f]" />
              <div className="mono-tag mt-1">往届案例</div>
            </div>
            <div>
              <Num value={boundariesCount} className="bento-num text-[#1d1d1f]" />
              <div className="mono-tag mt-1">能力边界</div>
            </div>
          </div>
        </div>
      </div>

      {/* 示例一键填入 */}
      <div className="mt-5 reveal">
        <div className="mono-tag mb-2">TRY</div>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onExample(t)}
              className="press rounded-full border border-[#d2d2d7] bg-white px-4 py-2 text-[13px] text-[#1d1d1f] transition-colors duration-150 hover:border-[#0071e3] hover:text-[#0071e3]"
            >
              {t}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
