import { COZE_CONFIG, COZE_PAT, isCozeConfigured } from './coze-config';

/** 一个会话的多轮上下文：每个元素是用户某一轮说的话 */
const sessions = new Map<string, string[]>();

/** 用于识别「新需求 / 换话题」的触发词（整段匹配，避免误伤正文） */
const NEW_TOPIC_RE =
  /^(新需求|新建(需求|话题)|换(个|一)(话题|需求|项目)|重新(开始|来)|从新来|重来|重新发起|clear|reset|reset context)$/i;

export interface WorkflowResult {
  clarity: number;
  question: string;
  solution: string;
}

/** 是否属于明确的换话题指令：进本函数前的消息若命中则清空历史 */
export function isNewTopicCommand(message: string): boolean {
  return NEW_TOPIC_RE.test(message.trim());
}

export function getTurns(sessionId: string): string[] {
  return sessions.get(sessionId) ?? [];
}

export function resetSession(sessionId: string): void {
  sessions.delete(sessionId);
}

/** 返回追加后的轮数 */
export function appendTurn(sessionId: string, message: string): number {
  const turns = sessions.get(sessionId) ?? [];
  turns.push(message.trim());
  sessions.set(sessionId, turns);
  return turns.length;
}

/** 把多轮历史拼成固定格式上下文 */
export function buildContext(turns: string[]): string {
  return turns.map((t, i) => `第${i + 1}轮：[${t}]`).join('\n');
}

/**
 * 调用扣子工作流 API。
 * 返回 data 字段（JSON 字符串）需解析两次：第一层是工作流响应 JSON，
 * 第二层是工作流内部的输出结构。这里做了健壮的多层解析。
 */
export async function runCozeWorkflow(
  context: string,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string; notConfigured: boolean }> {
  if (!isCozeConfigured()) {
    return { ok: false, error: 'COZE_NOT_CONFIGURED', notConfigured: true };
  }

  let response: Response;
  try {
    response = await fetch(COZE_CONFIG.apiBase, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${COZE_PAT}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workflow_id: COZE_CONFIG.workflowId,
        parameters: { [COZE_CONFIG.inputParam]: context },
        is_async: false,
      }),
    });
  } catch (err) {
    return {
      ok: false,
      error: `无法连接到扣子工作流服务：${err instanceof Error ? err.message : String(err)}`,
      notConfigured: false,
    };
  }

  let raw: any;
  try {
    raw = await response.json();
  } catch {
    return { ok: false, error: '扣子工作流返回了非法响应', notConfigured: false };
  }

  if (!response.ok || (raw.code !== undefined && raw.code !== 0)) {
    return { ok: false, error: raw?.msg || raw?.message || '扣子工作流调用失败', notConfigured: false };
  }

  // data 字段是 JSON 字符串，可能需要解析两层（详见函数注释）
  let parsed: unknown;
  try {
    parsed = raw.data;
    if (typeof parsed === 'string') parsed = JSON.parse(parsed);
    if (typeof parsed === 'string') parsed = JSON.parse(parsed);
  } catch {
    return { ok: false, error: '扣子工作流返回的数据不是合法 JSON', notConfigured: false };
  }

  return { ok: true, data: parsed };
}

/** 在多层嵌套对象中向上查找某个 key 的值 */
function findKey(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const v = findKey(item, key);
      if (v !== undefined) return v;
    }
    return undefined;
  }
  const record = obj as Record<string, unknown>;
  if (key in record) return record[key];
  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') {
      const v = findKey(value, key);
      if (v !== undefined) return v;
    }
  }
  return undefined;
}

const toNumber = (v: unknown, fallback = 0): number =>
  typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : fallback;
const toText = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** 从工作流返回对象中稳妥解出 clarity / question_result / solution_result */
export function extractResult(data: unknown): WorkflowResult {
  return {
    clarity: toNumber(findKey(data, 'clarity')),
    question: toText(findKey(data, 'question_result')),
    solution: toText(findKey(data, 'solution_result')),
  };
}