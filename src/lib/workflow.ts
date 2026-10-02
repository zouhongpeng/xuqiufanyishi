import { DEEP_CONFIG } from './config';

export interface DeepResult {
  clarity: number;
  category: string;
  content: string;
}

/** 扣子 workflow/run 的 data 字段是 JSON 字符串，需解析两次 */
function doubleParse(raw: unknown): unknown {
  let d = raw;
  for (let i = 0; i < 2; i++) {
    if (typeof d !== 'string') break;
    try {
      d = JSON.parse(d);
    } catch {
      break;
    }
  }
  return d;
}

/** 递归查找嵌套对象里的字段（兼容工作流输出包多层） */
function findKey(o: unknown, key: string): unknown {
  if (!o || typeof o !== 'object') return undefined;
  const obj = o as Record<string, unknown>;
  if (key in obj) return obj[key];
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const r = findKey(v, key);
      if (r !== undefined) return r;
    }
  }
  return undefined;
}

/**
 * 深度模式：调用扣子工作流完成「判断+拆解」。
 * 返回 clarity 与对应内容：clarity≤1 为追问 question_result，≥2 为报告 solution_result。
 */
export async function deepRun(context: string): Promise<DeepResult> {
  const token = process.env.COZE_PAT;
  if (!token) {
    throw new Error('未配置 COZE_PAT：深度模式需要扣子开放平台访问令牌（放环境变量）');
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEEP_CONFIG.timeoutMs);
  try {
    const res = await fetch(DEEP_CONFIG.apiBase, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workflow_id: DEEP_CONFIG.workflowId,
        parameters: { [DEEP_CONFIG.inputParam]: context },
        is_async: false,
      }),
      signal: ctrl.signal,
    });

    const raw: any = await res.json().catch(() => ({}));
    if (!res.ok || (raw.code !== undefined && raw.code !== 0)) {
      throw new Error(raw?.msg || raw?.error || `工作流调用失败（HTTP ${res.status}）`);
    }

    const data = doubleParse(raw?.data);
    const clarity = Number(findKey(data, 'clarity') ?? 0) || 0;
    const category = String(findKey(data, 'category') ?? '');
    const question = findKey(data, 'question_result') as string | undefined;
    const solution = findKey(data, 'solution_result') as string | undefined;
    const content = clarity <= 1 ? String(question ?? '') : String(solution ?? '');
    return { clarity, category, content };
  } finally {
    clearTimeout(timer);
  }
}