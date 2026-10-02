import { NextResponse } from 'next/server';
import {
  appendTurn,
  buildContext,
  extractResult,
  getTurns,
  isNewTopicCommand,
  resetSession,
  runCozeWorkflow,
} from '@/lib/coze';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ChatRequest {
  sessionId?: string;
  message?: string;
}

/**
 * POST /api/chat
 * body: { sessionId: string, message: string }
 *
 * 后端维护每个 session 的多轮上下文（第1轮/第2轮/…），拼接后调用扣子工作流。
 * 返回：
 *  - { type: 'question', clarity, content, round }  清晰度不够，等待用户继续回答
 *  - { type: 'solution', clarity, content, round }  清晰度足够，输出完整拆解报告
 *  - { error: 'COZE_NOT_CONFIGURED' }               尚未配置工作流（前端显示设置引导）
 */
export async function POST(req: Request) {
  let body: ChatRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';

  if (!sessionId) {
    return NextResponse.json({ error: '缺少 sessionId' }, { status: 400 });
  }
  if (!message) {
    return NextResponse.json({ error: '消息不能为空' }, { status: 400 });
  }

  // 明确的换话题指令：历史清空，本次输入重新从第 1 轮开始
  if (isNewTopicCommand(message)) {
    resetSession(sessionId);
  }

  const round = appendTurn(sessionId, message);
  const turns = getTurns(sessionId);
  const context = buildContext(turns);

  const result = await runCozeWorkflow(context);
  if (!result.ok) {
    const status = result.notConfigured ? 503 : 502;
    return NextResponse.json(
      { error: result.error, notConfigured: result.notConfigured },
      { status },
    );
  }

  const { clarity, question, solution } = extractResult(result.data);

  if (clarity <= 1) {
    return NextResponse.json(
      { type: 'question', clarity, content: question, round },
      { status: 200 },
    );
  }
  return NextResponse.json(
    { type: 'solution', clarity, content: solution, round },
    { status: 200 },
  );
}