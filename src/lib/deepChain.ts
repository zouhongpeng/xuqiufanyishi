import { LLM_CONFIG } from './config';
import { chatStream, chatText, type StreamDelta } from './llmProvider';
import {
  judge,
  reviewChecklist,
  extractJson,
  isScienceFair,
  type Judgement,
  type ChecklistItem,
} from './decomposer';
import { buildKBContext, findRedSeaCase, plagiarismHint, matchEvidence } from './knowledge';
import { sceneSupplement } from './scenePrompts';

/**
 * 深度论证五阶段链（DeepSeek 直连）：
 * 需求诊断(chat) → 多视角论证(reasoner × 3 并行) → 评委质询(reasoner) → 报告整合(chat 流式) → 检查清单(chat 轻量)。
 * 扣子工作流 API 保留为降级通道（见 /api/chat streamDeep 的 fallback）。
 */

export interface DeepChainPhase {
  id: string;
  name: string;
  detail: string;
}

export const DEEP_PHASES: DeepChainPhase[] = [
  { id: 'diagnosis', name: '需求诊断', detail: '评估清晰度、识别场景、列出缺失关键信息' },
  { id: 'argument', name: '多视角论证', detail: '创新性 / 科学性与可行性 / 应用价值与红海风险 三路并行' },
  { id: 'grill', name: '评委质询', detail: '评委视角质询能力边界、工作量真实性与答辩风险' },
  { id: 'report', name: '报告整合', detail: '整合诊断、论证与质询，生成结构化报告' },
  { id: 'checklist', name: '检查清单', detail: '生成 14 项评审检查清单' },
];

export type DeepChainEvent =
  | { type: 'phase_start'; phase_id: string; phase_name: string; detail: string }
  | { type: 'phase_end'; phase_id: string; phase_name: string; elapsed_ms: number }
  | { type: 'reasoning_delta'; view?: string; view_name?: string; text: string }
  | { type: 'content_delta'; text: string }
  | { type: 'result'; result: DeepChainResult }
  | { type: 'done' };

export interface ClarifyQuestion {
  q: string;
  hint: string;
}

export interface NeedTreeNode {
  label: string;
  basis: string;
  children?: NeedTreeNode[];
}

export interface StructuredReport {
  summary: string;
  archive?: Record<string, string>;
  stages: { name: string; summary: string; points: string[]; conclusion: string }[];
  debate: { topic: string; pro: string; con: string; resolved: string }[];
  tree: NeedTreeNode;
  actions: { task: string; priority: string; role: string; time: string }[];
  risks: { risk: string; response: string }[];
  card: { title: string; conclusion: string; date: string };
}

export interface DeepChainResult {
  type: 'question' | 'solution' | 'clarify';
  mode: 'deep';
  clarity: number;
  category: string;
  clarity_desc: string;
  missing_info?: string[];
  options?: { label: string; hint: string }[];
  content: string;
  round: number;
  checklist?: ChecklistItem[];
  source_tags?: string[];
  plagiarism?: unknown;
  evidence?: unknown;
  clarifications?: ClarifyQuestion[];
  structured?: StructuredReport | null;
}

type Emit = (ev: DeepChainEvent) => void;

interface ViewResult {
  id: string;
  name: string;
  content: string;
}

const VIEW_DEFS = [
  {
    id: 'A',
    name: '创新性论证',
    focus:
      '1. 查重比对：对照往届案例判断该想法是否与往届项目高度相似（红海/同质化）；\n2. 论证新颖点：指出真正有新意的地方（或直接指出没有）；\n3. 给出差异化空间与具体的差异化建议。',
  },
  {
    id: 'B',
    name: '科学性与可行性校验',
    focus:
      '1. 技术路线是否成立、逻辑是否自洽；\n2. 工作量是否超出中学生可行范围；\n3. 资源、工具、能力是否与作者匹配（对照能力边界，高风险项要给替代方案）。',
  },
  {
    id: 'C',
    name: '应用价值与红海风险',
    focus:
      '1. 应用价值与目标受众的真实收益；\n2. 同质化风险与往届雷区警示；\n3. 若方向已高度饱和，给出可转向的相邻方向。',
  },
] as const;

