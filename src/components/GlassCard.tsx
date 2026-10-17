'use client';

import { useRef, type CSSProperties, type ReactNode } from 'react';

/**
 * 液态玻璃卡片：
 * - 鼠标跟随：光斑 + 轻微 3D 倾斜，全部经 rAF lerp 阻尼插值（跟手但带惯性）
 * - 缩放跟随：悬停放大到 1.02，离开后阻尼回落；靠近卡片中心越近放大越明显
 * - 果冻按压：按下 0.965，松手以弹簧曲线回弹（--spring）
 */
export default function GlassCard({
  children,
  className = '',
  tilt = 4,          // 最大倾斜角度（deg）
  scale = 1.02,      // 悬停最大放大
  style,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  tilt?: number;
  scale?: number;
  style?: CSSProperties;
  onClick?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const target = useRef({ rx: 0, ry: 0, s: 1, mx: 50, my: 50 });
  const current = useRef({ rx: 0, ry: 0, s: 1, mx: 50, my: 50 });
  const raf = useRef<number | null>(null);
  const hovering = useRef(false);

  const tick = () => {
    const t = target.current;
    const c = current.current;
    const k = 0.14; // 阻尼系数：越小越「跟手带惯性」
    c.rx += (t.rx - c.rx) * k;
    c.ry += (t.ry - c.ry) * k;
    c.s += (t.s - c.s) * k;
    c.mx += (t.mx - c.mx) * k;
    c.my += (t.my - c.my) * k;
    const el = ref.current;
    if (el) {
      el.style.transform = `perspective(900px) rotateX(${c.rx.toFixed(3)}deg) rotateY(${c.ry.toFixed(3)}deg) scale(${c.s.toFixed(4)})`;
      el.style.setProperty('--mx', `${c.mx.toFixed(2)}%`);
      el.style.setProperty('--my', `${c.my.toFixed(2)}%`);
    }
    // 全部就位则停止动画循环
    const done =
      Math.abs(t.rx - c.rx) < 0.01 &&
      Math.abs(t.ry - c.ry) < 0.01 &&
      Math.abs(t.s - c.s) < 0.0005 &&
      Math.abs(t.mx - c.mx) < 0.1 &&
      Math.abs(t.my - c.my) < 0.1;
    if (done) {
      raf.current = null;
    } else {
      raf.current = requestAnimationFrame(tick);
    }
  };

  const kick = () => {
    if (raf.current == null) raf.current = requestAnimationFrame(tick);
  };

  const onMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;   // 0~1
    const py = (e.clientY - rect.top) / rect.height;
    const t = target.current;
    t.ry = (px - 0.5) * 2 * tilt;      // 左右倾
    t.rx = -(py - 0.5) * 2 * tilt;     // 上下倾
    // 越靠近中心，放大越明显（鼠标跟随的「呼吸感」）
    const dist = Math.hypot(px - 0.5, py - 0.5) / 0.707; // 0 中心 ~1 边角
    t.s = hovering.current ? 1 + (scale - 1) * (1 - dist * 0.5) : 1;
    t.mx = px * 100;
    t.my = py * 100;
    kick();
  };

  const onEnter = () => {
    hovering.current = true;
    target.current.s = scale;
    kick();
  };

  const onLeave = () => {
    hovering.current = false;
    target.current = { rx: 0, ry: 0, s: 1, mx: target.current.mx, my: target.current.my };
    kick();
  };

  // 按压：交给 CSS .jelly（松手后 transform 恢复由 tick 接管）
  const onDown = () => {
    const el = ref.current;
    if (el) el.style.transform = `perspective(900px) scale(0.965)`;
  };
  const onUp = () => {
    const el = ref.current;
    if (el) {
      // 弹簧回弹：短暂越过目标值再落回（CSS --spring 的 overshoot）
      el.style.transition = 'transform 380ms var(--spring)';
      el.style.transform = `perspective(900px) rotateX(${current.current.rx.toFixed(2)}deg) rotateY(${current.current.ry.toFixed(2)}deg) scale(${current.current.s.toFixed(3)})`;
      setTimeout(() => {
        if (el) el.style.transition = '';
      }, 400);
    }
  };

  return (
    <div
      ref={ref}
      className={`lg-card jelly ${className}`}
      style={style}
      onClick={onClick}
      onMouseMove={onMove}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onMouseDown={onDown}
      onMouseUp={onUp}
    >
      <div className="lg-spot" />
      {children}
    </div>
  );
}
