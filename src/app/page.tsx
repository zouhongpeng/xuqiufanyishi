'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Plus,
  Send,
  ChevronDown,
  BookOpen,
  ShieldCheck,
  Fingerprint,
  Check,
  CheckCircle2,
  CircleAlert,
  X,
} from 'lucide-react';
import { ReportView, type ReviewItem } from '@/components/ReportView';
import { DiagnosisCard, type DiagnosticOption } from '@/components/DiagnosisCard';
import pastCasesData from '@/data/past-cases.json';
import reviewRulesData from '@/data/review-rules.json';
import boundaryData from '@/data/capability-boundary.json';

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
  checklist?: ReviewItem[];
  source_tags?: string[];
  time: number;
}

interface RStage {
  label: string;
  desc: string;
  status: 'pending' | 'active' | 'done';
}

const MSG_KEY = 'req-decomposer:messages:v3';
const SID_KEY = 'req-decomposer:session:v2';
const MODE_KEY = 'req-decomposer:mode:v1';

const SCENES = ['科创赛诊断', '视频创作', '写作', '创业', '学习', '活动'];
const SUGGESTIONS = ['我想做一个校园二手交易平台', '帮我拆解老人防走丢手环的创意', '做一款帮助考研人打卡的应用'];
const NEXT_LABEL = '下一步，你可以：';
const NEXT_OPTIONS = [
  'A. 帮我把第一步做出来',
  'B. 帮我评估时间和成本',
  'C. 我想调整一下方向',
];

/** 深度论证：评审环节（与后端 REVIEW_STAGES 一致的默认环节） */
const REVIEW_DEFAULT_STAGES: { label: string; desc: string }[] = [
  { label: '立项材料审查', desc: '核对需求完整性与自主性' },
  { label: '场景识别', desc: '判定领域与评审口径' },
  { label: '创新性论证', desc: '评估新颖度与差异化空间' },
  { label: '科学性校验', desc: '检查逻辑与依据' },
  { label: '查重比对', desc: '正在比对往届案例库…' },
  { label: '可行性评估', desc: '分析资源与工作量匹配' },
  { label: '风险识别', desc: '预警与降级方案' },
  { label: '行动规划', desc: '生成整改行动方案' },
  { label: '报告整合', desc: '汇编评审结论' },
];

const PAST_CASES = pastCasesData as {
  id: string;
  project_name: string;
  core_tech: string;
  award_level: string;
  innovation_tags: string;
  sea_status: string;
  differentiation_hint: string;
}[];
const RULE_COUNT = reviewRulesData.length;
const BOUNDARY_COUNT = boundaryData.length;
const RED_SEA_CASES = PAST_CASES.filter(
  (c) => c.sea_status === '红海' || c.sea_status === '中等',
);

