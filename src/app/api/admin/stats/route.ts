import { NextResponse } from 'next/server';
import { readUsageAll } from '@/lib/usageLog';
import { adminPasscodeHash } from '../login/route';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const expected = adminPasscodeHash();
  if (!expected) {
    return NextResponse.json({ ok: false, message: '看板未启用' }, { status: 403 });
  }
  const cookie = req.headers.get('cookie') ?? '';
  const session = cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('admin_session='))
    ?.split('=')[1];
  if (session !== expected) {
    return NextResponse.json({ ok: false, message: '未登录' }, { status: 401 });
  }

  const calls = readUsageAll();
  const totalCalls = calls.length;
  const totalPrompt = calls.reduce((n, c) => n + (c.promptTokens ?? 0), 0);
  const totalCompletion = calls.reduce((n, c) => n + (c.completionTokens ?? 0), 0);

  const byModel: Record<string, { calls: number; tokens: number }> = {};
  for (const c of calls) {
    const key = `${c.provider}/${c.model}`;
    byModel[key] ??= { calls: 0, tokens: 0 };
    byModel[key].calls += 1;
    byModel[key].tokens += (c.promptTokens ?? 0) + (c.completionTokens ?? 0);
  }

  const recent = calls
    .slice(-10)
    .reverse()
    .map((c) => ({
      time: c.time,
      mode: c.mode ?? '-',
      provider: c.provider,
      model: c.model,
      elapsedMs: c.elapsedMs ?? 0,
      promptTokens: c.promptTokens ?? 0,
      completionTokens: c.completionTokens ?? 0,
    }));

  return NextResponse.json({
    ok: true,
    totalCalls,
    totalTokens: totalPrompt + totalCompletion,
    byModel,
    recent,
  });
}