import fs from 'fs';
import path from 'path';

/** LLM 调用用量日志：内存聚合 + JSON 文件持久化（.usage/llm-usage.json，git 忽略） */
const DIR = path.join(process.cwd(), '.usage');
const FILE = path.join(DIR, 'llm-usage.json');
const MAX_ENTRIES = 5000;

export interface UsageEntry {
  time: string;
  provider: string;
  model: string;
  mode?: string;
  elapsedMs: number;
  promptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
}

export function readUsageAll(): UsageEntry[] {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function recordUsage(entry: UsageEntry): void {
  try {
    if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
    const all = readUsageAll();
    all.push(entry);
    fs.writeFileSync(FILE, JSON.stringify(all.slice(-MAX_ENTRIES)));
  } catch {
    /* 写失败不影响主流程 */
  }
}

export interface UsageStats {
  totalCalls: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  byModel: { model: string; calls: number; promptTokens: number; completionTokens: number }[];
  recent: UsageEntry[];
}

export function aggregateUsage(): UsageStats {
  const all = readUsageAll();
  const byModelMap = new Map<string, { calls: number; promptTokens: number; completionTokens: number }>();
  let totalPrompt = 0;
  let totalCompletion = 0;
  for (const e of all) {
    totalPrompt += e.promptTokens ?? 0;
    totalCompletion += e.completionTokens ?? 0;
    const m = byModelMap.get(e.model) ?? { calls: 0, promptTokens: 0, completionTokens: 0 };
    m.calls += 1;
    m.promptTokens += e.promptTokens ?? 0;
    m.completionTokens += e.completionTokens ?? 0;
    byModelMap.set(e.model, m);
  }
  return {
    totalCalls: all.length,
    totalPromptTokens: totalPrompt,
    totalCompletionTokens: totalCompletion,
    byModel: [...byModelMap.entries()]
      .map(([model, v]) => ({ model, ...v }))
      .sort((a, b) => b.calls - a.calls),
    recent: all.slice(-10).reverse(),
  };
}