const GREETING =
  '把你想参加科创赛的想法告诉我。我会像评委一样审视它：先查清晰度，不够就追问几个关键问题，直到能为你出具一份含整改行动方案与评审检查清单的完整诊断报告。';

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

  // 评审过程可视化
  const [stages, setStages] = useState<RStage[]>([]);
  const [phaseLabel, setPhaseLabel] = useState('');
  const [phaseDone, setPhaseDone] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [finished, setFinished] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const streamAccRef = useRef('');
  const finishedRef = useRef(false);

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
  }, [messages, loading, streamText, hydrated, scrollToBottom]);

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

  function resetProgress() {
    streamAccRef.current = '';
    finishedRef.current = false;
    setStages(REVIEW_DEFAULT_STAGES.map((s) => ({ ...s, status: 'pending' })));
    setPhaseLabel(mode === 'deep' ? '深度论证进行中' : '快速预诊中：清晰度评估');
    setPhaseDone(false);
    setStreamText('');
    setFinished(false);
    setElapsedSec(0);
  }

  function applyNode(ev: { status?: string; label?: string; desc?: string; idx?: number }) {
    const idx = typeof ev.idx === 'number' && ev.idx >= 0 ? ev.idx : 0;
    const status = ev.status === 'done' ? ('done' as const) : ('active' as const);
    if (ev.label && ev.label !== '扩展检查项') setPhaseLabel(ev.label);
    setStages((prev) => {
      const arr = [...prev];
      if (idx < arr.length) {
        arr[idx] = {
          label: ev.label ?? arr[idx].label,
          desc: ev.desc ?? arr[idx].desc,
          status,
        };
      } else {
        while (arr.length <= idx) arr.push({ label: '…', desc: '', status: 'pending' });
        arr[idx] = { label: ev.label ?? '扩展检查项', desc: ev.desc ?? '', status };
      }
      return arr;
    });
  }

  function commitResult(d: Record<string, any>, startedAt: number) {
    const isSolution = d.type === 'solution';
    const aiMode: Mode = d.mode === 'deep' ? 'deep' : 'quick';
    const acc = streamAccRef.current;
    const content =
      isSolution && acc ? acc : (d.content as string) ?? '';
    setMessages((prev) => [
      ...prev,
      {
        id: makeId(),
        role: 'ai',
        report: isSolution,
        mode: aiMode,
        content,
        clarity: d.clarity,
        category: d.category,
        clarity_desc: d.clarity_desc,
        missing_info: d.missing_info,
        options: d.options,
        checklist: d.checklist,
        source_tags: d.source_tags,
        time: Date.now(),
      },
    ]);
    // 完成后收拢为摘要一行
    finishedRef.current = true;
    setElapsedSec(Math.max(1, Math.round((Date.now() - startedAt) / 1000)));
    setFinished(true);
    setPhaseDone(true);
    setStreamText('');
    setStages((prev) => prev.map((s) => ({ ...s, status: 'done' as const })));
  }

  function pushSystem(text: string) {
    setMessages((prev) => [
      ...prev,
      { id: makeId(), role: 'system', content: text, time: Date.now() },
    ]);
  }

  async function handleSend(text?: string) {
    const value = (text ?? input).trim();
    if (!value || loading) return;
    setInput('');
    if (view === 'hero') setView('chat');

    setMessages((prev) => [...prev, { id: makeId(), role: 'user', content: value, time: Date.now() }]);
    setLoading(true);
    resetProgress();
    const startedAt = Date.now();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: value, mode, scene, stream: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        pushSystem(`评审服务出错：${(data as any).detail || (data as any).error || '未知错误'}`);
        return;
      }
      if (!res.body || !res.body.getReader) throw new Error('当前环境不支持流式连接');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      const handleEvent = (ev: any) => {
        if (!ev || typeof ev !== 'object') return;
        switch (ev.type) {
          case 'phase':
            if (ev.label) setPhaseLabel(ev.label);
            if (ev.id === 'judge' && ev.done) setPhaseDone(true);
            break;
          case 'node':
            applyNode(ev);
            break;
          case 'token':
            streamAccRef.current += ev.text ?? '';
            setStreamText(streamAccRef.current);
            break;
          case 'result':
            commitResult(ev.result, startedAt);
            break;
          case 'error':
            pushSystem(`评审中断：${ev.message || '未知错误'}`);
            break;
        }
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          let ev: any;
          try {
            ev = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          handleEvent(ev);
        }
      }
      // 读到流末尾但未收到 result（异常静默结束）
      if (!finishedRef.current) {
        pushSystem('评审过程意外结束，请重试。');
      }
    } catch (e) {
      pushSystem(`网络异常或服务不可达：${(e as Error)?.message || '未知错误'}`);
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
          stages={stages}
          phaseLabel={phaseLabel}
          phaseDone={phaseDone}
          finished={finished}
          elapsedSec={elapsedSec}
          streamText={streamText}
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
          { k: 'quick', label: '⚡ 快速预诊' },
          { k: 'deep', label: '🔬 深度论证' },
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
    <div className="fade-in relative z-10 flex flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-10 text-center">
      <h1 className="max-w-4xl text-[40px] font-bold leading-[1.12] tracking-tight text-[#1d1d1f] sm:text-[54px]">
        像评委一样，审视你的每一个项目想法
      </h1>
      <p className="mt-5 text-[16px] text-[#86868b] sm:text-[18px]">
        输入你的项目创意，我会按科创赛评审标准逐项核验，追问到位后为你出整改行动方案。
      </p>

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
            placeholder="输入你的项目想法…"
            className="max-h-28 flex-1 resize-none bg-transparent py-2 text-[16px] leading-6 text-[#1d1d1f] outline-none placeholder:text-[#c7c7cc]"
          />
          <button
            onClick={onSend}
            disabled={!input.trim()}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#0071e3] text-white transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="开始评审"
          >
            <Send className="h-[18px] w-[18px]" />
          </button>
        </div>

        <ModeTip mode={mode} />
        <p className="mt-2 text-[12px] text-[#c7c7cc]">
          评审知识库 · 覆盖评审规则 / 往届案例 / 能力边界
        </p>
      </div>

      {/* 知识库背书 + 雷区警示榜 */}
      <KbFooter />
    </div>
  );
}

