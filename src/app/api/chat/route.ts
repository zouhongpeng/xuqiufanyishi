import {
  decomposeReport,
  judge,
  reviewChecklist,
  streamReport,
  type Judgement,
} from '@/lib/decomposer';
import { deepRun } from '@/lib/workflow';
import {
  streamDeepWorkflow,
  FALLBACK_STAGES,
} from '@/lib/workflowStream';
import { appendTurn, turnCount } from '@/lib/sessionStore';
import { checkRate, clientIp, RATE_RULES } from '@/lib/rateLimit';
import { runDeepChain } from '@/lib/deepChain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_SCENE = '智能识别';

const DEEP_FALLBACK_NOTICE =
  '未检测到工作流访问令牌（COZE_PAT），本次评审由快速预诊引擎完成；在部署环境配置 COZE_PAT 后即可启用深度论证工作流。';

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

  if (mode === 'quick') {
    const rateRule = checkRate(`quick:${clientIp(req)}`, RATE_RULES.quick);
    if (rateRule) {
      return json(429, { error: `请求过于频繁（${rateRule.label}），请稍后再试` });
    }
  }

  const { context, turns } = appendTurn(sessionId, msg);

  if (!stream) {
    return runNonStream(context, req.headers, mode, scene, turns.length, sessionId);
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
          await streamDeep(sink, context, req.headers, effectiveScene, turns.length, sessionId);
        } else {
          await streamQuick(sink, context, req.headers, scene, turns.length);
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
async function streamQuick(sink: Sink, context: string, headers: Headers, scene?: string, round = 1) {
  sink.send('phase', { id: 'judge', label: '快速预诊中：清晰度评估' });
  let judgement: Judgement;
  try {
    judgement = await judge(context, headers, scene);
  } catch (e) {
    throw new Error(`判断服务暂不可用：${(e as Error)?.message ?? String(e)}`);
  }

  if (judgement.clarity <= 1) {
    sink.send('phase', { id: 'judge', done: true });
    sink.send('result', { result: questionPayload(judgement, round) });
    return;
  }

  sink.send('phase', { id: 'judge', done: true });
  sink.send('phase', { id: 'report', label: '深度拆解中：生成整改方案' });

  let report = '';
  for await (const item of streamReport(context, headers, judgement.category, scene)) {
    if (typeof item === 'string') {
      report += item;
      sink.send('token', { text: item });
    }
  }

  const rv = await reviewChecklist(context, report, headers);
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
      round,
      checklist: rv.checklist,
      source_tags: rv.source_tags,
    },
  });
}

/* ---------------- 深度模式：五阶段论证链（DeepSeek）→ 降级扣子工作流 ---------------- */
async function streamDeep(
  sink: Sink,
  context: string,
  headers: Headers,
  scene: string | undefined,
  round: number,
  sessionId?: string,
) {
  try {
    await runDeepChain(
      context,
      headers,
      scene,
      (ev) => sink.send(ev.type, ev as unknown as Record<string, unknown>),
      round,
      { clarify: turnCount(sessionId ?? '') === 1 },
    );
    return;
  } catch (chainErr) {
    console.log(
      `[deep-chain] 五阶段链失败，降级扣子工作流：${(chainErr as Error)?.message ?? String(chainErr)}`,
    );
  }

  // 降级：照常播放评审环节动画；无工作流令牌时退回 LLM 引擎，否则 deepRun
  sink.send('phase_reset');
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
        wPublish(sink, 'deep', ev.result, context, round);
      }
    }
    if (gotResult) return;
    throw new Error('流式未返回最终结果');
  } catch {
    const timerP = animateFallback(sink);
    if (!process.env.COZE_PAT) {
      try {
        const r = await deepViaLLM(context, headers, scene);
        await timerP;
        wPublish(sink, 'deep', r, context, round, DEEP_FALLBACK_NOTICE);
        return;
      } catch (e) {
        throw new Error(`深度模式暂不可用：${(e as Error)?.message ?? String(e)}`);
      }
    }
    let r;
    try {
      r = await deepRun(context);
    } catch (e) {
      throw new Error(`深度模式暂不可用：${(e as Error)?.message ?? String(e)}`);
    }
    await timerP;
    wPublish(sink, 'deep', r, context, round);
  }
}

interface DeepLLMResult {
  clarity: number;
  category: string;
  content: string;
  checklist?: unknown[];
  source_tags?: unknown[];
  plagiarism?: unknown;
  evidence?: unknown;
}

/** 无 COZE_PAT 时的深度模式兜底：judge + decomposeReport（SDK 平台凭证，无需令牌） */
async function deepViaLLM(
  context: string,
  headers: Headers,
  scene?: string,
): Promise<DeepLLMResult> {
  const j = await judge(context, headers, scene);
  if (j.clarity <= 1) {
    return { clarity: j.clarity, category: j.category, content: j.next_question };
  }
  const rep = await decomposeReport(context, headers, j.category, scene);
  return {
    clarity: j.clarity,
    category: j.category,
    content: rep.report,
    checklist: rep.checklist,
    source_tags: rep.source_tags,
    plagiarism: rep.plagiarism,
    evidence: rep.evidence,
  };
}

function wPublish(
  sink: Sink,
  mode: 'deep',
  r: DeepLLMResult,
  context: string,
  round: number,
  notice?: string,
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
      round,
      checklist: r.checklist ?? [],
      source_tags: r.source_tags ?? [],
      plagiarism: r.plagiarism,
      evidence: r.evidence,
      ...(notice ? { notice } : {}),
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
  sessionId?: string,
) {
  // 深度模式：与流式一致走 DeepSeek 五阶段链（clarify/完整结果原样返回）
  if (mode === 'deep') {
    let out: Record<string, unknown> | null = null;
    try {
      await runDeepChain(context, headers, scene, (ev) => {
        if (ev.type === 'result') out = ev.result as unknown as Record<string, unknown>;
      }, round ?? 1, { clarify: turnCount(sessionId ?? '') === 1 });
    } catch (e) {
      return json(502, { error: '深度模式暂不可用', detail: (e as Error)?.message ?? String(e) });
    }
    if (!out) {
      return json(502, { error: '深度模式暂不可用', detail: '五阶段链未产出结果' });
    }
    return json(200, out);
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
    const r = await decomposeReport(context, headers, judgement.category, scene);
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