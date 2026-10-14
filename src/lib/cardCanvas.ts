'use client';

interface CardData {
  title: string;
  summary: string;
  date: string;
  no: string;
}

/** 16:9 拆解卡：Canvas 绘制 1600x900 @2x，下载 png */
export function exportWideCard(d: CardData): void {
  const scale = 2;
  const W = 1600 * scale;
  const H = 900 * scale;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) return;
  ctx.scale(scale, scale);
  const W1 = 1600;
  const H1 = 900;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W1, H1);
  // 左上强调角标
  ctx.fillStyle = '#0071e3';
  ctx.fillRect(72, 72, 10, 44);

  ctx.fillStyle = '#86868b';
  ctx.font = '600 22px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText('NEED DECOMPOSER · 拆解卡', 100, 104);

  ctx.fillStyle = '#1d1d1f';
  ctx.font = '700 52px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  const titleLines = wrapText(ctx, d.title, W1 - 200, 1000);
  let y = 250;
  for (const ln of titleLines.slice(0, 2)) {
    ctx.fillText(ln, 100, y);
    y += 68;
  }

  // 分隔线
  ctx.strokeStyle = '#e8e8ed';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(100, y + 10);
  ctx.lineTo(W1 - 100, y + 10);
  ctx.stroke();

  // 核心结论（最多 3 行）
  ctx.fillStyle = '#6e6e73';
  ctx.font = '400 30px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  const sumLines = wrapText(ctx, d.summary, W1 - 200, 1300);
  let sy = y + 64;
  for (const ln of sumLines.slice(0, 3)) {
    ctx.fillText(ln, 100, sy);
    sy += 46;
  }

  // 底部：日期 + 编号
  ctx.fillStyle = '#86868b';
  ctx.font = '500 24px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(`${d.date}`, 100, H1 - 84);
  ctx.font = '500 22px ui-monospace, SFMono-Regular, Menlo, monospace';
  const noText = d.no;
  const noW = ctx.measureText(noText).width;
  ctx.fillText(noText, W1 - 100 - noW, H1 - 84);

  const a = document.createElement('a');
  a.href = c.toDataURL('image/png');
  a.download = `拆解卡-${d.title.slice(0, 12) || 'report'}.png`;
  a.click();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLen: number): string[] {
  const s = text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
  const lines: string[] = [];
  let cur = '';
  for (const ch of s) {
    if (ctx.measureText(cur + ch).width > maxW) {
      lines.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}
