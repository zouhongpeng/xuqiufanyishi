import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { LLM_CONFIG } from './config';

/**
 * 需求拆解引擎：完全由 LLM 完成需求清晰度判断与完整拆解。
 * 不依赖任何工作流 API。多轮上下文由后端维护，每次调用前拼成
 * 「第1轮：[..] 第2轮：[..]」的形式传入。
 */

const JUDGE_SYSTEM = `你是一个需求分析专家。分析用户的需求描述，判断其清晰程度。

清晰度评分标准（0-3）：
- 0：只有一个模糊方向，如"我想做抖音"，缺少领域、目标、受众等关键信息
- 1：有大致方向但缺关键要素，如知道做什么但不知道目标受众
- 2：基本清楚做什么、给谁、目标是什么，但缺少执行细节
- 3：目标、受众、形式、约束条件都明确，可直接执行

判断原则：从严判断，大多数人处于0或1，不要轻易给2或3。结合多轮对话历史综合判断，用户补充的信息要累计考虑。

识别需求所属场景：视频创作/文章写作/创业项目/学习提升/活动策划/其他。

输出严格JSON格式，不要任何其他文字：
{
  "clarity": 0-3的数字,
  "category": "场景分类",
  "clarity_desc": "哪些已经明确，哪些还不明确",
  "next_question": "clarity≤1时给出一个自然的追问，朋友聊天语气，2-3句话，无emoji不列点，一次只问最关键的一件事；clarity≥2时输出空字符串"
}`;

const DECOMPOSE_SYSTEM = `你是一个资深的需求拆解专家，擅长把模糊想法变成可执行方案。

根据完整对话历史中的用户需求，生成拆解报告，Markdown格式：

# 需求拆解报告

## 需求理解
- 真实需求：一句话说清
- 核心动机：用户背后的真正目的
- 隐含约束：用户没说但很关键的限定条件

## 拆解方案
分3-5个模块，每个模块包含具体可落地的执行细节（具体到工具、数字、步骤、时间点，拒绝空话套话）

## 风险规避
2-3个最可能踩的坑+具体规避方法

## 行动清单
按优先级排序，每条包含：优先级【高/中/低】、预计时间、验收标准（可量化）、依赖项

## 继续推进
A. 帮我把第一步做出来
B. 帮我评估时间和成本
C. 我想调整一下方向

要求：根据场景用对应领域的专业知识拆解（如抖音要懂流量逻辑、选题、发布节奏；学习要懂方法论），全文无emoji，直接输出报告内容。`;

export interface Judgement {
  clarity: number;
  category: string;
  clarity_desc: string;
  next_question: string;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  meta?: { type?: 'question' | 'solution'; category?: string };
}

/** 每轮仅拼接用户消息；assistant 追问/报告不进入工作因子（贴合“N轮=[第N个用户输入]”约定） */
export function buildContextInput(userTurns: string[]): string {
  return userTurns.map((t, i) => `第${i + 1}轮：[${t}]`).join('\n');
}

/** 换话题触发词：命中即清空历史重新从第 1 轮开始 */
const NEW_TOPIC_RE =
  /^\s*(新需求|换一个|换话题|换个需求|换个想法|重新开始|重新来|重来|新建需求|新想法|从新|重新|换一个需求|换个)/;

export function isNewTopic(message: string): boolean {
  const m = message.trim();
  return NEW_TOPIC_RE.test(m) && m.length <= 14;
}

/** 从 LLM 响应文本里稳健提取 JSON 对象（兼容 ```json 围栏与前后杂质） */
function extractJson(text: string): Record<string, unknown> | null {
  let t = text.trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) t = fenced[1].trim();
  // 优先取第一个 { ... } 完整括号块
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      /* fallthrough */
    }
  }
  try {
    return JSON.parse(t) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function clampClarity(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(3, Math.round(n)));
}

async function llmInvoke(
  system: string,
  user: string,
  model: string,
  temperature: number,
  forwardingHeaders: Record<string, string> | undefined,
): Promise<string> {
  const client = new LLMClient(new Config(), forwardingHeaders);
  let lastError: unknown;
  for (let attempt = 0; attempt <= LLM_CONFIG.retries; attempt++) {
    try {
      const resp = await client.invoke(
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        {
          model,
          temperature,
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

/** 调用1：需求清晰度判断（每轮都执行，要求快） */
export async function judge(
  context: string,
  headers: Headers,
): Promise<Judgement> {
  const built = await llmInvoke(
    JUDGE_SYSTEM,
    `以下是根据多轮对话整理的用户需求上下文：\n${context}\n\n请判断需求清晰度。`,
    LLM_CONFIG.judgeModel,
    0.2,
    HeaderUtils.extractForwardHeaders(headers),
  );
  const parsed = extractJson(built);
  if (!parsed) {
    throw new Error('需求判断结果无法解析为 JSON');
  }
  const clarity = clampClarity(parsed.clarity);
  const nextQuestion =
    clarity <= 1
      ? (typeof parsed.next_question === 'string' ? parsed.next_question : '').trim() ||
        '能再多聊聊你想要的东西吗？比如给谁用、解决什么问题？'
      : '';
  return {
    clarity,
    category:
      typeof parsed.category === 'string' ? parsed.category : '其他',
    clarity_desc:
      typeof parsed.clarity_desc === 'string' ? parsed.clarity_desc : '',
    next_question: nextQuestion,
  };
}

/** 调用2：清晰度≥2 时生成完整拆解报告（Markdown） */
export async function decomposeReport(
  context: string,
  headers: Headers,
): Promise<{ report: string; category: string }> {
  const report = await llmInvoke(
    DECOMPOSE_SYSTEM,
    `请根据以下对话历史中的用户需求生成拆解报告：\n${context}`,
    LLM_CONFIG.reportModel,
    0.7,
    HeaderUtils.extractForwardHeaders(headers),
  );
  return { report: report.trim(), category: '其他' };
}