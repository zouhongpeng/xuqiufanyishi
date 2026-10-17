'use client';

import { useEffect, useRef } from 'react';
import { BookOpen, GitBranch, ListChecks, MessageCircleQuestion, ShieldAlert, Swords, History } from 'lucide-react';

export type OrbitFeature = {
  id: string;
  icon: typeof Swords;
  tag: string;
  title: string;
  desc: string;
  points: string[];
  accent: string;
};

export const ORBIT_FEATURES: OrbitFeature[] = [
  {
    id: 'ask',
    icon: MessageCircleQuestion,
    tag: 'STEP 01',
    title: '先问后拆',
    desc: '先提 1-3 个关键澄清问题，补齐信息再启动论证。',
    points: ['自动追问目标用户、使用场景', '补齐成功标准与约束条件', '问题模糊时拒绝空转输出'],
    accent: '#0071e3',
  },
  {
    id: 'debate',
    icon: Swords,
    tag: 'STEP 02',
    title: '正反交锋',
    desc: '评审团多视角对垒，被推翻的结论划线留痕。',
    points: ['支持者/质疑者/评委多角色对垒', '被推翻结论保留划线痕迹', '最终裁决高亮呈现'],
    accent: '#7c3aed',
  },
  {
    id: 'guard',
    icon: ShieldAlert,
    tag: 'GUARD',
    title: '红海预警',
    desc: '撞车往届案例即时提示，给出差异化转向建议。',
    points: ['对比往届获奖案例库', '相似度高即触发预警', '提供差异化转向思路'],
    accent: '#d97706',
  },
  {
    id: 'map',
    icon: GitBranch,
    tag: 'STEP 03',
    title: '需求地图',
    desc: '核心需求逐层拆到行动任务，节点可点开论证依据。',
    points: ['需求 → 子需求 → 任务三层拆解', '每个节点附论证依据', '可直接导出为行动清单'],
    accent: '#0d9488',
  },
  {
    id: 'checklist',
    icon: ListChecks,
    tag: 'STEP 04',
    title: '14 项评审清单',
    desc: '按大赛评审口径逐项体检，逐条给出整改动作。',
    points: ['三自原则 / 创新性 / 科学性', '查重比对往届项目', '每项附具体整改建议'],
    accent: '#e4572e',
  },
  {
    id: 'history',
    icon: History,
    tag: 'LOG',
    title: '历史对比',
    desc: '同一需求重新拆解，两次结论差异自动高亮。',
    points: ['版本间差异自动对比', '改进轨迹一目了然', '可回看任意历史报告'],
    accent: '#6b7c96',
  },
];

const KB_FEATURE: OrbitFeature = {
  id: 'kb',
  icon: BookOpen,
  tag: 'KB',
  title: '知识库',
  desc: '评审规则 · 往届案例 · 能力边界，三大库全程支撑。',
  points: [],
  accent: '#0071e3',
};

/**
 * 星环轨道：功能卡挂在环绕中央球体的椭圆轨道上。
 * - 拖拽水平方向旋转星环（rAF + lerp 阻尼，跟手带惯性）
 * - 松手后惯性滑行、摩擦衰减，最后吸附到最近的卡位（流水线感）
 * - 点后排的卡 → 星环自动把它转到最前；点最前的卡 → 打开详情
 * - 只操作 transform/opacity，无布局读写，保证 60fps
 */
