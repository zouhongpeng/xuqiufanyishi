'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Send } from 'lucide-react';
import { ReportView, type ReportMode } from '@/components/ReportView';
import { DiagnosisCard, type DiagnosticOption } from '@/components/DiagnosisCard';

type Mode = 'quick' | 'deep';
type View = 'hero' | 'chat';

interface ChatMsg {
  id: string;
  role: 'user' | 'ai' | 'system';
  report?: boolean;
  mode?: Mode;
  content: string;
  clarity?: number;
  category?: string;
  clarity_desc?: string;
  missing_info?: string[];
  options?: DiagnosticOption[];
  time: number;
}

const MSG_KEY = 'req-decomposer:messages:v2';
const SID_KEY = 'req-decomposer:session:v2';
const MODE_KEY = 'req-decomposer:mode:v1';

const SCENES = ['科创赛诊断', '视频创作', '写作', '创业', '学习', '活动'];
const SUGGESTIONS = ['我想做一个校园二手交易平台', '帮我拆解老人防走丢手环的创意', '做一款帮助考研人打卡的应用'];
const NEXT_OPTIONS = [
  'A. 帮我把第一步做出来',
  'B. 帮我评估时间和成本',
  'C. 我想调整一下方向',
];
const DEEP_NODES = ['场景识别', '需求解析', '深度解析', '优先级排序', '风险预判', '时间成本评估'];

const GREETING =
  '把你脑子里还不算清晰的想法告诉我。不够清楚我会追问几个关键问题，直到能替你拆出一份完整的方案与行动清单。';

function load<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function makeId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

