import { NextResponse } from 'next/server';
import {
  buildContextInput,
  decomposeReport,
  isNewTopic,
  judge,
  type Judgement,
} from '@/lib/decomposer';
import { deepRun } from '@/lib/workflow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 内存会话表：sessionId -> 该会话的用户输入轮次（不含 AI 回复） */
const sessions = new Map<string, string[]>();

const DEFAULT_SCENE = '智能识别';

export async function POST(req: Request) {
  let body: { sessionId?: string; message?: string; mode?: string; scene?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }
  const { sessionId, message, mode: rawMode = 'quick', scene } = body ?? {};
  if (
    !sessionId ||
    typeof sessionId !== 'string' ||
    typeof message !== 'string' ||
    !message.trim()
  ) {
    return NextResponse.json({ error: '缺少 sessionId 或 message' }, { status: 400 });
  }

  const mode = rawMode === 'deep' ? 'deep' : 'quick';
  const msg = message.trim();
  let turns = sessions.get(sessionId) ?? [];
  if (isNewTopic(msg)) turns = [];
  turns.push(msg);
  sessions.set(sessionId, turns);

  let context = buildContextInput(turns);
  // 用户手选场景（非“智能识别”）时，作为弱提示辅助场景归类，不放宽清晰度门槛
  if (scene && scene !== DEFAULT_SCENE) {
    context += `\n（用户期望聚焦场景：${scene}）`;
  }

  // ============ 深度模式：扣子工作流（一次调用完成判断+拆解） ============
  if (mode === 'deep') {
    try {
      const r = await deepRun(context);
      const type = r.clarity <= 1 ? 'question' : 'solution';
      return NextResponse.json({
        type,
        mode,
        clarity: r.clarity,
        category: r.category,
        clarity_desc: '',
        content: r.content,
        round: turns.length,
      });
    } catch (e) {
      return NextResponse.json(
        { error: '深度模式暂不可用', detail: (e as Error)?.message ?? String(e) },
        { status: 502 },
      );
    }
  }

  // ============ 快速模式：LLM 两次调用 ============
  let judgement: Judgement;
  try {
    judgement = await judge(context, req.headers);
  } catch (e) {
    return NextResponse.json(
      { error: '判断服务暂不可用', detail: (e as Error)?.message ?? String(e) },
      { status: 502 },
    );
  }

  if (judgement.clarity <= 1) {
    return NextResponse.json({
      type: 'question',
      mode,
      clarity: judgement.clarity,
      category: judgement.category,
      clarity_desc: judgement.clarity_desc,
      content: judgement.next_question,
      round: turns.length,
    });
  }

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
    mode,
    clarity: judgement.clarity,
    category: judgement.category,
    clarity_desc: judgement.clarity_desc,
    content: report,
    round: turns.length,
  });
}