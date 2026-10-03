import {
  buildContextInput,
  decomposeReport,
  isNewTopic,
  judge,
  splitReviewOutput,
  streamReport,
  type Judgement,
} from '@/lib/decomposer';
import { deepRun } from '@/lib/workflow';
import {
  streamDeepWorkflow,
  FALLBACK_STAGES,
} from '@/lib/workflowStream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 内存会话表：sessionId -> 该会话的用户输入轮次（不含 AI 回复） */
const sessions = new Map<string, string[]>();

const DEFAULT_SCENE = '智能识别';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Ctl = ReadableStreamDefaultController<Uint8Array>;

interface Sink {
  send(type: string, payload?: Record<string, unknown>): void;
  end(): void;
  abort(err: unknown): void;
}

function makeSink(controller: Ctl): Sink {
  const enc = new TextEncoder();
  const encode = (obj: unknown) => enc.encode(`data: ${JSON.stringify(obj)}\n\n`);
  return {
    send(type, payload = {}) {
      try {
        controller.enqueue(encode({ type, ...payload }));
      } catch {
        /* closed */
      }
    },
    end() {
      try {
        controller.enqueue(encode({ type: 'done' }));
        controller.close();
      } catch {
        /* closed */
      }
    },
    abort(err) {
      try {
        const msg = (err as Error)?.message ?? String(err);
        controller.enqueue(encode({ type: 'error', message: msg }));
        controller.close();
      } catch {
        /* closed */
      }
    },
  };
}

export async function POST(req: Request) {
  let body: {
    sessionId?: string;
    message?: string;
    mode?: string;
    scene?: string;
    stream?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: '请求体不是合法 JSON' });
  }
  const { sessionId, message, mode: rawMode = 'quick', scene, stream = false } = body ?? {};
  if (!sessionId || typeof sessionId !== 'string' || typeof message !== 'string' || !message.trim()) {
    return json(400, { error: '缺少 sessionId 或 message' });
  }

  const mode = rawMode === 'deep' ? 'deep' : 'quick';
  const msg = message.trim();
  let turns = sessions.get(sessionId) ?? [];
  if (isNewTopic(msg)) turns = [];
  turns.push(msg);
  sessions.set(sessionId, turns);

  const context = buildContextInput(turns);

  if (!stream) {
    return runNonStream(context, req.headers, mode, scene, turns.length);
  }

  const headers = new Headers({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no',
  });

  const streamable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const sink = makeSink(controller);
      const effectiveScene =
        mode === 'deep' && scene && scene !== DEFAULT_SCENE ? scene : undefined;
      try {
        if (mode === 'deep') {
          await streamDeep(sink, context, effectiveScene);
        } else {
          await streamQuick(sink, context, req.headers, scene);
        }
        sink.end();
      } catch (e) {
        sink.abort(e);
      }
    },
  });

  return new Response(streamable, { headers });
}

/* ---------------- 快速模式：流式 ---------------- */
async function streamQuick(sink: Sink, context: string, headers: Headers, scene?: string) {
  sink.send('phase', { id: 'judge', label: '快速预诊中：清晰度评估' });
  let judgement: Judgement;
  try {
    judgement = await judge(context, headers, scene);
  } catch (e) {
    throw new Error(`判断服务暂不可用：${(e as Error)?.message ?? String(e)}`);
  }

  if (judgement.clarity <= 1) {
    sink.send('phase', { id: 'judge', done: true });
    sink.send('result', { result: questionPayload(judgement, turnsLen(context)) });
    return;
  }

  sink.send('phase', { id: 'judge', done: true });
  sink.send('phase', { id: 'report', label: '深度拆解中：生成整改方案' });

  let report = '';
  let full = '';
  for await (const item of streamReport(context, headers, judgement.category)) {
    if (typeof item === 'string') {
      report += item;
      sink.send('token', { text: item });
    } else {
      full = item.full;
    }
  }

  let checklist: unknown[] = [];
  let source_tags: string[] = [];
  if (full) {
    const parsed = splitReviewOutput(full);
    checklist = parsed.checklist;
    source_tags = parsed.source_tags;
  } else {
    const r = await decomposeReport(context, headers, judgement.category);
    checklist = r.checklist;
    source_tags = r.source_tags;
  }
  if (!report) report = '（未能生成报告内容）';

  sink.send('phase', { id: 'report', done: true });
  sink.send('result', {
    result: {
      type: 'solution',
      mode: 'quick',
      clarity: judgement.clarity,
      category: judgement.category,
      clarity_desc: judgement.clarity_desc,
      content: report,
      round: turnsLen(context),
      checklist,
      source_tags,
    },
  });
}