export default function Home() {
  const [view, setView] = useState<View>('hero');
  const [mode, setMode] = useState<Mode>('quick');
  const [scene, setScene] = useState('科创赛诊断');
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [nodeIdx, setNodeIdx] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nodeTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const msgs = load<ChatMsg[]>(MSG_KEY, []);
    let sid = load<string>(SID_KEY, '');
    if (!sid) {
      sid = makeId();
      save(SID_KEY, sid);
    }
    if (msgs.length === 0) {
      msgs.push({ id: makeId(), role: 'ai', content: GREETING, time: Date.now() });
    }
    setMessages(msgs);
    setSessionId(sid);
    setMode(load<Mode>(MODE_KEY, 'quick'));
    if (msgs.some((m) => m.role === 'user')) setView('chat');
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    save(MSG_KEY, messages);
  }, [messages, hydrated]);
  useEffect(() => {
    if (hydrated) {
      save(MODE_KEY, mode);
      save(SID_KEY, sessionId);
    }
  }, [mode, sessionId, hydrated]);

  const scrollToBottom = useCallback(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, []);
  useEffect(() => {
    if (hydrated) scrollToBottom();
  }, [messages, loading, hydrated, scrollToBottom]);

  useEffect(() => {
    if (loading && mode === 'deep') {
      setNodeIdx(0);
      nodeTimer.current = setInterval(() => {
        setNodeIdx((i) => {
          if (i >= DEEP_NODES.length) return i;
          return i + 1;
        });
      }, 650);
    } else if (nodeTimer.current) {
      clearInterval(nodeTimer.current);
      nodeTimer.current = null;
    }
    return () => {
      if (nodeTimer.current) clearInterval(nodeTimer.current);
    };
  }, [loading, mode]);

  function save(key: string, value: unknown) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* 忽略 */
    }
  }

  function startNew() {
    const sid = makeId();
    setSessionId(sid);
    setMessages([{ id: makeId(), role: 'ai', content: GREETING, time: Date.now() }]);
    setInput('');
    setView('hero');
  }

  async function handleSend(text?: string) {
    const value = (text ?? input).trim();
    if (!value || loading) return;
    setInput('');
    if (view === 'hero') setView('chat');

    setMessages((prev) => [...prev, { id: makeId(), role: 'user', content: value, time: Date.now() }]);
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: value, mode, scene }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          { id: makeId(), role: 'system', content: `调用出错：${data.detail || data.error || '未知错误'}`, time: Date.now() },
        ]);
        return;
      }
      const aiMode: Mode = data.mode === 'deep' ? 'deep' : 'quick';
      setMessages((prev) => [
        ...prev,
        {
          id: makeId(),
          role: 'ai',
          report: data.type === 'solution',
          mode: aiMode,
          content: data.content ?? '',
          clarity: data.clarity,
          category: data.category,
          clarity_desc: data.clarity_desc,
          missing_info: data.missing_info,
          options: data.options,
          time: Date.now(),
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: makeId(), role: 'system', content: '网络异常，请稍后重试。', time: Date.now() },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-white text-[#1d1d1f]">
      <div
        className="hero-glow"
        style={{ top: '-200px', left: '50%', transform: 'translateX(-50%)' }}
      />
      {/* 顶部极简导航 */}
      <nav className="app-nav glass no-print z-20 flex h-14 shrink-0 items-center justify-between border-b border-[#f0f0f2] px-5 sm:px-8">
        <button onClick={startNew} className="text-[17px] font-semibold tracking-tight">
          拆解
        </button>
        <div className="flex items-center gap-3">
          <ModeSwitch value={mode} onChange={setMode} />
          <button
            onClick={startNew}
            className="inline-flex items-center gap-1 rounded-full bg-[#0071e3] px-3.5 py-1.5 text-[13px] font-medium text-white transition-opacity hover:opacity-85"
          >
            <Plus className="h-3.5 w-3.5" />
            新需求
          </button>
        </div>
      </nav>

      {view === 'hero' ? (
        <HeroStage
          mode={mode}
          scene={scene}
          onScene={setScene}
          input={input}
          onInput={setInput}
          onSend={() => handleSend()}
        />
      ) : (
        <ChatStage
          mode={mode}
          messages={messages}
          loading={loading}
          nodeIdx={nodeIdx}
          scrollRef={scrollRef}
          input={input}
          onInput={setInput}
          onSend={() => handleSend()}
          onPick={handleSend}
        />
      )}
    </div>
  );
}

/* ==================== 模式分段开关 ==================== */
function ModeSwitch({ value, onChange }: { value: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="relative flex items-center rounded-full bg-[#f5f5f7] p-[3px]">
      {(
        [
          { k: 'quick', label: '⚡ 快速' },
          { k: 'deep', label: '🔬 深度' },
        ] as const
      ).map((it) => {
        const active = value === it.k;
        return (
          <button
            key={it.k}
            onClick={() => onChange(it.k)}
            className="relative z-10 rounded-full px-3.5 py-1 text-[12.5px] font-medium transition-[color,box-shadow] duration-300"
            style={{
              color: active ? '#1d1d1f' : '#86868b',
              transform: active ? 'scale(1)' : 'none',
            }}
          >
            {active && (
              <span className="absolute inset-0 -z-10 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.12)]" />
            )}
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

/* ==================== 第一幕：首屏 ==================== */
function HeroStage({
  mode,
  scene,
  onScene,
  input,
  onInput,
  onSend,
}: {
  mode: Mode;
  scene: string;
  onScene: (s: string) => void;
  input: string;
  onInput: (v: string) => void;
  onSend: () => void;
}) {
  return (
    <div className="fade-in relative z-10 flex flex-1 flex-col items-center justify-center px-6 text-center">
      <h1 className="max-w-4xl text-[44px] font-bold leading-[1.08] tracking-tight text-[#1d1d1f] sm:text-[60px]">
        说出你的想法，我帮你拆到能执行。
      </h1>
      <p className="mt-5 text-[16px] text-[#86868b] sm:text-[18px]">一句话说清你的想法，剩下的交给我们。</p>

      <div className="mt-10 w-full max-w-2xl">
        {/* 场景胶囊 */}
        <div className="mb-4 flex flex-wrap items-center justify-center gap-2">
          {SCENES.map((s) => (
            <button
              key={s}
              onClick={() => onScene(s)}
              className={`rounded-full border px-3.5 py-1.5 text-[13px] transition-colors ${
                s === scene
                  ? 'border-[#0071e3] text-[#0071e3] font-medium'
                  : 'border-[#e8e8ed] bg-white text-[#86868b] hover:text-[#1d1d1f]'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* 大输入框 */}
        <div className="flex items-center gap-2 rounded-[16px] border border-[#d8d8dd] bg-white px-4 py-1.5 shadow-[0_4px_24px_rgba(0,0,0,0.06)] transition-shadow focus-within:border-[#0071e3] focus-within:ring-4 focus-within:ring-[#0071e3]/10">
          <textarea
            value={input}
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            rows={1}
            placeholder="输入你的想法…"
            className="max-h-28 flex-1 resize-none bg-transparent py-2 text-[16px] leading-6 text-[#1d1d1f] outline-none placeholder:text-[#c7c7cc]"
          />
          <button
            onClick={onSend}
            disabled={!input.trim()}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#0071e3] text-white transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="开始拆解"
          >
            <Send className="h-[18px] w-[18px]" />
          </button>
        </div>

        <ModeTip mode={mode} />
        <p className="mt-2 text-[12px] text-[#c7c7cc]">专家知识库已就绪 · 支持深度推理</p>
      </div>
    </div>
  );
}

function ModeTip({ mode }: { mode: Mode }) {
  return (
    <p className="mt-3 text-[13px] text-[#86868b]">
      {mode === 'deep' ? '将启动专项分析节点 · 约 1 分钟' : '快速拆解 · 即时反馈'}
    </p>
  );
}

/* ==================== 第二墓+第三幕：对话与报告 ==================== */
function ChatStage({
  mode,
  messages,
  loading,
  nodeIdx,
  scrollRef,
  input,
  onInput,
  onSend,
  onPick,
}: {
  mode: Mode;
  messages: ChatMsg[];
  loading: boolean;
  nodeIdx: number;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  input: string;
  onInput: (v: string) => void;
  onSend: () => void;
  onPick: (t: string) => void;
}) {
  const replying = loading && mode === 'deep';
  return (
    <>
      {/* 消息流 */}
      <div
        ref={scrollRef}
        data-chat-scroll
        className="no-print mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 overflow-y-auto px-5 py-6 sm:px-6"
      >
        {messages.map((m) => (
          <MessageRow key={m.id} msg={m} onPick={onPick} />
        ))}
        {loading && (
          <div className="scale-in">
            {replying ? <DeepProgress nodeIdx={nodeIdx} /> : <TypingIndicator />}
          </div>
        )}
      </div>

      {/* 底部输入 */}
      <div className="msg-input no-print z-20 shrink-0 border-t border-[#f0f0f2] px-5 pb-[max(env(safe-area-inset-bottom),16px)] pt-3 sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          {messages.length <= 1 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => onPick(s)}
                  className="rounded-full border border-[#e8e8ed] bg-white px-3.5 py-1.5 text-[13px] text-[#86868b] transition-colors hover:border-[#d8d8dd] hover:text-[#1d1d1f]"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          {mode === 'deep' && <ModeTip mode={mode} />}
          <div className="flex items-end gap-2 rounded-full border border-[#d8d8dd] bg-white px-4 py-1 shadow-[0_4px_24px_rgba(0,0,0,0.04)] focus-within:border-[#0071e3]">
            <textarea
              value={input}
              onChange={(e) => onInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onSend();
                }
              }}
              rows={1}
              placeholder="继续输入…（回车发送）"
              className="max-h-28 flex-1 resize-none bg-transparent py-2 text-[15px] leading-6 text-[#1d1d1f] outline-none placeholder:text-[#c7c7cc]"
            />
            <button
              onClick={onSend}
              disabled={!input.trim() || loading}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#0071e3] text-white transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="发送"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function MessageRow({ msg, onPick }: { msg: ChatMsg; onPick: (t: string) => void }) {
  if (msg.role === 'system') {
    return (
      <div className="fade-in mx-auto flex max-w-[90%] items-center gap-2 rounded-[14px] bg-[#fff2f0] px-4 py-2.5 text-[13px] leading-6 text-[#e5484d]">
        <span>{msg.content}</span>
      </div>
    );
  }

  const isUser = msg.role === 'user';

  // 第三幕：报告满屏展开
  if (msg.report) {
    return (
      <div className="scale-in flex w-full justify-center">
        <div className="w-full max-w-3xl">
          <ReportView content={msg.content} mode={msg.mode} />
          <div className="no-print mt-5 flex flex-wrap justify-center gap-2.5">
            {NEXT_OPTIONS.map((opt) => (
              <button
                key={opt}
                onClick={() => onPick(opt)}
                className="rounded-full px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-85"
                style={{ background: '#0071e3' }}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // 追问诊断卡片：AI 回复携带缺失信息与可点选项时渲染
  if (msg.role === 'ai' && !msg.report && msg.options && msg.options.length > 0) {
    return (
      <div className="flex w-full justify-start">
        <DiagnosisCard
          clarity={msg.clarity ?? 0}
          category={msg.category ?? ''}
          clarity_desc={msg.clarity_desc}
          missing_info={msg.missing_info}
          options={msg.options}
          nextQuestion={msg.content}
          onPick={onPick}
        />
      </div>
    );
  }

  return (
    <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={isUser ? 'max-w-[78%]' : 'flex max-w-[78%] flex-col items-start'}>
        {!isUser && (
          <div className="mb-1 text-[11px] font-medium text-[#86868b] no-print">
            {msg.mode === 'deep' ? '🔬 深度' : '⚡ 快速'}
          </div>
        )}
        <div
          className={`whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[15px] leading-7 ${
            isUser
              ? 'rounded-br-sm bg-[#0071e3] text-white'
              : 'rounded-bl-sm border border-[#f0f0f2] bg-[#f5f5f7] text-[#1d1d1f]'
          }`}
        >
          {msg.content}
        </div>
      </div>
    </div>
  );
}

function DeepProgress({ nodeIdx }: { nodeIdx: number }) {
  return (
    <div className="mx-auto max-w-md space-y-2 rounded-[16px] border border-[#f0f0f2] bg-[#fbfbfd] p-5">
      <p className="text-[13px] font-medium text-[#1d1d1f]">正在启动专项分析节点…</p>
      <div className="space-y-1.5">
        {DEEP_NODES.slice(0, nodeIdx).map((n, i) => (
          <div
            key={n}
            className="node-pop flex items-center gap-2 text-[13px]"
            style={{ color: i === DEEP_NODES.length - 1 ? '#0071e3' : '#86868b' }}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[#0071e3]" />
            {n}
          </div>
        ))}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex w-full items-center gap-2.5">
      <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm bg-[#f5f5f7] px-4 py-3">
        <span className="dot h-1.5 w-1.5 rounded-full bg-[#86868b]" />
        <span className="dot h-1.5 w-1.5 rounded-full bg-[#86868b]" />
        <span className="dot h-1.5 w-1.5 rounded-full bg-[#86868b]" />
      </div>
    </div>
  );
}