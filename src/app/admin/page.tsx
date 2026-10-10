'use client';

import { useCallback, useEffect, useState } from 'react';
import { Lock, RefreshCcw, Activity } from 'lucide-react';

interface Stats {
  totalCalls: number;
  totalTokens: number;
  byModel: Record<string, { calls: number; tokens: number }>;
  recent: {
    time: string;
    mode: string;
    provider: string;
    model: string;
    elapsedMs: number;
    promptTokens: number;
    completionTokens: number;
  }[];
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fmtTime(t: string): string {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return t;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export default function AdminPage() {
  const [passcode, setPasscode] = useState('');
  const [loginMsg, setLoginMsg] = useState('');
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const loadStats = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const res = await fetch('/api/admin/stats', { cache: 'no-store' });
      if (res.status === 401 || res.status === 403) {
        setStats(null);
        return;
      }
      const data = await res.json();
      if (data.ok) setStats(data as Stats);
      else setErr(data.message ?? '读取失败');
    } catch {
      setErr('服务不可达，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const login = async () => {
    setLoginMsg('');
    if (!passcode.trim()) {
      setLoginMsg('请输入口令');
      return;
    }
    try {
      const hash = await sha256(passcode);
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash }),
      });
      const data = await res.json();
      if (data.ok) {
        setPasscode('');
        loadStats();
      } else {
        setLoginMsg(data.message ?? '登录失败');
      }
    } catch {
      setLoginMsg('网络错误，请重试');
    }
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-5 py-10">
      <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight text-[#1d1d1f]">
        <Activity className="h-5 w-5 text-[#0071e3]" />
        用量看板
      </h1>
      <p className="mt-1 text-[13px] text-[#86868b]">LLM 调用统计 · 仅管理员可见</p>

      {!stats ? (
        <div className="mt-8 rounded-[16px] border border-[#f0f0f2] bg-white p-6 shadow-[0_4px_24px_rgba(0,0,0,0.06)]">
          <div className="flex items-center gap-2 text-[14px] font-medium text-[#1d1d1f]">
            <Lock className="h-4 w-4 text-[#0071e3]" />
            管理员口令
          </div>
          <div className="mt-4 flex gap-2">
            <input
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') login();
              }}
              placeholder="输入 ADMIN_PASSCODE"
              className="flex-1 rounded-[12px] border border-[#d8d8dd] bg-[#fbfbfd] px-4 py-2.5 text-[14px] text-[#1d1d1f] outline-none transition-shadow focus:border-[#0071e3] focus:ring-4 focus:ring-[#0071e3]/10"
            />
            <button
              onClick={login}
              className="rounded-full bg-[#0071e3] px-5 py-2.5 text-[14px] font-medium text-white transition-opacity hover:opacity-85 active:opacity-70"
            >
              进入
            </button>
          </div>
          {loginMsg ? <p className="mt-3 text-[13px] text-[#e5484d]">{loginMsg}</p> : null}
          {err ? (
            <div className="mt-4 rounded-[12px] bg-[#fdf1f0] px-4 py-3 text-[13px] text-[#8d3a3a]">
              {err}
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-[14px] border border-[#f0f0f2] bg-white p-4">
              <p className="text-[12px] text-[#86868b]">总调用次数</p>
              <p className="mt-1 text-[28px] font-bold text-[#1d1d1f]">{stats.totalCalls}</p>
            </div>
            <div className="rounded-[14px] border border-[#f0f0f2] bg-white p-4">
              <p className="text-[12px] text-[#86868b]">总 Token 用量</p>
              <p className="mt-1 text-[28px] font-bold text-[#1d1d1f]">
                {stats.totalTokens.toLocaleString()}
              </p>
            </div>
            <div className="col-span-2 rounded-[14px] border border-[#f0f0f2] bg-white p-4 sm:col-span-1">
              <p className="text-[12px] text-[#86868b]">模型数</p>
              <p className="mt-1 text-[28px] font-bold text-[#1d1d1f]">
                {Object.keys(stats.byModel).length}
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-[14px] border border-[#f0f0f2] bg-white p-4">
            <p className="text-[13px] font-semibold text-[#1d1d1f]">按模型分类</p>
            <div className="mt-3 grid gap-2">
              {Object.entries(stats.byModel).map(([key, v]) => (
                <div key={key} className="flex items-center justify-between text-[13px]">
                  <span className="font-mono text-[12px] text-[#515154]">{key}</span>
                  <span className="text-[#86868b]">
                    {v.calls} 次 · {v.tokens.toLocaleString()} tokens
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 rounded-[14px] border border-[#f0f0f2] bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-semibold text-[#1d1d1f]">最近 10 次调用</p>
              <button
                onClick={loadStats}
                disabled={loading}
                className="inline-flex items-center gap-1 rounded-full border border-[#e8e8ed] px-3 py-1.5 text-[12px] text-[#0071e3] transition-colors hover:bg-[#f5f5f7] disabled:opacity-50"
              >
                <RefreshCcw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
                刷新
              </button>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-[12.5px]">
                <thead>
                  <tr className="text-[11.5px] text-[#86868b]">
                    <th className="py-1.5 pr-3 font-medium">时间</th>
                    <th className="py-1.5 pr-3 font-medium">模式</th>
                    <th className="py-1.5 pr-3 font-medium">模型</th>
                    <th className="py-1.5 pr-3 font-medium">耗时</th>
                    <th className="py-1.5 font-medium">Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recent.map((r, i) => (
                    <tr key={i} className="border-t border-[#f5f5f7] text-[#1d1d1f]">
                      <td className="py-2 pr-3 font-mono text-[11.5px]">{fmtTime(r.time)}</td>
                      <td className="py-2 pr-3">{r.mode}</td>
                      <td className="py-2 pr-3 font-mono text-[11.5px] text-[#515154]">
                        {r.provider}/{r.model}
                      </td>
                      <td className="py-2 pr-3">{(r.elapsedMs / 1000).toFixed(1)}s</td>
                      <td className="py-2">
                        {r.promptTokens}+{r.completionTokens}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