function turnsLen(context: string): number {
  const m = context.match(/第\d+轮/g);
  return m ? m.length : 1;
}

/* ---------------- 深度模式：流式 ---------------- */
async function streamDeep(sink: Sink, context: string, scene?: string) {
  sink.send('phase', {
    id: 'deep',
    label: '深度论证进行中',
    desc: scene ? `（聚焦场景：${scene}）` : '',
  });
  let gotResult = false;
  try {
    for await (const ev of streamDeepWorkflow(context)) {
      if (ev.kind === 'node') {
        sink.send('node', {
          status: ev.status,
          label: ev.label,
          desc: ev.desc,
          idx: ev.idx,
        });
      } else {
        gotResult = true;
        const r = ev.result;
        wPublish(sink, 'deep', r, context);
      }
    }
    if (gotResult) return;
    throw new Error('流式未返回最终结果');
  } catch {
    // 降级：定时动画 + 非流式 deepRun 保证结果
    const timerP = animateFallback(sink);
    let r;
    try {
      r = await deepRun(context);
    } catch (e) {
      throw new Error(`深度模式暂不可用：${(e as Error)?.message ?? String(e)}`);
    }
    await timerP;
    wPublish(sink, 'deep', r, context);
  }
}

function wPublish(
  sink: Sink,
  mode: 'deep',
  r: { clarity: number; category: string; content: string },
  context: string,
) {
  const type = r.clarity <= 1 ? 'question' : 'solution';
  sink.send('result', {
    result: {
      type,
      mode,
      clarity: r.clarity,
      category: r.category,
      clarity_desc: '',
      content: r.content,
      round: turnsLen(context),
    },
  });
}

async function animateFallback(sink: Sink) {
  for (let i = 0; i < FALLBACK_STAGES.length; i++) {
    const s = FALLBACK_STAGES[i];
    sink.send('node', { status: 'active', label: s.label, desc: s.desc, idx: i });
    await sleep(1500);
    sink.send('node', { status: 'done', label: s.label, desc: s.desc, idx: i });
  }
}

/* ---------------- 非流式（接口冒烟用） ---------------- */
function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function runNonStream(
  context: string,
  headers: Headers,
  mode: 'quick' | 'deep',
  scene?: string,
  round?: number,
) {
  // 深度模式
  if (mode === 'deep') {
    try {
      const r = await deepRun(context);
      return json(200, {
        type: r.clarity <= 1 ? 'question' : 'solution',
        mode,
        clarity: r.clarity,
        category: r.category,
        clarity_desc: '',
        content: r.content,
        round,
        checklist: [],
        source_tags: [],
      });
    } catch (e) {
      return json(502, { error: '深度模式暂不可用', detail: (e as Error)?.message ?? String(e) });
    }
  }

  // 快速模式
  let judgement: Judgement;
  try {
    judgement = await judge(context, headers, scene);
  } catch (e) {
    return json(502, { error: '判断服务暂不可用', detail: (e as Error)?.message ?? String(e) });
  }
  if (judgement.clarity <= 1) {
    return json(200, questionPayload(judgement, round));
  }
  try {
    const r = await decomposeReport(context, headers, judgement.category);
    return json(200, {
      type: 'solution',
      mode: 'quick',
      clarity: judgement.clarity,
      category: judgement.category,
      clarity_desc: judgement.clarity_desc,
      content: r.report,
      round,
      checklist: r.checklist,
      source_tags: r.source_tags,
    });
  } catch (e) {
    return json(502, { error: '拆解服务暂不可用', detail: (e as Error)?.message ?? String(e) });
  }
}

function questionPayload(judgement: Judgement, round?: number) {
  return {
    type: 'question' as const,
    mode: 'quick' as const,
    clarity: judgement.clarity,
    category: judgement.category,
    clarity_desc: judgement.clarity_desc,
    missing_info: judgement.missing_info,
    options: judgement.options,
    content: judgement.next_question,
    round,
  };
}