import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export function adminPasscodeHash(): string {
  const pass = process.env.ADMIN_PASSCODE ?? '';
  if (!pass) return '';
  return createHash('sha256').update(pass).digest('hex');
}

export async function POST(req: Request) {
  const expected = adminPasscodeHash();
  if (!expected) {
    return NextResponse.json(
      { ok: false, message: '看板未启用：部署环境未配置 ADMIN_PASSCODE' },
      { status: 403 },
    );
  }
  let body: { hash?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* ignore */
  }
  const got = (body.hash ?? '').toLowerCase();
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ ok: false, message: '口令不正确' }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set('admin_session', expected, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 12,
  });
  return res;
}