const VIEW_SYSTEM_TMPL = `你是青少年科创大赛评审团成员，负责【{NAME}】。基于用户需求上下文独立完成以下论证：
{FOCUS}
要求：输出 3-6 条结论，每条一行、先给判断再给理由，具体不空话，无emoji。`;

const GRILL_SYSTEM = `你是青少年科创大赛主评委，评审团已完成多视角论证。现在你对论证结论与项目本身进行质询，重点：
1. 是否超出中学生能力边界（三自原则：自己选题、自己设计、自己撰写）；
2. 工作量是否真实可行，有没有夸大或低估；
3. 答辩中最可能被追问的风险点；
4. 还需要补充哪些数据与证据才有说服力。
要求：输出质询要点 4-6 条，每条一行，犀利直接、直指要害，无emoji。`;

const REPORT_SYSTEM = `你是一个资深的需求拆解专家与科创赛评审。评审团已完成需求诊断、三视角论证与评委质询，请整合全部材料生成最终拆解报告。Markdown 格式，六大板块标题固定、顺序不可调换：

# 需求拆解报告

## 一、需求档案
包含：真实需求（一句话）、核心动机、隐含约束、目标用户与使用场景、成功标准；若用户上下文中包含澄清问答（第N轮的补充回答），必须逐条写入本板块（格式「- 澄清问答：问：… 答：…」）。

## 二、五阶段论证
按 需求诊断 → 创新性论证 → 科学性与可行性 → 应用价值与红海风险 → 评委质询 的小节展开；每个小节至少 3 条要点（每条一行，先判断后理由），小节末尾给出一句加粗的「阶段结论：」。

## 三、正反交锋
列出 3-4 组争议点，每组格式：
- **正方**：支持该做法的理由（吸收论证中的正面结论）
- **反方**：质疑该做法的理由（吸收质询中的质疑）
- **裁决**：评审团最终采纳的结论；若反方理由成立导致某方案被推翻，明确写「~~被推翻的原结论~~ → 转向结论」

## 四、需求地图
按层级输出树状清单（用缩进列表表达层级）：
- 核心需求：一句话
  - 子需求 1：…（依赖：…）
    - 行动任务：…（负责角色：…、建议时间：…）
  - 子需求 2：…
至少覆盖 3 个子需求、每条子需求下 1-2 个行动任务。

## 五、行动清单
按优先级排序，至少 5 条，每条单独一行，格式：
- 【高】任务名 | 建议角色：… | 时间：… | 验收标准：可量化 | 依赖：…
必须包含：优先级、任务名、建议角色、时间、可量化的验收标准、依赖项，缺一不可。

## 六、风险与预案
至少 3 条，每条格式：
- **风险**：… → **应对**：…（降级方案要具体到可执行动作）

## 继续推进
A. 帮我把第一步做出来
B. 帮我评估时间和成本
C. 我想调整一下方向

硬性要求：全文不少于 2500 字；每条要点必须具体可执行（具体到工具、数字、步骤、时间点），禁止空话注水；吸收论证结论与质询要点的判断；全文无 emoji；直接输出报告正文，不要输出任何 JSON 或代码块。`;

const CLARIFY_SYSTEM = `你是需求拆解师的首席评审。用户提交了一个新需求，在启动五阶段深度论证之前，你需要先提出关键澄清问题（先问后拆）。
严格输出 JSON（不要输出其他文字）：
{"clarity":0,"category":"场景分类","clarity_desc":"一句话","clarifications":[{"q":"澄清问题","hint":"为什么问这个 / 期望什么样的回答"}]}
要求：
- 提 1-3 个最关键的澄清问题，优先覆盖：目标用户、使用场景、成功标准；
- 每个问题具体、用户可直接用一两句话回答，拒绝开放式空问；
- clarity_desc 一句话点评当前需求的清晰程度；全文无 emoji。`;

