import { appendTurn } from '@/lib/sessionStore';
import { checkRate, clientIp, RATE_RULES } from '@/lib/rateLimit';
import { runDeepChain } from '@/lib/deepChain';
import { streamDeepWorkflow, FALLBACK_STAGES } from '@/lib/workflowStream';
import { deepRun } from '@/lib/workflow';
import { judge, decomposeReport } from '@/lib/decomposer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEEP_FALLBACK_NOTICE =
  '未检测到工作流访问令牌（COZE_PAT），本次评审由快速预诊引擎完成；在部署环境配置 COZE_PAT 后即可启用深度论证工作流。';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: Request) {
  let body: { sessionId?: string; message?: string; scene?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: '请求体不是合法 JSON' });
  }
  const { sessionId, message, scene } = body ?? {};
  if (!sessionId || typeof sessionId !== 'string' || typeof message !== 'string' || !message.trim()) {
    return json(400, { error: '缺少 sessionId 或 message' });
  }

  const rule = checkRate(`deep:${clientIp(req)}`, RATE_RULES.deep);
  if (rule) {
    return json(429, { error: `深度论证请求过于频繁（${rule.label}），请稍后再试` });
  }

  const msg = message.trim();
  const { context, turns } = appendTurn(sessionId, msg);

  const headers = new Headers({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no',
  });

  const streamable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const sink = makeSink(controller);
      const effectiveScene = scene && scene !== '智能识别' ? scene : undefined;
      try {
        await runDeepChain(context, req.headers, effectiveScene, (ev) => sink.send(ev.type, ev as unknown as Record<string, unknown>), turns.length);
      } catch (chainErr) {
        console.log(
          `[deep-chain] 五阶段链失败，降级扣子工作流：${(chainErr as Error)?.message ?? String(chainErr)}`,
        );
        try {
          await fallbackWorkflow(sink, context, req.headers, effectiveScene, turns.length);
        } catch (fbErr) {
          sink.abort(fbErr);
          return;
        }
      }
      sink.end();
    },
  });

  return new Response(streamable, { headers });
}

/* ---------------- 降级通道：扣子工作流（保留原 API 调用） ---------------- */
async function fallbackWorkflow(
  sink: Sink,
  context: string,
  reqHeaders: Headers,
  scene: string | undefined,
  round: number,
) {
  sink.send('phase_reset');
  let gotResult = false;
  try {
    for await (const ev of streamDeepWorkflow(context)) {
      if (ev.kind === 'node') {
        sink.send('node', { status: ev.status, label: ev.label, desc: ev.desc, idx: ev.idx });
      } else {
        gotResult = true;
        publishResult(sink, ev.result, context, round);
      }
    }
    if (gotResult) return;
    throw new Error('流式未返回最终结果');
  } catch {
    const timerP = animateFallback(sink);
    if (!process.env.COZE_PAT) {
      const r = await deepViaLLM(context, reqHeaders, scene);
      await timerP;
      publishResult(sink, r, context, round, DEEP_FALLBACK_NOTICE);
      return;
    }
    const r = await deepRun(context);
    await timerP;
    publishResult(sink, r, context, round);
  }
}

type WfResult = {
  clarity: number;
  category?: string;
  content: string;
  checklist?: unknown[];
  source_tags?: unknown[];
  plagiarism?: unknown;
  evidence?: unknown;
};

function publishResult(
  sink: Sink,
  r: WfResult,
  context: string,
  round: number,
  notice?: string,
) {
  sink.send('result', {
    result: {
      type: r.clarity <= 1 ? 'question' : 'solution',
      mode: 'deep',
      clarity: r.clarity,
      category: r.category ?? '其他',
      clarity_desc: '',
      content: r.content,
      round,
      checklist: r.checklist ?? [],
      source_tags: r.source_tags ?? [],
      plagiarism: (r as any).plagiarism,
      evidence: (r as any).evidence,
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

/** 无 COZE_PAT 时的最终兜底：judge + decomposeReport */
async function deepViaLLM(context: string, headers: Headers, scene?: string): Promise<WfResult> {
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

/* ---------------- SSE 基础设施 ---------------- */
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

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
