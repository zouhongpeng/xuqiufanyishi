import { NextResponse } from 'next/server';
import {
  buildContextInput,
  decomposeReport,
  isNewTopic,
  judge,
  type Judgement,
} from '@/lib/decomposer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 内存会话表：sessionId -> 该会话的用户输入轮次（不含 AI 回复） */
const sessions = new Map<string, string[]>();

export async function POST(req: Request) {
  let body: { sessionId?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }
  const { sessionId, message } = body ?? {};
  if (
    !sessionId ||
    typeof sessionId !== 'string' ||
    typeof message !== 'string' ||
    !message.trim()
  ) {
    return NextResponse.json({ error: '缺少 sessionId 或 message' }, { status: 400 });
  }

  const msg = message.trim();
  let turns = sessions.get(sessionId) ?? [];
  if (isNewTopic(msg)) turns = [];
  turns.push(msg);
  sessions.set(sessionId, turns);
  const context = buildContextInput(turns);

  // 调用1：需求清晰度判断
  let judgement: Judgement;
  try {
    judgement = await judge(context, req.headers);
  } catch (e) {
    return NextResponse.json(
      { error: '判断服务暂不可用', detail: (e as Error)?.message ?? String(e) },
      { status: 502 },
    );
  }

  // clarity ≤ 1：返回追问
  if (judgement.clarity <= 1) {
    return NextResponse.json({
      type: 'question',
      clarity: judgement.clarity,
      category: judgement.category,
      clarity_desc: judgement.clarity_desc,
      content: judgement.next_question,
      round: turns.length,
    });
  }

  // clarity ≥ 2：调用2 生成完整拆解报告
  let report: string;
  try {
    ({ report } = await decomposeReport(context, req.headers));
  } catch (e) {
    return NextResponse.json(
      { error: '拆解服务暂不可用', detail: (e as Error)?.message ?? String(e) },
      { status: 502 },
    );
  }

  return NextResponse.json({
    type: 'solution',
    clarity: judgement.clarity,
    category: judgement.category,
    clarity_desc: judgement.clarity_desc,
    content: report,
    round: turns.length,
  });
}