import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { LLM_CONFIG } from './config';

/**
 * 需求拆解引擎：完全由 LLM 完成需求清晰度判断与完整拆解。
 * 不依赖任何工作流 API。多轮上下文由后端维护，每次调用前拼成
 * 「第1轮：[..] 第2轮：[..]」的形式传入。
 */

const JUDGE_SYSTEM = `你是一个严格的评委，用评委视角审视用户的需求想法，判断其清晰程度。不要顺着用户夸，想法空泛要直接指出来，比如「太宽泛，需要聚焦」。

清晰度评分标准（0-3）：
- 0：只有一个模糊方向，如"我想做抖音"，缺少领域、目标、受众等关键信息
- 1：有大致方向但缺关键要素，如知道做什么但不知道目标受众
- 2：基本清楚做什么、给谁、目标是什么，但缺少执行细节
- 3：目标、受众、形式、约束条件都明确，可直接执行

判断原则：从严判断，大多数人处于0或1，不要轻易给2或3。结合多轮对话历史综合判断，用户补充的信息要累计考虑。

识别需求所属场景：科创赛诊断/视频创作/文章写作/创业项目/学习提升/活动策划/其他。

输出严格JSON格式，不要任何其他文字：
{
  "clarity": 0-3的数字,
  "category": "场景分类",
  "clarity_desc": "哪些已经明确，哪些还不明确",
  "missing_info": ["缺失的关键信息1", "缺失的关键信息2"],
  "next_question": "clarity≤1时给出最关键的、唯一的一个追问，朋友聊天语气，2-3句话，无emoji不列点；clarity≥2时输出空字符串",
  "options": [{"label":"可作为回答直接发送的选项名","hint":"补充说明"}]
}
关于 options：仅当 clarity≤1 时生成 2-4 个可点选项，让用户一点即可补充最关键信息（如问投入时间则给出 [0-2小时][2-10小时][10小时以上]）；label 是可直接发送的简短选项，hint 给出补充说明；clarity≥2 时 options 输出空数组。
`;

/** 科创赛诊断场景追加的专家设定（判断与拆解共用） */
const SCIENCE_FAIR_EXPERT = `
【科创赛诊断专家设定】
你是青少年科创大赛的资深评委。评审三原则：三自原则（自己选题、自己设计研究、自己撰写）；三性原则（科学性、创新性、实用性）。
你的职责是帮参赛者把项目想法诊断到位：查真实性、查创新点是否站得住、查工作量是否超出中学生可行范围、查是否撞车红海项目。
判断与拆解时请结合以上专家视角，直接指出项目在评审维度上的硬伤与改进方向。
`;

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
列出2-3个最可能踩的坑，每一条先写「可能踩坑：」再写「降级方案：」给出具体规避方法

## 行动清单
按优先级【高/中/低】排序，每条单独一行，格式：
- 【高】任务名（耗时：2小时）验收标准：可量化的完成标准 依赖项：前置条件
必须包含：优先级、任务名、耗时、可量化的验收标准、依赖项，缺一不可；3-6 条。

要求：根据场景用对应领域的专业知识拆解（科创赛要懂三自/三性原则；抖音要懂流量、选题、发布节奏；学习要懂方法论），全文无emoji，直接输出报告内容。`;

export interface DiagnosticOption {
  label: string;
  hint: string;
}

export interface Judgement {
  clarity: number;
  category: string;
  clarity_desc: string;
  missing_info: string[];
  next_question: string;
  options: DiagnosticOption[];
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  meta?: { type?: 'question' | 'solution'; category?: string };
}

const SCIENCE_FAIR = '科创赛诊断';

function isScienceFair(scene?: string, category?: string): boolean {
  return scene === SCIENCE_FAIR || category === SCIENCE_FAIR;
}

/** 每轮仅拼接用户消息；assistant 追问/报告不进入工作因子（贴合"N轮=[第N个用户输入]"约定） */
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

function parseOptions(v: unknown): DiagnosticOption[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
    .map((o) => ({
      label: typeof o.label === 'string' ? o.label.trim() : '',
      hint: typeof o.hint === 'string' ? o.hint.trim() : '',
    }))
    .filter((o) => o.label.length > 0)
    .slice(0, 4);
}

function parseStringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter((x) => x.length > 0)
    .slice(0, 6);
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

/** 调用1：需求清晰度判断（每轮都执行，要求快；scene 为前端预选场景弱提示） */
export async function judge(
  context: string,
  headers: Headers,
  scene?: string,
): Promise<Judgement> {
  const expert = isScienceFair(scene) ? `\n${SCIENCE_FAIR_EXPERT}` : '';
  const sceneHint = scene && scene !== '智能识别' ? `\n用户预选场景：${scene}` : '';
  const built = await llmInvoke(
    JUDGE_SYSTEM + expert,
    `以下是根据多轮对话整理的用户需求上下文：\n${context}${sceneHint}\n\n请判断需求清晰度。`,
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
    category: typeof parsed.category === 'string' ? parsed.category : '其他',
    clarity_desc: typeof parsed.clarity_desc === 'string' ? parsed.clarity_desc : '',
    missing_info: parseStringList(parsed.missing_info),
    next_question: nextQuestion,
    options: clarity <= 1 ? parseOptions(parsed.options) : [],
  };
}

/** 调用2：清晰度≥2 时生成完整拆解报告（Markdown；category 判定科创赛时追加评委设定） */
export async function decomposeReport(
  context: string,
  headers: Headers,
  category?: string,
): Promise<{ report: string; category: string }> {
  const expert = isScienceFair(undefined, category) ? `\n${SCIENCE_FAIR_EXPERT}` : '';
  const report = await llmInvoke(
    DECOMPOSE_SYSTEM + expert,
    `请根据以下对话历史中的用户需求生成拆解报告：\n${context}`,
    LLM_CONFIG.reportModel,
    0.7,
    HeaderUtils.extractForwardHeaders(headers),
  );
  return { report: report.trim(), category: category || '其他' };
}