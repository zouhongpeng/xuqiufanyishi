/**
 * 评审知识库：加载三张结构化数据表（评审规则 / 往届案例 / 能力边界），
 * 供评审引擎关键词检索注入 LLM 系统提示、查重比对与前端可视化使用。
 * 前端可视化（背书条/雷区警示榜/知识库说明）直接 import 对应 JSON。
 */
import rulesData from '../data/knowledge/rules.json';
import casesData from '../data/knowledge/cases.json';
import boundariesData from '../data/knowledge/boundaries.json';

export interface KnowledgeRule {
  id: string;
  dimension: string;
  content: string;
  weight: string;
  deduction: string;
  keywords: string[];
}
export interface KnowledgeCase {
  id: string;
  name: string;
  domain: string;
  result: string;
  seaStatus: '红海' | '拥挤' | '蓝海';
  redSea: string;
  differentiation: string;
  keywords: string[];
  note?: string;
}
export interface KnowledgeBoundary {
  id: string;
  item: string;
  safe: boolean;
  risk: string;
  fallback: string;
  keywords: string[];
}

export const KB_RULES: KnowledgeRule[] = rulesData as KnowledgeRule[];
export const KB_CASES: KnowledgeCase[] = casesData as KnowledgeCase[];
export const KB_BOUNDARIES: KnowledgeBoundary[] = boundariesData as KnowledgeBoundary[];

export const KB_STATS = {
  rules: KB_RULES.length,
  cases: KB_CASES.length,
  boundaries: KB_BOUNDARIES.length,
};

/** 命中的知识条目引用（报告依据角标） */
export interface EvidenceRef {
  ref: string;
  label: string;
  kind: 'rule' | 'case' | 'boundary';
  text: string;
}

function hits(text: string, keywords: string[]): number {
  if (!text) return 0;
  return keywords.filter((k) => text.toLowerCase().includes(k.toLowerCase())).length;
}

/** 查重比对：用户描述与案例库关键词重合度粗匹配，命中红海/拥挤案例（取重合度最高者） */
export function findRedSeaCase(text: string): KnowledgeCase | null {
  if (!text) return null;
  let best: { c: KnowledgeCase; n: number } | null = null;
  for (const c of KB_CASES) {
    if (c.seaStatus === '蓝海') continue;
    const n = hits(text, c.keywords);
    if (n > 0 && (!best || n > best.n)) best = { c, n };
  }
  return best?.c ?? null;
}

/** 命中红海案例则返回提示文案（供 judge 注入 missing_info / clarity_desc） */
export function redSeaHitOnText(text: string): string | null {
  const c = findRedSeaCase(text);
  if (!c) return null;
  return `该方向与往届案例「${c.name}」高度相似（${c.seaStatus}），需差异化。`;
}

/** 查重提示卡数据：报告风险预警区展示 */
export function plagiarismHint(text: string): { caseName: string; domain: string; result: string; redSea: string; differentiation: string } | null {
  const c = findRedSeaCase(text);
  if (!c) return null;
  return { caseName: c.name, domain: c.domain, result: c.result, redSea: c.redSea, differentiation: c.differentiation };
}

/** 关键词检索注入：命中的规则/边界条目作为依据引用（含原文） */
export function matchEvidence(text: string, max = 4): EvidenceRef[] {
  if (!text) return [];
  const out: EvidenceRef[] = [];
  for (const r of KB_RULES) {
    if (hits(text, r.keywords) > 0) {
      out.push({ ref: r.id, label: `评审规则库 ${r.id}`, kind: 'rule', text: `${r.dimension}：${r.content}（权重${r.weight}；扣分点：${r.deduction}）` });
    }
  }
  for (const b of KB_BOUNDARIES) {
    if (hits(text, b.keywords) > 0) {
      out.push({ ref: b.id, label: `能力边界库 ${b.id}`, kind: 'boundary', text: `${b.item}：${b.risk}→${b.fallback}` });
    }
  }
  return out.slice(0, max);
}

/** 科创赛场景判定：注入三表知识库 */
export function isScienceFairScene(scene?: string, category?: string): boolean {
  return (scene ?? '') === '科创赛诊断' || (category ?? '') === '科创赛诊断';
}

/** 压缩知识库上下文：科创赛诊断场景注入 LLM 系统提示 */
export function buildKBContext(scene?: string, category?: string): string {
  if (!isScienceFairScene(scene, category)) return '';

  const rules = KB_RULES.map(
    (r) => `- ${r.id} ${r.dimension}（权重${r.weight}）：${r.content}；扣分点：${r.deduction}`,
  ).join('\n');
  const redCases = KB_CASES.filter((c) => c.seaStatus !== '蓝海')
    .map((c) => `- ${c.name}（${c.domain}·${c.result}·${c.seaStatus}）雷区：${c.redSea}；差异化：${c.differentiation}`)
    .join('\n');
  const blue = KB_CASES.filter((c) => c.seaStatus === '蓝海')
    .map((c) => `${c.name}：${c.differentiation}`)
    .join('；');
  const safe = KB_BOUNDARIES.filter((b) => b.safe).map((b) => b.item).join('、');
  const risky = KB_BOUNDARIES.filter((b) => !b.safe)
    .map((b) => `- ${b.item}（${b.risk}）→ ${b.fallback}`)
    .join('\n');

  return `

【科创赛评审知识库（条目带编号，引用时标注编号，以此为准绳评审）】
评审规则（R=评审规则库）：
${rules}
往届案例警示（C=案例库，命中即为红海/拥挤，需差异化）：
${redCases}
蓝海参考方向：${blue || '暂无'}
能力边界（B=能力边界库，中学生可行范围）：
- 相对安全区：${safe}
- 高风险/不可行（必须给替代方案）：
${risky}
评分原则：创新性权重最高、科学性次之；红线三自原则（自己选题/自己设计/自己撰写）违规直接淘汰。
`;
}
