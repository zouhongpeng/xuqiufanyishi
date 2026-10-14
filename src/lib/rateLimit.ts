/**
 * 内存频控（单实例）：快速模式单 IP 每分钟 5 次。深度模式不限流（用户可连续发起）。
 * 返回命中的限流规则（拒绝），null 表示放行。
 */
export interface RateRule {
  windowMs: number;
  max: number;
  label: string;
}

export const RATE_RULES = {
  quick: [{ windowMs: 60_000, max: 5, label: '每分钟 5 次' }],
} as const;

const buckets = new Map<string, number[]>();

export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip')?.trim() || 'local';
}

export function checkRate(key: string, rules: readonly RateRule[]): RateRule | null {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) =>
    rules.some((r) => now - t < r.windowMs),
  );
  for (const r of rules) {
    if (arr.filter((t) => now - t < r.windowMs).length >= r.max) return r;
  }
  arr.push(now);
  buckets.set(key, arr);
  return null;
}
