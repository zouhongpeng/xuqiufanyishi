import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { LLM_CONFIG } from './config';
import { buildKBContext, redSeaHitOnText } from './knowledge';

/**
 * 需求拆解引擎：完全由 LLM 完成需求清晰度判断与完整拆解。
 * 多轮上下文由后端维护，每次调用前拼成「第1轮：[..] 第2轮：[..]」传入。
 */

/** 评审检查清单 14 项（固定顺序，供报告核查表渲染） */
export const CHECKLIST_ITEMS = [
  '自主选题核查',
  '创新性论证',
  '科学性校验',
  '查重比对',
  '能力边界校验',
  '工作量规划',
  '技术路线核查',
  '时间线合理性',
  '资源匹配',
  '风险预案',
  '差异化空间',
  '展示逻辑',
  '答辩风险',
  '迭代空间',
] as const;

const JUDGE_SYSTEM = `你是一个严格的评委，用评委视角审视用户的需求想法，判断其清晰程度。不要顺着用户夸，想法空泛要直接指出来，比如「太宽泛，需要聚焦」。

清晰度评分标准（0-3）：
- 0：只有一个模糊方向，如"我想做抖音"，缺少领域、目标、受众等关键信息
- 1：有大致方向但缺关键要素，如知道做什么但不知道目标受众
- 2：基本清楚做什么、给谁、目标是什么，但缺少执行细节
- 3：目标、受众、形式、约束条件都明确，可直接执行

判断原则：从严判断，大多数人处于0或1，不要轻易给2或3。结合多轮对话历史综合判断，用户补充的信息要累计考虑。

识别需求所属场景：科创赛诊断/视频创作/写作/创业/学习/活动/其他。
当场景为科创赛诊断时，要额外核查想法是否命中往届红海案例关键词（如垃圾分类、人脸识别门禁、浇花装置、失物招领等），若命中则在 missing_info 中标注「该方向已高度饱和，需差异化」。

输出严格JSON格式，不要任何其他文字：
{
  "clarity": 0-3的数字,
  "category": "场景分类",
  "clarity_desc": "哪些已经明确，哪些还不明确",
  "missing_info": ["缺失的关键信息1", "缺失的关键信息2"],
  "next_question": "clarity≤1时给出最关键的、唯一的一个追问，评委口吻，2-3句话，无emoji不列点；clarity≥2时输出空字符串",
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

const DECOMPOSE_SYSTEM = `你是一个资深的需求拆解专家与科创赛评审，擅长把模糊想法变成可执行的整改行动方案。

根据完整对话历史中的用户需求，生成拆解报告，Markdown格式：

# 需求拆解报告

## 需求理解
- 真实需求：一句话说清
- 核心动机：用户背后的真正目的
- 隐含约束：用户没说但很关键的限定条件

## 拆解方案
分3-5个模块，每个模块包含具体可落地的执行细节（具体到工具、数字、步骤、时间点，拒绝空话套话）

## 风险预警与降级方案
列出2-3个最可能踩的坑，每一条先写「可能踩坑：」再写「降级方案：」给出具体规避方法

## 整改行动方案
按优先级【高/中/低】排序，每条单独一行，格式：
- 【高】任务名（耗时：2小时）验收标准：可量化的完成标准 依赖项：前置条件
必须包含：优先级、任务名、耗时、可量化的验收标准、依赖项，缺一不可；3-6 条。

## 继续推进
A. 帮我把第一步做出来
B. 帮我评估时间和成本
C. 我想调整一下方向

要求 ：根据场景用对应领域的专业知识拆解（科创赛要懂三自/三性原则与能力边界；抖音要懂流量、选题、发布节奏；学习要懂方法论），全文无emoji。

