import { LLM_CONFIG } from './config';
import { chatStream, type StreamDelta } from './llmProvider';
import {
  judge,
  reviewChecklist,
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

export interface DeepChainResult {
  type: 'question' | 'solution';
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

const REPORT_SYSTEM = `你是一个资深的需求拆解专家与科创赛评审。评审团已完成需求诊断、三视角论证与评委质询，请整合全部材料生成最终拆解报告，Markdown 格式：

# 需求拆解报告

## 需求理解
- 真实需求：一句话说清
- 核心动机：用户背后的真正目的
- 隐含约束：用户没说但很关键的限定条件

## 拆解方案
分3-5个模块，每个模块包含具体可落地的执行细节（具体到工具、数字、步骤、时间点，拒绝空话套话）

## 风险预警与降级方案
列出2-3个最可能踩的坑（吸收论证与质询中指出的风险），每一条先写「可能踩坑：」再写「降级方案：」给出具体规避方法

## 整改行动方案
按优先级【高/中/低】排序，每条单独一行，格式：
- 【高】任务名（耗时：2小时）验收标准：可量化的完成标准 依赖项：前置条件
必须包含：优先级、任务名、耗时、可量化的验收标准、依赖项，缺一不可；3-6 条。

## 继续推进
A. 帮我把第一步做出来
B. 帮我评估时间和成本
C. 我想调整一下方向

要求：吸收论证结论与质询要点的判断，全文无emoji。直接输出报告正文，不要输出任何 JSON 或代码块。`;

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
): Promise<void> {
  const phaseStart = (p: DeepChainPhase) =>
    emit({ type: 'phase_start', phase_id: p.id, phase_name: p.name, detail: p.detail });
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
    maxTokens: 2000,
    mode: 'deep',
  })) {
    if (d.content) {
      report += d.content;
      emit({ type: 'content_delta', text: d.content });
    }
  }
  phaseEnd(p4, t4);

  /* 阶段5：评审检查清单 */
  const p5 = DEEP_PHASES[4];
  phaseStart(p5);
  const t5 = Date.now();
  const rv = await reviewChecklist(context, report, headers);
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
    },
  });
}
