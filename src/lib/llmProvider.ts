import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { LLM_CONFIG } from './config';

/**
 * LLM 供应商抽象：配置了 DEEPSEEK_API_KEY 时直连 DeepSeek（用户自有额度），
 * 否则回退 coze-coding-dev-sdk（平台注入凭据）。判断/拆解/流式共用。
 */

export interface LlmCallOptions {
  model: string;
  temperature: number;
  headers?: Headers;
  timeoutMs?: number;
}

function deepseekKey(): string {
  return LLM_CONFIG.deepseek.apiKey.trim();
}

export function llmProviderName(): 'deepseek' | 'coze' {
  return deepseekKey() ? 'deepseek' : 'coze';
}

/** 供应商模型映射：豆包语义角色（判断/拆解）→ DeepSeek 对应模型 */
function resolveModel(model: string): string {
  if (llmProviderName() !== 'deepseek') return model;
  if (model === LLM_CONFIG.judgeModel) return LLM_CONFIG.deepseek.judgeModel;
  if (model === LLM_CONFIG.reportModel) return LLM_CONFIG.deepseek.reportModel;
  return model;
}

function cozeHeaders(headers?: Headers): Record<string, string> | undefined {
  return headers ? HeaderUtils.extractForwardHeaders(headers) : undefined;
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
      model: resolveModel(opts.model),
      temperature: opts.temperature,
      stream,
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
          model: opts.model,
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
  if (llmProviderName() === 'deepseek') {
    let lastError: unknown;
    for (let attempt = 0; attempt <= LLM_CONFIG.retries; attempt++) {
      try {
        const resp = await deepseekFetch(system, user, opts, false);
        const data = (await resp.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        return data.choices?.[0]?.message?.content ?? '';
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError;
  }
  return cozeInvoke(system, user, opts);
}

export async function* chatStream(
  system: string,
  user: string,
  opts: LlmCallOptions,
): AsyncGenerator<string> {
  if (llmProviderName() === 'deepseek') {
    const resp = await deepseekFetch(system, user, opts, true);
    const body = resp.body;
    if (!body) throw new Error('DeepSeek 流式响应为空');
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
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
            choices?: { delta?: { content?: string } }[];
          };
          const delta = obj.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          /* 忽略不完整分片 */
        }
      }
    }
    return;
  }
  const client = new LLMClient(new Config(), cozeHeaders(opts.headers));
  for await (const chunk of client.stream(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    {
      model: opts.model,
      temperature: opts.temperature,
      thinking: 'disabled',
      caching: 'disabled',
    },
  )) {
    const text = chunk.content ? chunk.content.toString() : '';
    if (text) yield text;
  }
}