export default function OrbitRing({ onItem }: {
  onItem: (f: OrbitFeature) => void;
}) {
  const items = [...ORBIT_FEATURES, KB_FEATURE];
  const N = items.length;
  const step = (Math.PI * 2) / N;

  const wrapRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const angle = useRef(0);
  const target = useRef(0);
  const vel = useRef(0);
  const dragging = useRef(false);
  const lastX = useRef(0);
  const moved = useRef(0);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      // 惯性 + 摩擦 + 吸附（只在未拖拽时）
      if (!dragging.current) {
        target.current += vel.current;
        vel.current *= 0.93;
        if (Math.abs(vel.current) < 0.0006) vel.current = 0;
        if (vel.current === 0) {
          const nearest = Math.round(target.current / step) * step;
          target.current += (nearest - target.current) * 0.07; // 阻尼吸附
        }
      }
      angle.current += (target.current - angle.current) * 0.13; // 阻尼跟随

      const w = wrapRef.current?.clientWidth ?? 900;
      const RX = Math.min(432, w / 2 - 96);
      const RY = RX * 0.30;

      for (let i = 0; i < N; i++) {
        const el = itemRefs.current[i];
        if (!el) continue;
        const a = i * step + angle.current;
        const x = Math.sin(a) * RX;
        const y = Math.cos(a) * RY;
        const z = Math.cos(a); // 1=最前 -1=最后
        const depth = (z + 1) / 2; // 0=最后 1=最前
        const scale = 0.55 + 0.45 * depth;
        el.style.transform = `translate3d(calc(-50% + ${x.toFixed(1)}px), calc(-50% + ${y.toFixed(1)}px), 0) scale(${scale.toFixed(4)})`;
        el.style.zIndex = String(50 + Math.round(z * 50));
        el.style.opacity = (0.4 + 0.6 * depth).toFixed(3);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [N, step]);

  const lastPt = useRef({ x: 0, y: 0 });

  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = true;
    lastX.current = e.clientX;
    lastPt.current = { x: e.clientX, y: e.clientY };
    moved.current = 0;
    vel.current = 0;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastX.current;
    lastX.current = e.clientX;
    moved.current += Math.abs(dx);
    const d = dx * 0.0042;
    target.current += d;
    vel.current = vel.current * 0.55 + d * 0.45;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    target.current += vel.current * 16; // 惯性甩出
    vel.current *= 0.6;
    // 原地松手 = 点击：pointer capture 会劫持子元素 click，用卡片矩形做命中测试
    if (moved.current <= 8) {
      let best = -1;
      let bestZ = -Infinity;
      itemRefs.current.forEach((el, i) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
          const zi = Number(el.style.zIndex || 0);
          if (zi > bestZ) {
            bestZ = zi;
            best = i;
          }
        }
      });
      if (best >= 0) onItemClick(best);
    }
  };

  const onItemClick = (i: number) => {
    if (moved.current > 8) return; // 拖拽结束不触发点击
    const a = i * step + angle.current;
    const norm = Math.atan2(Math.sin(a), Math.cos(a)); // -π~π
    if (Math.abs(norm) < 0.45) {
      onItem(items[i]); // 已在最前 → 打开
    } else {
      target.current -= norm;
      vel.current = 0;
    }
  };

  return (
    <div
      ref={wrapRef}
      className="absolute inset-0 cursor-grab touch-pan-y select-none active:cursor-grabbing"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* 轨道装饰线 */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-white/40"
        style={{ width: 'min(864px, calc(100% - 190px))', height: 'min(260px, 30vw)' }}
      />
      {items.map((f, i) => (
        <div
          key={f.id}
          data-idx={i}
          ref={(el) => {
            itemRefs.current[i] = el;
          }}
          className="lg-orbit-item"
        >
          <div
            className="lg-card jelly w-44 cursor-pointer !p-3.5"
            style={{ boxShadow: `0 2px 6px rgba(31,41,55,.05), 0 16px 40px rgba(31,41,55,.08), inset 0 1px 0 rgba(255,255,255,.85)` }}
          >
            <div className="flex items-center gap-2">
              <div
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                style={{ backgroundColor: `${f.accent}16`, boxShadow: `inset 0 0 0 1px ${f.accent}26` }}
              >
                <f.icon className="h-4 w-4" style={{ color: f.accent }} strokeWidth={1.9} />
              </div>
              <div className="min-w-0">
                <div className="mono-tag text-[9.5px]">{f.tag}</div>
                <h4 className="truncate text-[13.5px] font-semibold text-[#1d1d1f]">{f.title}</h4>
              </div>
            </div>
            <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-[#6e6e73]">{f.desc}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