function ModeTip({ mode }: { mode: Mode }) {
  return (
    <p className="mt-3 text-[13px] text-[#86868b]">
      {mode === 'deep'
        ? '将启动逐节点评审流程 · 按评审环节逐一核验'
        : '聚焦清晰度与关键缺口的快速评审'}
    </p>
  );
}

/* 知识库背书 + 雷区警示榜 */
function KbFooter() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-10 w-full max-w-3xl no-print">
      <div className="mx-auto flex max-w-xl flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[12px] text-[#c7c7cc]">
        <span className="inline-flex items-center gap-1.5">
          <BookOpen className="h-3.5 w-3.5" />评审规则库
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5" />往届案例库
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Fingerprint className="h-3.5 w-3.5" />能力边界库
        </span>
        <span>| 已收录案例 {PAST_CASES.length}+ · 规则 {RULE_COUNT} 条 · 边界 {BOUNDARY_COUNT} 项</span>
      </div>

      <div className="mx-auto mt-4 max-w-xl">
        <button
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[12px] text-[#86868b] transition-colors hover:text-[#1d1d1f]"
        >
          <CircleAlert className="h-3.5 w-3.5 text-[#e8a33d]" />
          雷区警示榜
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <>
            <button
              onClick={() => setOpen(false)}
              aria-label="收起雷区警示榜"
              className="no-print fixed right-6 top-6 z-50 flex h-11 w-11 items-center justify-center rounded-full border border-[#ececf0] bg-white text-[#86868b] shadow-[0_4px_24px_rgba(0,0,0,0.12)] transition-all hover:scale-105 hover:text-[#1d1d1f]"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="fade-in mt-1 grid gap-2 rounded-[16px] border border-[#f0f0f2] bg-[#fbfbfd] p-4 text-left">
              <p className="text-[12px] text-[#86868b]">
                以下方向在往届科创赛中已高度饱和，直接做容易撞车，需要差异化。
              </p>
            {RED_SEA_CASES.map((c) => (
              <div
                key={c.id}
                className="rounded-xl border border-[#f0f0f2] bg-white px-4 py-3 shadow-[0_2px_10px_rgba(0,0,0,0.03)]"
              >
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[11px] font-medium" style={{ background: 'rgba(232,163,61,0.14)', color: '#B45309' }}>
                    {c.sea_status === '红海' ? '红海' : '拥挤'} · {c.innovation_tags}
                  </span>
                  <span className="text-[13px] font-semibold text-[#1d1d1f]">{c.project_name}</span>
                </div>
                <p className="mt-1 text-[12.5px] leading-5 text-[#86868b]">
                  差异化建议：{c.differentiation_hint}
                </p>
              </div>
            ))}
            </div>
            </>
        )}
      </div>
    </div>
  );
}

/* ==================== 第二幕+第三幕：对话与报告 ==================== */
function ChatStage({
  mode,
  messages,
  loading,
  stages,
  phaseLabel,
  phaseDone,
  finished,
  elapsedSec,
  streamText,
  scrollRef,
  input,
  onInput,
  onSend,
  onPick,
}: {
  mode: Mode;
  messages: ChatMsg[];
  loading: boolean;
  stages: RStage[];
  phaseLabel: string;
  phaseDone: boolean;
  finished: boolean;
  elapsedSec: number;
  streamText: string;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  input: string;
  onInput: (v: string) => void;
  onSend: () => void;
  onPick: (t: string) => void;
}) {
  const replying = loading && mode === 'deep';
  return (
    <>
      <div
        ref={scrollRef}
        data-chat-scroll
        className="no-print mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 overflow-y-auto px-5 py-6 sm:px-6"
      >
        {messages.map((m) => (
          <MessageRow key={m.id} msg={m} onPick={onPick} />
        ))}

        {loading && <div className="scale-in">{replying ? <DeepReviewPanel stages={stages} finished={finished} elapsedSec={elapsedSec} /> : <QuickReview phaseLabel={phaseLabel} streamText={streamText} finished={finished} elapsedSec={elapsedSec} />}</div>}
        {loading && !replying && !streamText && !finished && <TypingIndicator label={phaseLabel} />}
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
          <ReportView
            content={msg.content}
            mode={msg.mode}
            checklist={msg.checklist}
            sourceTags={msg.source_tags}
          />
          <div className="no-print mt-5 flex flex-col items-center gap-2">
            <div className="text-[12px] font-medium text-[#86868b]">{NEXT_LABEL}</div>
            <div className="flex flex-wrap justify-center gap-2.5">
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
      </div>
    );
  }

  // 追问诊断卡片
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
            {msg.mode === 'deep' ? '🔬 深度论证' : '⚡ 快速预诊'}
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

