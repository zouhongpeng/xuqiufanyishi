'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Plus, Send, Settings2, AlertTriangle } from 'lucide-react';
import { ReportView } from '@/components/ReportView';

interface ChatMsg {
  id: string;
  role: 'user' | 'ai' | 'system';
  report?: boolean;
  content: string;
  time: number;
}

const MSG_KEY = 'req-decomposer:messages:v1';
const SID_KEY = 'req-decomposer:session:v1';

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

const SUGGESTIONS = [
  '我想做一个校园二手交易平台',
  '帮我拆解老人防走丢手环的创意',
  '做一款帮助考研人的打卡应用',
];

const GREETING = '你好，我是需求拆解师。把你脑子里任何还不算清晰的想法告诉我，我会先判断它够不够清楚——不够就追问你几个关键问题，直到能替你拆出一份包含方案与行动清单的完整报告。先从第一句话开始吧。';

export default function Home() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [sessionId, setSessionId] = useState<string>('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // 首次挂载：恢复会话
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
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 持久化：消息与会话
  useEffect(() => {
    if (!hydrated) return;
    save(MSG_KEY, messages);
  }, [messages, hydrated]);

  useEffect(() => {
    if (hydrated) save(SID_KEY, sessionId);
  }, [sessionId, hydrated]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (hydrated) scrollToBottom();
  }, [messages, loading, hydrated, scrollToBottom]);

  function save(key: string, value: unknown) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* 存储不可用时静默忽略 */
    }
  }

  function startNew() {
    const sid = makeId();
    setSessionId(sid);
    setMessages([
      { id: makeId(), role: 'ai', content: GREETING, time: Date.now() },
    ]);
    setInput('');
    save(SID_KEY, sid);
  }

  async function handleSend(text?: string) {
    const value = (text ?? input).trim();
    if (!value || loading) return;
    setInput('');

    const userMsg: ChatMsg = { id: makeId(), role: 'user', content: value, time: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: value }),
      });
      const data = await res.json();

      if (!res.ok) {
        let sys: ChatMsg;
        if (data.notConfigured) {
          sys = {
            id: makeId(),
            role: 'system',
            content: '尚未配置工作流。请在环境变量中设置 COZE_PAT，并在 src/lib/coze-config.ts 中填写 WORKFLOW_ID 与输入参数名，保存后刷新页面即可开始对话。',
            time: Date.now(),
          };
        } else {
          sys = {
            id: makeId(),
            role: 'system',
            content: `调用出错：${data.error || '未知错误'}`,
            time: Date.now(),
          };
        }
        setMessages((prev) => [...prev, sys]);
        return;
      }

      const aiMsg: ChatMsg = {
        id: makeId(),
        role: 'ai',
        report: data.type === 'solution',
        content: data.content ?? '',
        time: Date.now(),
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch {
      const sys: ChatMsg = {
        id: makeId(),
        role: 'system',
        content: '网络异常，请稍后重试。',
        time: Date.now(),
      };
      setMessages((prev) => [...prev, sys]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="chat-root flex h-dvh w-full flex-col bg-[#FAFAF8] text-[#1C2433]">
      {/* 顶栏 */}
      <header className="no-print z-10 flex shrink-0 items-center justify-between border-b border-[#ECEDF0] bg-[#FAFAF8]/90 px-4 py-3 backdrop-blur sm:px-6">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#1C2433] text-white">
            <Bot className="h-5 w-5" />
          </span>
          <div className="leading-tight">
            <h1 className="text-[15px] font-semibold tracking-tight">需求拆解师</h1>
            <p className="text-[11px] text-[#8A91A0]">把模糊想法，拆成可执行的蓝图</p>
          </div>
        </div>
        <button
          onClick={startNew}
          className="inline-flex items-center gap-1.5 rounded-full border border-[#E2E6EC] bg-white px-3 py-1.5 text-[12px] font-medium text-[#3A4353] transition-colors hover:bg-[#F4F6F9]"
        >
          <Plus className="h-3.5 w-3.5" />
          新需求
        </button>
      </header>

      {/* 会话区 */}
      <div
        ref={scrollRef}
        data-chat-scroll
        className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 overflow-y-auto px-4 py-6 sm:px-6"
      >
        {hydrated && messages.length === 0 && (
          <EmptyState onPick={handleSend} />
        )}

        {hydrated &&
          messages.map((m) => (
            <MessageBubble key={m.id} msg={m} />
          ))}

        {loading && <TypingIndicator />}
      </div>

      {/* 输入区 */}
      <div className="no-print shrink-0 border-t border-[#ECEDF0] bg-white/80 px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-3 backdrop-blur sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          {hydrated && messages.length === 1 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSend(s)}
                  className="rounded-full border border-[#E2E6EC] bg-white px-3 py-1.5 text-[12px] text-[#4A5260] transition-colors hover:border-[#C7CDD8] hover:text-[#1C2433]"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2 rounded-2xl border border-[#E2E6EC] bg-white px-3 py-2 shadow-sm transition-shadow focus-within:border-[#8FA0D8] focus-within:ring-2 focus-within:ring-[#2E47A8]/10">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              rows={1}
              placeholder="说出你的想法…（回车发送）"
              className="max-h-32 flex-1 resize-none bg-transparent text-[14px] leading-6 text-[#1C2433] outline-none placeholder:text-[#B4BAC5]"
            />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || loading}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#1C2433] text-white transition-colors hover:bg-[#2E47A8] disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="发送"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 flex items-center justify-center gap-1 text-center text-[11px] text-[#A8AEB8]">
            <Settings2 className="h-3 w-3" />
            判断与拆解由扣子工作流完成 · 会话自动保存
          </p>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: ChatMsg }) {
  if (msg.role === 'system') {
    return (
      <div className="mx-auto flex max-w-[90%] items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] leading-6 text-[#7A5A16]">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>{msg.content}</span>
      </div>
    );
  }

  const isUser = msg.role === 'user';
  if (msg.report) {
    return (
      <div className="flex w-full justify-end gap-3">
        <div className="w-full">
          <ReportView content={msg.content} />
        </div>
      </div>
    );
  }

  return (
    <div className={`flex w-full items-end gap-2.5 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <span className="mb-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#1C2433] text-white">
          <Bot className="h-4 w-4" />
        </span>
      )}
      <div
        className={`max-w-[78%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[14px] leading-7 shadow-[0_1px_2px_rgba(28,36,51,0.06)] ${
          isUser
            ? 'rounded-br-md bg-[#E8ECF7] text-[#1C2433]'
            : 'rounded-bl-md border border-[#ECEDF0] bg-white text-[#3A4353]'
        }`}
      >
        {msg.content}
      </div>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <div className="mb-5 grid h-16 w-16 place-items-center rounded-3xl bg-[#1C2433] text-white">
        <Bot className="h-8 w-8" />
      </div>
      <h2 className="text-xl font-semibold tracking-tight text-[#1C2433]">
        把想法说给我听
      </h2>
      <p className="mt-2 max-w-sm text-[13px] leading-6 text-[#5B6472]">
        输入你的第一个想法，我会帮你把它拆成清晰的方案和行动清单。
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="rounded-full border border-[#E2E6EC] bg-white px-3.5 py-2 text-[12px] text-[#4A5260] transition-colors hover:border-[#C7CDD8] hover:text-[#1C2433]"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-end gap-2.5">
      <span className="mb-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#1C2433] text-white">
        <Bot className="h-4 w-4" />
      </span>
      <div className="flex items-center gap-1 rounded-2xl rounded-bl-md border border-[#ECEDF0] bg-white px-4 py-3">
        <span className="dot h-2 w-2 rounded-full bg-[#A8AEB8]" />
        <span className="dot h-2 w-2 rounded-full bg-[#A8AEB8]" />
        <span className="dot h-2 w-2 rounded-full bg-[#A8AEB8]" />
      </div>
    </div>
  );
}