/** 先问后拆：生成 1-3 个关键澄清问题（JSON 失败时给默认三问兜底） */
async function clarifyQuestions(
  context: string,
  headers: Headers,
  scene: string | undefined,
): Promise<{ clarity: number; category: string; clarity_desc: string; clarifications: ClarifyQuestion[] }> {
  const fallback = {
    clarity: 0,
    category: '待澄清',
    clarity_desc: '需要先补充关键信息再启动深度论证',
    clarifications: [
      { q: '这个需求的目标用户是谁？', hint: '例如：中学生 / 大学生 / 教师评委，越具体越好' },
      { q: '它会在什么场景下被使用？', hint: '例如：课堂上 / 比赛答辩 / 日常自学' },
      { q: '怎样算做成了？给出你的成功标准', hint: '例如：获得校级奖 / 50 个真实用户使用' },
    ],
  };
  try {
    const raw = await chatText(CLARIFY_SYSTEM + expertBlock(scene), context, {
      model: LLM_CONFIG.judgeModel,
      temperature: 0.4,
      headers,
      timeoutMs: LLM_CONFIG.timeoutMs,
      maxTokens: 700,
      mode: 'deep',
    });
    const parsed = extractJson(raw) as {
      clarity?: number;
      category?: string;
      clarity_desc?: string;
      clarifications?: { q?: string; hint?: string }[];
    };
    const list = (parsed.clarifications ?? [])
      .filter((c) => c && typeof c.q === 'string' && c.q.trim())
      .slice(0, 3)
      .map((c) => ({ q: c.q!.trim(), hint: (c.hint ?? '').trim() }));
    if (!list.length) return fallback;
    return {
      clarity: typeof parsed.clarity === 'number' ? parsed.clarity : 0,
      category: parsed.category || '待澄清',
      clarity_desc: parsed.clarity_desc || fallback.clarity_desc,
      clarifications: list,
    };
  } catch {
    return fallback;
  }
}

