import { LLM_CONFIG } from './config';
import { chatStream, chatText } from './llmProvider';
import { buildKBContext, redSeaHitOnText, plagiarismHint, matchEvidence } from './knowledge';
import { sceneSupplement } from './scenePrompts';

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
  "next_question": "clarity≤1时给出追问，评委口吻，2-3句话，无emoji不列点；clarity≥2时输出空字符串",
  "options": [{"label":"可作为回答直接发送的选项名","hint":"补充说明"}]
}
关于 next_question（一次一问，严格执行）：
- 每轮只允许问「一个」问题，只围绕 missing_info 中最关键的一条展开；
- 禁止一轮里同时问多个问题：不得出现「另外」「还有」「顺便」等并列追问，也不得连续出现两个问号；
- 其余缺失信息不要在这轮提出，留到后续轮次根据用户最新回答逐个追问；
- 用户回答本轮问题后，下一轮再问下一条最关键的缺失信息，直到 clarity≥2。
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

## 一、需求档案
- 真实需求：一句话说清
- 核心动机：用户背后的真正目的
- 隐含约束：用户没说但很关键的限定条件（对话历史中的澄清问答也要逐条写入）

## 二、五阶段论证
按 需求诊断 / 创新性论证 / 科学性与可行性 / 应用价值与红海风险 / 评委质询 分小节；每个小节 2-3 条要点，先判断后理由，小节末尾一句加粗「阶段结论：」。

## 三、正反交锋
2-3 组争议点，每组格式：「**正方**：… / **反方**：… / **裁决**：…」；被推翻的结论用删除线标注后给出转向结论。

## 四、需求地图
树状层级清单：核心需求 → 子需求（≥3个）→ 行动任务（每条标注负责角色与建议时间）。

## 五、行动清单
按优先级【高/中/低】排序，至少 4 条，每条单独一行，格式：
- 【高】任务名 | 建议角色：… | 时间：… | 验收标准：可量化 | 依赖：…
必须包含：优先级、任务名、建议角色、时间、可量化的验收标准、依赖项，缺一不可。

## 六、风险与预案
至少 3 条，每条格式：「**风险**：… → **应对**：…」降级方案要具体到可执行动作。

## 继续推进
A. 帮我把第一步做出来
B. 帮我评估时间和成本
C. 我想调整一下方向