在你的 Markdown 报告正文之后，另起一行输出固定分隔行：
---REVIEW_JSON---
然后紧接输出一个 JSON 对象（不要其他任何文字，注意字符串别含换行）：
{
  "checklist": [
    {"item":"自主选题核查","status":"pass|warn|fail","note":"一句话说明"},
    {"item":"创新性论证","status":"pass|warn|fail","note":"一句话说明"},
    {"item":"科学性校验","status":"pass|warn|fail","note":"一句话说明"},
    {"item":"查重比对","status":"pass|warn|fail","note":"一句话说明"},
    {"item":"能力边界校验","status":"pass|warn|fail","note":"一句话说明"},
    {"item":"工作量规划","status":"pass|warn|fail","note":"一句话说明"},
    {"item":"技术路线核查","status":"pass|warn|fail","note":"一句话说明"},
    {"item":"时间线合理性","status":"pass|warn|fail","note":"一句话说明"},
    {"item":"资源匹配","status":"pass|warn|fail","note":"一句话说明"},
    {"item":"风险预案","status":"pass|warn|fail","note":"一句话说明"},
    {"item":"差异化空间","status":"pass|warn|fail","note":"一句话说明"},
    {"item":"展示逻辑","status":"pass|warn|fail","note":"一句话说明"},
    {"item":"答辩风险","status":"pass|warn|fail","note":"一句话说明"},
    {"item":"迭代空间","status":"pass|warn|fail","note":"一句话说明"}
  ],
  "source_tags": ["规则·三自原则", "查重·往届案例", "边界·高风险区"]
}
其中的判断要引用依据来源标签（source_tags 只取实际命中的：规则三自/三性·、查重·往届案例、边界·高风险区）。
checklist 的 14 个 item 必须与上面顺序一一对应，不得增删。`.trimStart();

const DELIMITER = '---REVIEW_JSON---';

interface ChecklistItem {
  item: string;
  status: 'pass' | 'warn' | 'fail';
  note: string;
}

export interface DecomposeResult {
  report: string;
  category: string;
  checklist: ChecklistItem[];
  source_tags: string[];
}

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

const SCIENCE_FAIR = '科创赛诊断';

export function isScienceFair(scene?: string, category?: string): boolean {
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

/** 从文本中提取 JSON（兼容围栏与前后杂质） */
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

function parseChecklist(v: unknown): ChecklistItem[] {
  if (!Array.isArray(v)) return [];
  const statuses = new Set(['pass', 'warn', 'fail']);
  const seen = new Set<string>();
  const out: ChecklistItem[] = [];
  for (const it of v) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    const item = typeof o.item === 'string' ? o.item.trim() : '';
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push({
      item,
      status: statuses.has(String(o.status)) ? (o.status as ChecklistItem['status']) : 'warn',
      note: typeof o.note === 'string' ? o.note.trim() : '',
    });
  }
  return out;
}

function parseSourceTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter((x) => x.length > 0)
    .slice(0, 8);
}

/** 把「报告正文 + 分隔行 + JSON」拆成人能读的报告与结构化数据 */
export function splitReviewOutput(full: string): { report: string; checklist: ChecklistItem[]; source_tags: string[] } {
  const idx = full.indexOf(DELIMITER);
  if (idx < 0) {
    return { report: full.trim(), checklist: [], source_tags: [] };
  }
  const report = full.slice(0, idx).trim();
  const jtext = full.slice(idx + DELIMITER.length).trim();
  const parsed = extractJson(jtext);
  return {
    report,
    checklist: parsed ? parseChecklist(parsed.checklist) : [],
    source_tags: parsed ? parseSourceTags(parsed.source_tags) : [],
  };
}

function buildExpertBlock(scene?: string, category?: string): string {
  if (!isScienceFair(scene, category)) return '';
  return `\n${SCIENCE_FAIR_EXPERT}\n${buildKBContext(scene, category)}`;
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

/** 调用1：需求清晰度判断（每轮都执行；scene 为前端预选场景弱提示） */
export async function judge(
  context: string,
  headers: Headers,
  scene?: string,
): Promise<Judgement> {
  const expert = buildExpertBlock(scene);
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
  const missing_info = parseStringList(parsed.missing_info);
  let clarity_desc = typeof parsed.clarity_desc === 'string' ? parsed.clarity_desc : '';
  if (isScienceFair(scene)) {
    const red = redSeaHitOnText(context);
    if (red && !missing_info.includes(red)) {
      missing_info.unshift(red);
      if (clarity_desc && !clarity_desc.includes('红海')) clarity_desc += ` ${red}`;
    }
  }
  const nextQuestion =
    clarity <= 1
      ? (typeof parsed.next_question === 'string' ? parsed.next_question : '').trim() ||
        '能再多聊聊你想要的东西吗？比如给谁用、解决什么问题？'
      : '';
  return {
    clarity,
    category: typeof parsed.category === 'string' ? parsed.category : '其他',
    clarity_desc,
    missing_info,
    next_question: nextQuestion,
    options: clarity <= 1 ? parseOptions(parsed.options) : [],
  };
}

/** 调用2：清晰度≥2 时生成完整拆解报告（结构化 = 报告 + 14 项检查清单 + 依据标签） */
export async function decomposeReport(
  context: string,
  headers: Headers,
  category?: string,
): Promise<DecomposeResult> {
  const expert = buildExpertBlock(undefined, category);
  const full = await llmInvoke(
    DECOMPOSE_SYSTEM + expert,
    `请根据以下对话历史中的用户需求生成拆解报告：\n${context}`,
    LLM_CONFIG.reportModel,
    0.7,
    HeaderUtils.extractForwardHeaders(headers),
  );
  const { report, checklist, source_tags } = splitReviewOutput(full);
  return { report, category: category || '其他', checklist, source_tags };
}

/**
 * 流式版本：逐 token 输出拆解报告正文，最后 yield 一个 `{ kind:'__final', full }`
 * 控制对象携带完整原文（含 ---REVIEW_JSON--- 后的 JSON），供路由解析检查清单。
 */
export async function* streamReport(
  context: string,
  headers: Headers,
  category?: string,
): AsyncGenerator<string | { kind: '__final'; full: string }> {
  const expert = buildExpertBlock(undefined, category);
  const client = new LLMClient(
    new Config(),
    HeaderUtils.extractForwardHeaders(headers),
  );
  const messages = [
    { role: 'system' as const, content: DECOMPOSE_SYSTEM + expert },
    { role: 'user' as const, content: `请根据以下对话历史中的用户需求生成拆解报告：\n${context}` },
  ];
  let acc = '';
  let delivered = 0;
  for await (const chunk of client.stream(
    messages,
    { model: LLM_CONFIG.reportModel, temperature: 0.7, thinking: 'disabled', caching: 'disabled' },
  )) {
    const text = chunk.content ? chunk.content.toString() : '';
    if (!text) continue;
    acc += text;
    const idx = acc.indexOf(DELIMITER);
    const boundary = idx >= 0 ? idx : acc.length;
    if (boundary > delivered) {
      yield acc.slice(delivered, boundary);
      delivered = boundary;
    }
    if (idx >= 0) break;
  }
  yield { kind: '__final' as const, full: acc };
}