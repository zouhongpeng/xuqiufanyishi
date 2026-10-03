/**
 * 科创赛知识库：加载并压缩三张数据表（评审规则 / 往届案例 / 能力边界），
 * 供评审引擎注入 LLM 系统提示与前端可视化使用。仅后端注入 LLM，
 * 前端直接 import 对应 JSON 做可视化展示。
 */
import reviewRulesData from '../data/review-rules.json';
import pastCasesData from '../data/past-cases.json';
import boundaryData from '../data/capability-boundary.json';

export interface ReviewRule {
  id: string;
  rule_type: string;
  rule_name: string;
  rule_content: string;
  severity: string;
}
export interface PastCase {
  id: string;
  project_name: string;
  core_tech: string;
  award_level: string;
  innovation_tags: string;
  sea_status: '红海' | '中等' | '蓝海' | '蓝海方向';
  differentiation_hint: string;
}
export interface BoundaryItem {
  id: string;
  zone: string;
  item: string;
  alternative: string;
}

export const REVIEW_RULES: ReviewRule[] = reviewRulesData as ReviewRule[];
export const PAST_CASES: PastCase[] = pastCasesData as PastCase[];
export const BOUNDARIES: BoundaryItem[] = boundaryData as BoundaryItem[];

export const CASES_COUNT = PAST_CASES.length;

/** 红海案例关键词（用于快速命中「撞车」提示），由往届案例库红海项目名关键片段推导 */
export const RED_SEA_KEYWORDS: { kw: RegExp; tone: string }[] = [
  { kw: /垃圾分类|分类桶|垃圾识别/i, tone: 'hit' },
  { kw: /人脸?识别|人脸?门禁|人脸?签到|人脸?考勤/i, tone: 'hit' },
  { kw: /浇花|自动.?浇|温室|农业装置/i, tone: 'hit' },
  { kw: /智能灯|灯控|触摸开关/i, tone: 'hit' },
  { kw: /失物招领/i, tone: 'hit' },
  { kw: /二手书|二手平台|二手交易/i, tone: 'hit' },
  { kw: /停车|车位引导/i, tone: 'hit' },
  { kw: /人脸?识别/i, tone: 'hit' },
];

/** 命中红海关键词则返回提示文案（供 judge 注入 missing_info / clarity_desc） */
export function redSeaHitOnText(text: string): string | null {
  if (!text) return null;
  for (const { kw } of RED_SEA_KEYWORDS) {
    if (kw.test(text)) {
      return '该方向已高度饱和（在往届科创赛案例库中属红海项目），需在场景或技术角度做差异化。';
    }
  }
  return null;
}

/** 命中具体红海案例（返回匹配案例对象） */
export function findRedSeaCase(text: string): PastCase | null {
  if (!text) return null;
  const redSea = PAST_CASES.filter((c) => c.sea_status === '红海' || c.sea_status === '中等');
  for (const c of redSea) {
    const frag = c.project_name.replace(/智能|自动|系统|平台|助手|小程序|装置|App|工具|虚拟/g, '');
    if (text.includes(frag) && frag.length >= 4) return c;
    if (c.project_name.toLowerCase().split('').every((ch) => text.includes(ch)) && c.project_name.length >= 5) return c;
  }
  return null;
}

/** 压缩知识库上下文：category=科创赛诊断时注入 LLM 系统提示 */
export function buildKBContext(scene?: string, category?: string): string {
  const active =
    (scene ?? '') === '科创赛诊断' || (category ?? '') === '科创赛诊断';
  if (!active) return '';

  const redCases = PAST_CASES.filter((c) => c.sea_status === '红海' || c.sea_status === '中等')
    .map((c) => `- ${c.project_name}（${c.innovation_tags}·${c.award_level}）撞车，差异化：${c.differentiation_hint}`)
    .join('\n');
  const rules = REVIEW_RULES.map(
    (r) => `- ${r.rule_name}（${r.rule_type}·${r.severity}）：${r.rule_content}`,
  ).join('\n');
  const safe = BOUNDARIES.filter((b) => b.zone === '安全区').map((b) => b.item).join('、');
  const risk = BOUNDARIES.filter((b) => b.zone === '高风险区')
    .map((b) => `- ${b.item} → ${b.alternative}`)
    .join('\n');
  const blue = PAST_CASES.filter((c) => c.sea_status === '蓝海' || c.sea_status === '蓝海方向')
    .map((c) => c.differentiation_hint.replace(/^.*?(蓝海参考方向|蓝海方向|社会价值|文化|工具)/, ''))
    .join('；');

  return `

【科创赛评审知识库（以此为准绳评审）】
评审规则：
${rules}
往届撞车提示（命中即为红海，需差异化）：
${redCases}
蓝海参考方向：${blue}
能力边界（中学生可行范围）：
- 安全区：${safe}
- 高风险区（给替代方案）：
${risk}
评分原则：创新性权重最高、科学性次之；红线三自原则（自己选题/自己设计/自己撰写）违规直接淘汰。
`;
}