要求 ：根据场景用对应领域的专业知识拆解（科创赛要懂三自/三性原则与能力边界；抖音要懂流量、选题、发布节奏；学习要懂方法论），全文无emoji。直接输出报告正文，不要输出任何 JSON 或代码块。`.trimStart();

const CHECKLIST_SYSTEM = `你是科创项目评审记录员。根据给定的用户需求上下文与拆解报告，逐项评估以下 14 个检查项，输出严格 JSON，不要任何其他文字：
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
  "source_tags": ["实际命中的依据标签，只取自：规则·三自原则 / 规则·三性原则 / 查重·往届案例 / 边界·高风险区"]
}
要求：checklist 的 14 个 item 必须与上述顺序完全一致、不得增删；status 只能取 pass/warn/fail；note 为一句话中文说明，fail/warn 项必须指出具体问题。`.trimStart();

export interface ChecklistItem {
  item: string;
  status: 'pass' | 'warn' | 'fail';
  note: string;
}

export interface DecomposeResult {
  report: string;
  category: string;
  checklist: ChecklistItem[];
  source_tags: string[];
  plagiarism?: {
    caseName: string;
    domain: string;
    result: string;
    redSea: string;
    differentiation: string;
  } | null;
  evidence?: { ref: string; label: string; kind: 'rule' | 'case' | 'boundary'; text: string }[];
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
export function extractJson(text: string): Record<string, unknown> | null {
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

function buildExpertBlock(scene?: string, category?: string): string {
  if (!isScienceFair(scene, category)) return '';
  return `\n${SCIENCE_FAIR_EXPERT}\n${buildKBContext(scene, category)}`;
}

async function llmInvoke(
  system: string,
  user: string,
  model: string,
  temperature: number,
  headers?: Headers,
  maxTokens?: number,
): Promise<string> {
  return chatText(system, user, {
    model,
    temperature,
    headers,
    timeoutMs: LLM_CONFIG.timeoutMs,
    maxTokens,
    mode: 'quick',
  });
}

/** 调用1：需求清晰度判断（每轮都执行；scene 为前端预选场景弱提示） */
export async function judge(
  context: string,
  headers: Headers,
  scene?: string,
): Promise<Judgement> {
  const expert = buildExpertBlock(scene);
  const sceneHint = scene && scene !== '智能识别' ? `\n用户预选场景：${scene}` : '';
  const sceneSup = sceneSupplement(scene);
  let lastError: unknown = new Error('需求判断结果无法解析为 JSON');
  for (let attempt = 0; attempt <= 1; attempt++) {
    const built = await llmInvoke(
      JUDGE_SYSTEM + expert + sceneSup,
      `以下是根据多轮对话整理的用户需求上下文：\n${context}${sceneHint}\n\n请判断需求清晰度。`,
      LLM_CONFIG.judgeModel,
      0.7,
      headers,
      2000,
    );
    const parsed = extractJson(built);
    if (!parsed) {
      lastError = new Error('需求判断结果无法解析为 JSON');
      continue;
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
  throw lastError;
}

/** 调用2：清晰度≥2 时生成完整拆解报告（结构化 = 报告 + 14 项检查清单 + 依据标签） */
export async function decomposeReport(
  context: string,
  headers: Headers,
  category?: string,
  scene?: string,
): Promise<DecomposeResult> {
  const expert = buildExpertBlock(undefined, category);
  const report = await llmInvoke(
    DECOMPOSE_SYSTEM + expert + sceneSupplement(scene),
    `请根据以下对话历史中的用户需求生成拆解报告：\n${context}`,
    LLM_CONFIG.reportModel,
    0.7,
    headers,
    2000,
  );
  const rv = await reviewChecklist(context, report, headers);
  return {
    report,
    category: category || '其他',
    checklist: rv.checklist,
    source_tags: rv.source_tags,
    plagiarism: plagiarismHint(context),
    evidence: matchEvidence(context),
  };
}

/**
 * 独立的检查清单生成：以报告全文为输入做一次廉价 JSON 调用，
 * 不再依赖报告模型「正文后附 JSON」的格式自觉。解析失败时回退 14 项待复核默认值。
 */
export async function reviewChecklist(
  context: string,
  report: string,
  headers: Headers,
): Promise<{ checklist: ChecklistItem[]; source_tags: string[] }> {
  for (let attempt = 0; attempt <= 1; attempt++) {
    try {
      const built = await chatText(
        CHECKLIST_SYSTEM,
        `【用户需求上下文】\n${context}\n\n【拆解报告全文】\n${report}`,
        {
          model: LLM_CONFIG.judgeModel,
          temperature: 0.2,
          headers,
          timeoutMs: LLM_CONFIG.timeoutMs,
          maxTokens: 1200,
          mode: 'quick',
        },
      );
      const parsed = extractJson(built);
      if (parsed) {
        const checklist = parseChecklist(parsed.checklist);
        const source_tags = parseSourceTags(parsed.source_tags);
        if (checklist.length >= 10) {
          return { checklist: padChecklist(checklist), source_tags };
        }
      }
    } catch {
      /* 重试或兜底 */
    }
  }
  return { checklist: padChecklist([]), source_tags: [] };
}

/** 补齐缺失项，保证前端核查表恒为 14 行 */
function padChecklist(checklist: ChecklistItem[]): ChecklistItem[] {
  const byItem = new Map(checklist.map((c) => [c.item, c]));
  return CHECKLIST_ITEMS.map(
    (item) => byItem.get(item) ?? { item, status: 'warn' as const, note: '未生成评估，请人工复核' },
  );
}

/**
 * 流式版本：逐 token 输出完整拆解报告正文，末尾以 `{ kind:'__final', full }` 交付全文。
 */
export async function* streamReport(
  context: string,
  headers: Headers,
  category?: string,
  scene?: string,
): AsyncGenerator<string | { kind: '__final'; full: string }> {
  const expert = buildExpertBlock(undefined, category);
  let acc = '';
  for await (const chunk of chatStream(
    DECOMPOSE_SYSTEM + expert + sceneSupplement(scene),
    `请根据以下对话历史中的用户需求生成拆解报告：\n${context}`,
    {
      model: LLM_CONFIG.reportModel,
      temperature: 0.7,
      headers,
      timeoutMs: LLM_CONFIG.deepseek.timeoutMs,
      maxTokens: 2000,
      mode: 'quick',
    },
  )) {
    if (chunk.content) {
      acc += chunk.content;
      yield chunk.content;
    }
  }
  yield { kind: '__final' as const, full: acc };
}