/** 阶段5结构化产物：从报告与上下文抽取需求地图/正反交锋/拆解卡；解析失败返回 null（前端降级纯文本） */
async function buildStructured(
  context: string,
  report: string,
  headers: Headers,
  scene: string | undefined,
): Promise<StructuredReport | null> {
  const system = `你是结构化引擎。基于给定的需求拆解报告与用户上下文，抽取以下信息并严格输出 JSON（不要输出任何其他文字）：
{"summary":"核心结论一句话(40字内)","stages":[{"name":"需求诊断|创新性论证|科学性与可行性|应用价值与红海风险|评委质询","summary":"一句话","points":["要点1","要点2","要点3"],"conclusion":"阶段结论一句话"}],"debate":[{"topic":"争议点","pro":"正方理由","con":"反方理由","resolved":"评审团最终裁决"}],"tree":{"label":"核心需求","basis":"依据一句话","children":[{"label":"子需求","basis":"依据","children":[{"label":"行动任务","basis":"依据"}]}]},"actions":[{"task":"任务","priority":"高|中|低","role":"建议角色","time":"建议时间"}],"risks":[{"risk":"风险","response":"应对措施"}],"card":{"title":"需求标题(20字内)","conclusion":"核心结论(60字内)","date":"YYYY-MM-DD"}}
要求：stages 覆盖五阶段且 points 每阶段至少 3 条；debate 3-4 组；tree 至少 3 个子需求；actions 至少 5 条；risks 至少 3 条；全部内容从报告与上下文中提炼，不得编造。`;
  try {
    const sceneNote = scene ? `\n（用户期望聚焦场景：${scene}，抽取时保持该场景侧重）` : '';
    const raw = await chatText(system, `【用户需求上下文】\n${context}${sceneNote}\n\n【拆解报告全文】\n${report}`, {
      model: LLM_CONFIG.judgeModel,
      temperature: 0.3,
      headers,
      timeoutMs: LLM_CONFIG.deepseek.timeoutMs,
      maxTokens: 3500,
      mode: 'deep',
    });
    const parsed = extractJson(raw) as unknown as StructuredReport;
    if (!parsed || !parsed.tree || !Array.isArray(parsed.stages)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function nextWithTimeout(
  it: AsyncIterator<StreamDelta>,
  ms: number,
): Promise<IteratorResult<StreamDelta>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      it.next(),
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error(`模型 ${Math.round(ms / 1000)} 秒无响应`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface Collected {
  reasoning: string;
  content: string;
}

/** 流式收集：onDelta 推送 reasoning 增量；idleMs 内无任何增量则视为失败（降级链入口） */
async function streamCollect(
  system: string,
  user: string,
  model: string,
  headers: Headers,
  onDelta: ((text: string) => void) | undefined,
  idleMs: number,
): Promise<Collected> {
  const gen = chatStream(system, user, {
    model,
    temperature: 0.7,
    headers,
    timeoutMs: LLM_CONFIG.deepseek.timeoutMs,
    mode: 'deep',
  });
  const it = gen[Symbol.asyncIterator]();
  const out: Collected = { reasoning: '', content: '' };
  try {
    for (;;) {
      const next = await nextWithTimeout(it, idleMs);
      if (next.done) break;
      const d = next.value;
      if (d.reasoning) {
        out.reasoning += d.reasoning;
        onDelta?.(d.reasoning);
      }
      if (d.content) out.content += d.content;
    }
  } catch (e) {
    await it.return?.(undefined as never).catch(() => undefined);
    throw e;
  }
  if (!out.content.trim() && !out.reasoning.trim()) {
    throw new Error('模型返回为空');
  }
  return out;
}

/**
 * 推理模型调用（含降级链）：
 * deepseek-reasoner 失败或 60s 无响应 → 改 deepseek-chat 并加「请逐步推理后再给结论」重试 1 次 → 仍失败则抛出（上层回退扣子工作流）。
 */
async function callReasoner(
  system: string,
  user: string,
  headers: Headers,
  onDelta: ((text: string) => void) | undefined,
): Promise<Collected> {
  try {
    return await streamCollect(
      system,
      user,
      LLM_CONFIG.deepseek.reasoningModel,
      headers,
      onDelta,
      LLM_CONFIG.deepseek.reasoningTimeoutMs,
    );
  } catch (firstErr) {
    console.log(
      `[deep-chain] reasoner 降级 chat：${(firstErr as Error)?.message ?? String(firstErr)}`,
    );
    return await streamCollect(
      `${system}\n（请逐步推理后再给结论）`,
      user,
      LLM_CONFIG.deepseek.chatModel,
      headers,
      onDelta,
      LLM_CONFIG.deepseek.reasoningTimeoutMs,
    );
  }
}

/** 阶段开始事件（模块级，clarify 分支与主链共用） */
function phaseStartLocal(p: DeepChainPhase, emit: Emit) {
  emit({ type: 'phase_start', phase_id: p.id, phase_name: p.name, detail: p.detail });
}

function expertBlock(scene?: string, category?: string): string {
  if (!isScienceFair(scene, category)) return '';
  return buildKBContext(scene, category);
}

/** 深度模式追问结果（与快速模式 question 结构一致，mode=deep） */
function questionPayload(j: Judgement, round: number): DeepChainResult {
  return {
    type: 'question',
    mode: 'deep',
    clarity: j.clarity,
    category: j.category,
    clarity_desc: j.clarity_desc,
    missing_info: j.missing_info,
    options: j.options,
    content: j.next_question,
    round,
  };
}

/** 五阶段论证链主入口。任何阶段抛错即中断（上层负责降级到扣子工作流）。 */
export async function runDeepChain(
  context: string,
  headers: Headers,
  scene: string | undefined,
  emit: Emit,
  round: number,
  opts?: { clarify?: boolean },
): Promise<void> {
  /* 先问后拆：新会话首轮强制澄清 1-3 问，用户回答后进入完整论证 */
  if (opts?.clarify) {
    const p1 = DEEP_PHASES[0];
    phaseStartLocal(p1, emit);
    const t0 = Date.now();
    const c = await clarifyQuestions(context, headers, scene);
    emit({
      type: 'phase_end',
      phase_id: p1.id,
      phase_name: p1.name,
      elapsed_ms: Date.now() - t0,
    });
    emit({
      type: 'result',
      result: {
        type: 'clarify',
        mode: 'deep',
        clarity: c.clarity,
        category: c.category,
        clarity_desc: c.clarity_desc,
        content: '在启动深度论证前，请先回答以下关键问题：',
        round,
        clarifications: c.clarifications,
      },
    });
    return;
  }

  const phaseStart = (p: DeepChainPhase) => phaseStartLocal(p, emit);
  const phaseEnd = (p: DeepChainPhase, t0: number) =>
    emit({ type: 'phase_end', phase_id: p.id, phase_name: p.name, elapsed_ms: Date.now() - t0 });

  /* 阶段1：需求诊断 */
  const p1 = DEEP_PHASES[0];
  phaseStart(p1);
  const t1 = Date.now();
  const judgement = await judge(context, headers, scene);
  if (judgement.clarity <= 1) {
    phaseEnd(p1, t1);
    emit({ type: 'result', result: questionPayload(judgement, round) });
    return;
  }
  phaseEnd(p1, t1);

  /* 阶段2：多视角论证（reasoner × 3 并行，reasoning 增量实时推送） */
  const p2 = DEEP_PHASES[1];
  phaseStart(p2);
  const t2 = Date.now();
  const kb = expertBlock(scene, judgement.category);
  const red = findRedSeaCase(context);
  const redNote = red
    ? `\n【查重警示】该想法与往届案例「${red.name}」（${red.domain}·${red.result}）高度相似，论证时必须处理同质化问题，差异化建议：${red.differentiation}`
    : '';
  const userInput = `【用户需求上下文】\n${context}\n\n【需求诊断结论】\n清晰度：${judgement.clarity}/3；场景：${judgement.category}；${judgement.clarity_desc}${redNote}`;

  const viewResults: ViewResult[] = await Promise.all(
    VIEW_DEFS.map(async (v) => {
      const system =
        VIEW_SYSTEM_TMPL.replace('{NAME}', v.name).replace('{FOCUS}', v.focus) + kb + sceneSupplement(scene);
      const r = await callReasoner(system, userInput, headers, (text) =>
        emit({ type: 'reasoning_delta', view: v.id, view_name: v.name, text }),
      );
      return { id: v.id, name: v.name, content: r.content || r.reasoning };
    }),
  );
  phaseEnd(p2, t2);

  /* 阶段3：评委质询 */
  const p3 = DEEP_PHASES[2];
  phaseStart(p3);
  const t3 = Date.now();
  const grillInput = `${userInput}\n\n【三视角论证结论】\n${viewResults
    .map((v) => `视角${v.id}（${v.name}）：\n${v.content}`)
    .join('\n\n')}`;
  const grill = await callReasoner(GRILL_SYSTEM + kb + sceneSupplement(scene), grillInput, headers, (text) =>
    emit({ type: 'reasoning_delta', view: 'grill', view_name: '评委质询', text }),
  );
  phaseEnd(p3, t3);

  /* 阶段4：报告整合（chat 模型，content 流式） */
  const p4 = DEEP_PHASES[3];
  phaseStart(p4);
  const t4 = Date.now();
  const reportInput = `${grillInput}\n\n【评委质询要点】\n${grill.content || grill.reasoning}`;
  let report = '';
  for await (const d of chatStream(REPORT_SYSTEM + kb + sceneSupplement(scene), reportInput, {
    model: LLM_CONFIG.reportModel,
    temperature: 0.7,
    headers,
    timeoutMs: LLM_CONFIG.deepseek.timeoutMs,
    maxTokens: 4000,
    mode: 'deep',
  })) {
    if (d.content) {
      report += d.content;
      emit({ type: 'content_delta', text: d.content });
    }
  }
  phaseEnd(p4, t4);

  /* 阶段5：评审检查清单 + 结构化产物（需求地图/正反交锋/拆解卡） */
  const p5 = DEEP_PHASES[4];
  phaseStart(p5);
  const t5 = Date.now();
  const rv = await reviewChecklist(context, report, headers);
  const structured = await buildStructured(context, report, headers, scene);
  phaseEnd(p5, t5);

  emit({
    type: 'result',
    result: {
      type: 'solution',
      mode: 'deep',
      clarity: judgement.clarity,
      category: judgement.category,
      clarity_desc: judgement.clarity_desc,
      content: report || '（未能生成报告内容）',
      round,
      checklist: rv.checklist,
      source_tags: rv.source_tags,
      plagiarism: plagiarismHint(context),
      evidence: matchEvidence(context),
      structured,
    },
  });
}