/* ---------- 深度论证：评审日志面板（真实环节逐个点亮） ---------- */
function DeepReviewPanel({
  stages,
  finished,
  elapsedSec,
}: {
  stages: RStage[];
  finished: boolean;
  elapsedSec: number;
}) {
  if (finished) {
    return (
      <div className="mx-auto max-w-md rounded-[16px] border border-[#f0f0f2] bg-[#fbfbfd] px-5 py-3.5 text-[13px] text-[#86868b]">
        <span className="inline-flex items-center gap-2">
          <Check className="h-4 w-4 text-[#0071e3]" />
          深度论证完成 · 已完成评审检查 · 用时 {elapsedSec} 秒
        </span>
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-md rounded-[16px] border border-[#f0f0f2] bg-white p-5 shadow-[0_4px_24px_rgba(0,0,0,0.06)]">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-[#1d1d1f]">
        <span className="review-pulse -ml-1 inline-block h-2 w-2 rounded-full bg-[#0071e3]" />
        深度论证进行中
      </div>
      <div className="mt-4 space-y-1.5">
        {stages.map((s, i) => (
          <div key={i} className="flex items-center gap-2.5 text-[13px]">
            {s.status === 'done' ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#2EA043]" />
            ) : s.status === 'active' ? (
              <span className="review-pulse h-3.5 w-3.5 shrink-0 rounded-full border-2 border-[#0071e3] bg-transparent" />
            ) : (
              <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-[#d8d8dd]" />
            )}
            <span
              className="min-w-0 truncate"
              style={{
                color: s.status === 'done' ? '#86868b' : s.status === 'active' ? '#0071e3' : '#c7c7cc',
                fontWeight: s.status === 'active' ? 600 : 400,
              }}
            >
              {s.label}
            </span>
            <span className="ml-auto shrink-0 text-[11px] text-[#c7c7cc]"> {s.desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- 快速预诊：阶段阶段感 + 报告打字机 ---------- */
function QuickReview({
  phaseLabel,
  streamText,
  finished,
  elapsedSec,
}: {
  phaseLabel: string;
  streamText: string;
  finished: boolean;
  elapsedSec: number;
}) {
  if (finished) {
    return (
      <div className="mx-auto max-w-md rounded-[16px] border border-[#f0f0f2] bg-[#fbfbfd] px-5 py-3.5 text-[13px] text-[#86868b]">
        <span className="inline-flex items-center gap-2">
          <Check className="h-4 w-4 text-[#0071e3]" />
          预诊 + 拆解完成 · 用时 {elapsedSec} 秒
        </span>
      </div>
    );
  }
  if (streamText) {
    return (
      <div className="flex w-full justify-start">
        <div className="max-w-[88%] rounded-2xl rounded-bl-sm border border-[#f0f0f2] bg-[#f5f5f7] px-4 py-3 text-[15px] leading-7 text-[#1d1d1f]">
          {streamText}
          <span className="review-caret ml-0.5 inline-block h-4 w-[2px] translate-y-[2px] bg-[#0071e3]" />
        </div>
      </div>
    );
  }
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-[#f0f0f2] bg-white px-4 py-2 text-[12.5px] text-[#86868b]">
      <span className="review-pulse -ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-[#0071e3]" />
      {phaseLabel || '快速预诊中…'}
    </div>
  );
}

function TypingIndicator({ label }: { label: string }) {
  return (
    <div className="flex w-full flex-col items-start gap-1.5">
      <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm bg-[#f5f5f7] px-4 py-3">
        <span className="dot h-1.5 w-1.5 rounded-full bg-[#86868b]" />
        <span className="dot h-1.5 w-1.5 rounded-full bg-[#86868b]" />
        <span className="dot h-1.5 w-1.5 rounded-full bg-[#86868b]" />
      </div>
      {label ? <span className="text-[11.5px] text-[#c7c7cc]">{label}</span> : null}
    </div>
  );
}