'use client';

import type { ReportMode, ReviewItem } from './ReportView';

interface ShareCardData {
  title: string;
  mode?: ReportMode;
  clarity?: number;
  scene?: string;
  checklist?: ReviewItem[];
  content: string;
}

const W = 900;
const H = 1200;

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxWidth) {
      lines.push(line);
      line = ch;
      if (lines.length >= maxLines) return lines;
    } else {
      line += ch;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

function extractTopRisks(checklist: ReviewItem[]): { item: string; note: string }[] {
  const severity = (s: string) => (s === 'fail' ? 0 : s === 'warn' ? 1 : 2);
  return (checklist ?? [])
    .filter((c) => c.status !== 'pass')
    .sort((a, b) => severity(a.status) - severity(b.status))
    .slice(0, 3)
    .map((c) => ({ item: c.item, note: c.note }));
}

function drawCentered(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number) {
  ctx.fillText(text, cx - ctx.measureText(text).width / 2, y);
}

export async function drawShareCard(data: ShareCardData): Promise<void> {
  const canvas = document.createElement('canvas');
  const scale = 2;
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.scale(scale, scale);

  const FONT = 'PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif';

  // 背景
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  // 顶部品牌条
  ctx.fillStyle = '#0071E3';
  ctx.fillRect(0, 0, W, 8);

  ctx.font = `600 24px ${FONT}`;
  ctx.fillStyle = '#86868B';
  drawCentered(ctx, '需求拆解师 · AI 评审助手', W / 2, 76);

  // 模式标识 + 场景
  const modeLabel = data.mode === 'deep' ? '🔬 深度论证' : '⚡ 快速预诊';
  const sceneLabel = data.scene ? ` · ${data.scene}` : '';
  ctx.font = `500 26px ${FONT}`;
  ctx.fillStyle = '#0071E3';
  drawCentered(ctx, `${modeLabel}${sceneLabel}`, W / 2, 130);

  // 项目名（标题，最多两行）
  ctx.font = `bold 44px ${FONT}`;
  ctx.fillStyle = '#1D1D1F';
  const titleLines = wrapText(ctx, data.title, W - 160, 2);
  let y = 200;
  for (const ln of titleLines) {
    drawCentered(ctx, ln, W / 2, y);
    y += 58;
  }

  // 分隔短线
  ctx.fillStyle = '#0071E3';
  ctx.fillRect(W / 2 - 24, y + 8, 48, 4);
  y += 60;

  // 清晰度评分
  const clarity = typeof data.clarity === 'number' ? data.clarity : null;
  if (clarity !== null) {
    const levelText = ['模糊', '较模糊', '较清晰', '清晰'][clarity] ?? String(clarity);
    ctx.font = `600 24px ${FONT}`;
    ctx.fillStyle = '#86868B';
    drawCentered(ctx, '需求清晰度', W / 2, y);
    ctx.font = `bold 64px ${FONT}`;
    ctx.fillStyle = '#0071E3';
    drawCentered(ctx, `${clarity} / 3`, W / 2, y + 72);
    ctx.font = `500 24px ${FONT}`;
    ctx.fillStyle = '#1D1D1F';
    drawCentered(ctx, levelText, W / 2, y + 112);
    y += 150;
  }

  // 14 项检查清单统计
  const cl = data.checklist ?? [];
  if (cl.length) {
    const pass = cl.filter((c) => c.status === 'pass').length;
    const warn = cl.filter((c) => c.status === 'warn').length;
    const fail = cl.filter((c) => c.status === 'fail').length;
    const stat = (label: string, value: number, color: string, x: number) => {
      ctx.font = `bold 44px ${FONT}`;
      ctx.fillStyle = color;
      drawCentered(ctx, String(value), x, y + 34);
      ctx.font = `500 22px ${FONT}`;
      ctx.fillStyle = '#86868B';
      drawCentered(ctx, label, x, y + 70);
    };
    const cx = W / 2;
    const gap = 200;
    stat('项通过', pass, '#1E7E34', cx - gap);
    stat('项警示', warn, '#D97706', cx);
    stat('项风险', fail, '#E5484D', cx + gap);
    y += 120;
  }

  // 核心风险 Top3
  const risks = extractTopRisks(data.checklist ?? []);
  if (risks.length) {
    ctx.font = `600 28px ${FONT}`;
    ctx.fillStyle = '#1D1D1F';
    drawCentered(ctx, '核心风险提示', W / 2, y);
    y += 28;
    ctx.textAlign = 'left';
    let ry = y + 28;
    risks.forEach((r, i) => {
      ctx.font = `600 22px ${FONT}`;
      ctx.fillStyle = r.note ? '#E5484D' : '#D97706';
      const head = `${i + 1}. ${r.item}`;
      ctx.fillText(head, 100, ry);
      ry += 34;
      ctx.font = `400 21px ${FONT}`;
      ctx.fillStyle = '#86868B';
      const noteLines = wrapText(ctx, r.note || '', W - 240, 2);
      for (const nl of noteLines) {
        ctx.fillText(nl, 124, ry);
        ry += 30;
      }
      ry += 12;
    });
    ctx.textAlign = 'left';
    y = ry + 10;
  }

  // 底部品牌条
  ctx.fillStyle = '#F5F5F7';
  ctx.fillRect(0, H - 90, W, 90);
  ctx.font = `500 22px ${FONT}`;
  ctx.fillStyle = '#86868B';
  drawCentered(ctx, '像评委一样，审视你的每一个项目想法', W / 2, H - 52);
  ctx.font = `400 18px ${FONT}`;
  ctx.fillStyle = '#C7C7CC';
  drawCentered(ctx, '需求拆解师 · AI 评审助手', W / 2, H - 22);

  // 下载
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('toBlob failed');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `需求拆解师-分享卡-${Date.now()}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
