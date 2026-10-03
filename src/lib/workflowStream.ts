import { DEEP_CONFIG } from './config';
import { deepRun, type DeepResult } from './workflow';

/**
 * 深度论证模式：调用扣子工作流流式接口（/v1/workflow/stream_run），
 * 解析节点事件映射为「评审环节」，真实逐个点亮。
 * 流式/解析任一环节失败即抛错，由路由退回「定时动画 + deepRun 兜底」。
 */

/** 节点名 → 评审环节映射（按关键字匹配；未匹配归入「扩展检查项」，后续可校正） */
export const REVIEW_STAGES: { label: string; desc: string; kw: string[] }[] = [
  { label: '立项材料审查', desc: '核对需求完整性与自主性', kw: ['输入处理', '上下文标准化', '输入', '开始'] },
  { label: '场景识别', desc: '判定领域与评审口径', kw: ['场景识别', '场景'] },
  { label: '创新性论证', desc: '评估新颖度与差异化空间', kw: ['清晰度', '需求分析', '创新'] },
  { label: '科学性校验', desc: '检查逻辑与依据', kw: ['追问', '校验', '依据'] },
  { label: '查重比对', desc: '正在比对往届案例库…', kw: ['案例检索', '知识匹配', '查重', '案例'] },
  { label: '可行性评估', desc: '分析资源与工作量匹配', kw: ['方案拆解', '深度解析', '可行', '评估'] },
  { label: '风险识别', desc: '预警与降级方案', kw: ['风险', '预判'] },
  { label: '行动规划', desc: '生成整改行动方案', kw: ['行动清单', '优先级', '行动', '规划'] },
  { label: '报告整合', desc: '汇编评审结论', kw: ['输出处理', '输出', '报告', '整合'] },
];

/** 静态兜底环节（流式失败时定时播放） */
export const FALLBACK_STAGES = [
  { label: '立项材料审查', desc: '核对需求完整性与自主性' },
  { label: '场景识别', desc: '判定领域与评审口径' },
  { label: '创新性论证', desc: '评估新颖度与差异化空间' },
  { label: '科学性校验', desc: '检查逻辑与依据' },
  { label: '查重比对', desc: '正在比对往届案例库…' },
  { label: '可行性评估', desc: '分析资源与工作量匹配' },
  { label: '风险识别', desc: '预警与降级方案' },
  { label: '行动规划', desc: '生成整改行动方案' },
  { label: '报告整合', desc: '汇编评审结论' },
];

export interface DeepNodeEvent {
  kind: 'node';
  status: 'active' | 'done';
  label: string;
  desc: string;
  idx: number;
}

function matchStage(nodeName: string): { label: string; desc: string } {
  const s = REVIEW_STAGES.find((st) => st.kw.some((k) => nodeName.includes(k)));
  return (
    s ?? {
      label: '扩展检查项',
      desc: `节点：${nodeName}`,
    }
  );
}

/** 尝试从任意 JSON 或文本中提取工作流最终输出字段 */
function extractFinal(raw: string): { files: string[] } {
  const keys = ['question_result', 'solution_result', 'result', 'output'];
  const found = keys.filter((k) => raw.includes(`"${k}"`) || raw.includes(`'${k}'`));
  return { files: found };
}

export async function* streamDeepWorkflow(
  context: string,
): AsyncGenerator<DeepNodeEvent | { kind: 'result'; result: DeepResult }> {
  const token = process.env.COZE_PAT;
  if (!token) {
    throw new Error('未配置 COZE_PAT：深度模式需要扣子开放平台访问令牌（放环境变量）');
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEEP_CONFIG.timeoutMs);
  let rawAll = '';
  let lastActiveIdx = -1;
  const stageDone = new Array(REVIEW_STAGES.length).fill(false);

  const emitActive = (label: string, desc: string) => {
    const idx = Math.max(0, REVIEW_STAGES.findIndex((s) => s.label === label));
    if (idx >= 0) {
      stageDone[idx] = false;
      lastActiveIdx = idx;
      return { kind: 'node' as const, status: 'active' as const, label, desc, idx };
    }
    return {
      kind: 'node' as const,
      status: 'active' as const,
      label,
      desc,
      idx: REVIEW_STAGES.length,
    };
  };
  const emitDone = (label: string, desc: string) => {
    const idx = REVIEW_STAGES.findIndex((s) => s.label === label);
    if (idx >= 0) stageDone[idx] = true;
    return {
      kind: 'node' as const,
      status: 'done' as const,
      label,
      desc,
      idx: idx >= 0 ? idx : Math.max(0, lastActiveIdx),
    };
  };

  try {
    const res = await fetch(DEEP_CONFIG.streamRunUrl, {
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

    if (!res.ok || !res.body) {
      throw new Error(`工作流流式接口不可用（HTTP ${res.status}）`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalContent = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      rawAll = buffer;

      // 逐行解析 SSE-style / 逐 JSON 行
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) continue;
        let obj: any;
        try {
          obj = JSON.parse(trimmed);
        } catch {
          continue;
        }
        const event = obj.event ?? obj.type ?? '';
        const nodeName =
          obj.node_name ??
          obj.nodeName ??
          (obj.data && (obj.data.node_name || obj.data.nodeTitle)) ??
          '';
        if (nodeName) {
          const stage = matchStage(String(nodeName));
          if (String(event).toLowerCase().includes('start') || event === 'node_start' || !String(event).toLowerCase().includes('finish')) {
            yield emitActive(stage.label, stage.desc);
          } else {
            yield emitDone(stage.label, stage.desc);
          }
        }
        // 最终消息内容（对话结果）
        const content =
          obj.content ??
          (obj.message && (obj.message.content ?? obj.message.content)) ??
          (obj.data && obj.data.output) ??
          '';
        if (content && typeof content === 'string' && content.length > finalContent.length) {
          finalContent = content;
        }
      }
    }

    // 若从流中拿到了最终输出，解析为 DeepResult
    const outputKeys = extractFinal(finalContent || rawAll);
    if (outputKeys.files.length > 0 && finalContent) {
      const parsed = parseDeepOutput(finalContent);
      if (parsed) {
        yield { kind: 'result', result: parsed };
        return;
      }
    }
    throw new Error('流式未取到可解析的最终结果');
  } finally {
    clearTimeout(timer);
  }
}

function parseDeepOutput(text: string): DeepResult | null {
  // 尝试从含 JSON 的文本中提取 clarity 与 question/solution_result
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let obj: any;
  try {
    obj = JSON.parse(m[0]);
  } catch {
    // 可能在 JSON 字符串里（data 二次解析）
    try {
      obj = JSON.parse(text);
    } catch {
      return null;
    }
  }
  const clarity =
    obj.clarity ?? obj.data?.clarity ?? obj.message?.clarity ?? obj.result?.clarity;
  const question = obj.question_result ?? obj.message?.question_result;
  const solution = obj.solution_result ?? obj.message?.solution_result;
  if (clarity === undefined) return null;
  const c = Number(clarity) || 0;
  return {
    clarity: c,
    category: String(obj.category ?? obj.data?.category ?? '') || '科创赛诊断',
    content: c <= 1 ? String(question ?? '') : String(solution ?? ''),
  };
}

/** 兜底：非流式 deepRun（结果保底） */
export { deepRun };