import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { LLM_CONFIG } from './config';
import { recordUsage } from './usageLog';

/**
 * LLM 供应商抽象：配置了 DEEPSEEK_API_KEY 时直连 DeepSeek（用户自有额度），
 * 否则回退 coze-coding-dev-sdk（平台注入凭据）。判断/拆解/流式共用。
 */

export interface LlmCallOptions {
  model: string;
  temperature: number;
  headers?: Headers;
  timeoutMs?: number;
  maxTokens?: number;
  /** 用量归因：quick / deep */
  mode?: string;
}

export interface StreamDelta {
  reasoning?: string;
  content?: string;
  usage?: LlmUsage;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens?: number;
}

function deepseekKey(): string {
  return LLM_CONFIG.deepseek.apiKey.trim();
}

export function llmProviderName(): 'deepseek' | 'coze' {
  return deepseekKey() ? 'deepseek' : 'coze';
}

/** DeepSeek 路径模型映射：豆包语义角色（判断/拆解）→ DeepSeek 对应模型；官方名透传 */
function resolveDeepseekModel(model: string): string {
  if (model === LLM_CONFIG.judgeModel) return LLM_CONFIG.deepseek.chatModel;
  if (model === LLM_CONFIG.reportModel) return LLM_CONFIG.deepseek.chatModel;
  return model;
}

/** coze 回退路径模型映射：DeepSeek 官方名 → 豆包对应模型 */
function resolveCozeModel(model: string): string {
  if (model === 'deepseek-reasoner') return LLM_CONFIG.reportModel;
  if (model === 'deepseek-chat') return LLM_CONFIG.judgeModel;
  return model;
}

function cozeHeaders(headers?: Headers): Record<string, string> | undefined {
  return headers ? HeaderUtils.extractForwardHeaders(headers) : undefined;
}

function logUsage(
  provider: string,
  model: string,
  elapsedMs: number,
  usage: LlmUsage | undefined,
  mode?: string,
) {
  if (usage) {
    console.log(
      `[llm] provider=${provider} model=${model} mode=${mode ?? '-'} elapsed=${elapsedMs}ms prompt=${usage.promptTokens} completion=${usage.completionTokens}` +
        (usage.reasoningTokens ? ` reasoning=${usage.reasoningTokens}` : ''),
    );
  } else {
    console.log(`[llm] provider=${provider} model=${model} mode=${mode ?? '-'} elapsed=${elapsedMs}ms usage=unavailable`);
  }
  recordUsage({
    time: new Date().toISOString(),
    provider,
    model,
    mode,
    elapsedMs,
    promptTokens: usage?.promptTokens,
    completionTokens: usage?.completionTokens,
    reasoningTokens: usage?.reasoningTokens,
  });
}

async function deepseekFetch(
  system: string,
  user: string,
  opts: LlmCallOptions,
  stream: boolean,
): Promise<Response> {
  const resp = await fetch(`${LLM_CONFIG.deepseek.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${deepseekKey()}`,
    },
    body: JSON.stringify({
      model: resolveDeepseekModel(opts.model),
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
      stream,
      ...(stream ? { stream_options: { include_usage: true } } : {}),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? LLM_CONFIG.timeoutMs),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`DeepSeek API ${resp.status}: ${detail.slice(0, 200)}`);
  }
  return resp;
}

async function cozeInvoke(
  system: string,
  user: string,
  opts: LlmCallOptions,
): Promise<string> {
  const client = new LLMClient(new Config(), cozeHeaders(opts.headers));
  let lastError: unknown;
  for (let attempt = 0; attempt <= LLM_CONFIG.retries; attempt++) {
    try {
      const resp = await client.invoke(
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        {
          model: resolveCozeModel(opts.model),
          temperature: opts.temperature,
          thinking: 'disabled',
          caching: 'disabled',
        },
      );
      return resp.content;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

export async function chatText(
  system: string,
  user: string,
  opts: LlmCallOptions,
): Promise<string> {
  const startedAt = Date.now();
  if (llmProviderName() === 'deepseek') {
    let lastError: unknown;
    for (let attempt = 0; attempt <= LLM_CONFIG.retries; attempt++) {
      try {
        const resp = await deepseekFetch(system, user, opts, false);
        const data = (await resp.json()) as {
          choices?: { message?: { content?: string } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        logUsage('deepseek', resolveDeepseekModel(opts.model), Date.now() - startedAt, {
          promptTokens: data.usage?.prompt_tokens ?? 0,
          completionTokens: data.usage?.completion_tokens ?? 0,
        }, opts.mode);
        return data.choices?.[0]?.message?.content ?? '';
      } catch (e) {
        lastError = e;
      }
    }
    logUsage('deepseek', resolveDeepseekModel(opts.model), Date.now() - startedAt, undefined, opts.mode);
    throw lastError;
  }
  const text = await cozeInvoke(system, user, opts);
  logUsage('coze', resolveCozeModel(opts.model), Date.now() - startedAt, undefined, opts.mode);
  return text;
}

export async function* chatStream(
  system: string,
  user: string,
  opts: LlmCallOptions,
): AsyncGenerator<StreamDelta> {
  const startedAt = Date.now();
  const model = llmProviderName() === 'deepseek' ? resolveDeepseekModel(opts.model) : resolveCozeModel(opts.model);
  if (llmProviderName() === 'deepseek') {
    const resp = await deepseekFetch(system, user, opts, true);
    const body = resp.body;
    if (!body) throw new Error('DeepSeek 流式响应为空');
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let usage: LlmUsage | undefined;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const obj = JSON.parse(payload) as {
            choices?: { delta?: { content?: string | null; reasoning_content?: string | null } }[];
            usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } } | null;
          };
          const delta = obj.choices?.[0]?.delta;
          if (delta?.reasoning_content) yield { reasoning: delta.reasoning_content };
          if (delta?.content) yield { content: delta.content };
          if (obj.usage) {
            usage = {
              promptTokens: obj.usage.prompt_tokens ?? 0,
              completionTokens: obj.usage.completion_tokens ?? 0,
              reasoningTokens: obj.usage.completion_tokens_details?.reasoning_tokens,
            };
            yield { usage };
          }
        } catch {
          /* 忽略不完整分片 */
        }
      }
    }
    logUsage('deepseek', model, Date.now() - startedAt, usage, opts.mode);
    return;
  }
  const client = new LLMClient(new Config(), cozeHeaders(opts.headers));
  for await (const chunk of client.stream(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    {
      model,
      temperature: opts.temperature,
      thinking: 'disabled',
      caching: 'disabled',
    },
  )) {
    const text = chunk.content ? chunk.content.toString() : '';
    if (text) yield { content: text };
  }
  logUsage('coze', model, Date.now() - startedAt, undefined, opts.mode);
}
