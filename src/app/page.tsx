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
  Brain,
  History,
  MessageCircleQuestion,
  Swords,
  GitBranch,
  ListChecks,
  ShieldAlert,
} from 'lucide-react';
import { ReportView, type ReviewItem, type PlagiarismHint, type EvidenceRef } from '@/components/ReportView';
import type { StructuredReport, ClarifyQuestion } from '@/lib/deepChain';
import { DiagnosisCard, type DiagnosticOption } from '@/components/DiagnosisCard';
import { ReportSkeleton } from '@/components/Skeleton';
import { useReveal } from '@/lib/useReveal';
import KnowledgeDrawer from '@/components/KnowledgeDrawer';
import GlassCard from '@/components/GlassCard';
import OrbitRing, { ORBIT_FEATURES, type OrbitFeature } from '@/components/OrbitRing';
import HistoryDrawer from '@/components/HistoryDrawer';
import Toast from '@/components/Toast';
import { addHistory, type HistoryEntry } from '@/lib/history';
import kbCasesData from '@/data/knowledge/cases.json';
import kbRulesData from '@/data/knowledge/rules.json';
import kbBoundariesData from '@/data/knowledge/boundaries.json';

type Mode = 'quick' | 'deep';
type View = 'hero' | 'chat';

interface ThinkingView {
  view: string;
  viewName: string;
  text: string;
  done: boolean;
}

interface ChatMsg {
  id: string;
  role: 'user' | 'ai' | 'system';
  report?: boolean;
  mode?: Mode;
  content: string;
  clarity?: number;
  category?: string;
  ack?: string;
  clarity_desc?: string;
  missing_info?: string[];
  options?: DiagnosticOption[];
  checklist?: ReviewItem[];
  source_tags?: string[];
  plagiarism?: PlagiarismHint | null;
  evidence?: EvidenceRef[];
  structured?: StructuredReport | null;
  clarifications?: ClarifyQuestion[];
  notice?: string;
  phases?: RStage[];
  thinking?: ThinkingView[];
  thinkingMeta?: { chars: number; sec: number };
  scene?: string;
  time: number;
}

interface RStage {
  label: string;
  desc: string;
  status: 'pending' | 'active' | 'done';
  elapsedMs?: number;
}

const MSG_KEY = 'req-decomposer:messages:v3';
const SID_KEY = 'req-decomposer:session:v2';
const MODE_KEY = 'req-decomposer:mode:v1';

const SCENES = ['科创赛诊断', '社团策划', '学习规划', '内容创作'];
const SUGGESTIONS = ['我想做一个校园二手交易平台', '帮我拆解老人防走丢手环的创意', '做一款帮助考研人打卡的应用'];
const NEXT_LABEL = '下一步，你可以：';
const NEXT_OPTIONS = [
  'A. 帮我把第一步做出来',
  'B. 帮我评估时间和成本',
  'C. 我想调整一下方向',
];

/** 深度论证：五阶段（与后端 DEEP_PHASES 一致） */
const DEEP_PHASES_UI: { label: string; desc: string }[] = [
  { label: '需求诊断', desc: '评估清晰度、识别场景、列出缺失关键信息' },
  { label: '多视角论证', desc: '创新性 / 科学性与可行性 / 应用价值与红海风险 三路并行' },
  { label: '评委质询', desc: '评委视角质询能力边界、工作量真实性与答辩风险' },
  { label: '报告整合', desc: '整合诊断、论证与质询，生成结构化报告' },
  { label: '检查清单', desc: '生成 14 项评审检查清单' },
];

/** 深度论证降级：评审环节（与后端 REVIEW_STAGES 一致的默认环节） */
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

interface KbCase {
  id: string;
  name: string;
  domain: string;
  result: string;
  seaStatus: string;
  redSea: string;
  differentiation: string;
  keywords?: string[];
  note?: string;
}
interface KbRule {
  id: string;
  dimension: string;
  content: string;
  weight: string;
  deduction: string;
  keywords?: string[];
}
interface KbBoundary {
  id: string;
  item: string;
  safe: boolean;
  risk: string;
  fallback: string;
  keywords?: string[];
}
const KB_CASES = kbCasesData as KbCase[];
const KB_RULES = kbRulesData as KbRule[];
const KB_BOUNDARIES = kbBoundariesData as KbBoundary[];
const RED_SEA_CASES = KB_CASES.filter((c) => c.seaStatus === '红海' || c.seaStatus === '拥挤');

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
  // 深度思考摘录（reasoning_delta 实时拼接）
  const [thinking, setThinking] = useState<ThinkingView[]>([]);
  const [thinkingDone, setThinkingDone] = useState(false);
  const [thinkingSec, setThinkingSec] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const streamAccRef = useRef('');
  const finishedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const thinkingRef = useRef<ThinkingView[]>([]);
  const stagesRef = useRef<RStage[]>([]);
  const lastInputRef = useRef('');
  const [histOpen, setHistOpen] = useState(false);

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

  // 进行中阶段的实时推理摘要（取最新思考流的末尾）
  const liveNote = (() => {
    const last = thinking[thinking.length - 1];
    if (!last || finished) return '';
    const t = last.text.replace(/\s+/g, ' ').trim();
    return t.length > 110 ? `…${t.slice(-110)}` : t;
  })();

  const scrollToBottom = useCallback(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, []);
  useEffect(() => {
    if (hydrated) scrollToBottom();
  }, [messages, loading, streamText, hydrated, scrollToBottom]);
  useReveal([view, hydrated, loading]);

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
    thinkingRef.current = [];
    if (mode === 'deep') {
      const arr = DEEP_PHASES_UI.map((s) => ({ ...s, status: 'pending' as const }));
      stagesRef.current = arr;
      setStages(arr);
    } else {
      const arr: RStage[] = [
        { label: '清晰度评估', desc: '判断需求清晰度', status: 'pending' },
        { label: '生成整改方案', desc: '撰写拆解报告与评审检查', status: 'pending' },
      ];
      stagesRef.current = arr;
      setStages(arr);
    }
    setPhaseLabel(mode === 'deep' ? '评审团正在多视角论证中…' : '快速预诊中：清晰度评估');
    setPhaseDone(false);
    setStreamText('');
    setFinished(false);
    setElapsedSec(0);
    setThinking([]);
    setThinkingDone(false);
    setThinkingSec(0);
  }

  function applyPhase(ev: { phase_id?: string; phase_name?: string; detail?: string; elapsed_ms?: number; end?: boolean }) {
    const name = ev.phase_name ?? '';
    setStages((prev) => {
      const idx = prev.findIndex((s) => s.label === name);
      let arr = prev;
      if (idx >= 0) {
        arr = [...prev];
        arr[idx] = ev.end
          ? { ...arr[idx], status: 'done', elapsedMs: ev.elapsed_ms }
          : { ...arr[idx], status: 'active', desc: ev.detail ?? arr[idx].desc };
      } else {
        const ns: RStage = ev.end
          ? { label: name, desc: ev.detail ?? '', status: 'done', elapsedMs: ev.elapsed_ms }
          : { label: name, desc: ev.detail ?? '', status: 'active' };
        arr = [...prev, ns];
      }
      stagesRef.current = arr;
      return arr;
    });
    if (!ev.end && name) setPhaseLabel(`${name}中`);
  }

  function applyReasoning(ev: { view?: string; view_name?: string; text?: string }) {
    const delta = ev.text;
    if (!delta) return;
    const key = ev.view || 'grill';
    setThinking((prev) => {
      const idx = prev.findIndex((t) => t.view === key);
      if (idx >= 0) {
        const arr = [...prev];
        arr[idx] = { ...arr[idx], text: arr[idx].text + delta };
        thinkingRef.current = arr;
        return arr;
      }
      const arr = [...prev, { view: key, viewName: ev.view_name ?? (key === 'grill' ? '评委质询' : key), text: delta, done: false }];
      thinkingRef.current = arr;
      return arr;
    });
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
      stagesRef.current = arr;
      return arr;
    });
  }

  function commitResult(d: Record<string, unknown>, startedAt: number) {
    const isSolution = d.type === 'solution';
    const aiMode: Mode = d.mode === 'deep' ? 'deep' : 'quick';
    const acc = streamAccRef.current;
    const content =
      isSolution && acc ? acc : (d.content as string) ?? '';
    const tViews = thinkingRef.current.map((t) => ({ ...t }));
    const tChars = tViews.reduce((n, t) => n + t.text.length, 0);
    const tSec = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    const msg: ChatMsg = {
      id: makeId(),
      role: 'ai',
      report: isSolution,
      mode: aiMode,
      content,
      clarity: typeof d.clarity === 'number' ? d.clarity : undefined,
      category: typeof d.category === 'string' ? d.category : undefined,
      ack: typeof d.ack === 'string' && d.ack.trim() ? d.ack.trim() : undefined,
      clarity_desc: typeof d.clarity_desc === 'string' ? d.clarity_desc : undefined,
      missing_info: d.missing_info as string[] | undefined,
      options: d.options as ChatMsg['options'],
      checklist: d.checklist as ChatMsg['checklist'],
      source_tags: d.source_tags as string[] | undefined,
      plagiarism: d.plagiarism as ChatMsg['plagiarism'],
      evidence: d.evidence as ChatMsg['evidence'],
      structured: d.structured as ChatMsg['structured'],
      clarifications: d.clarifications as ChatMsg['clarifications'],
      notice: typeof d.notice === 'string' ? d.notice : undefined,
      phases: stagesRef.current,
      thinking: tViews.length ? tViews : undefined,
      thinkingMeta: tViews.length ? { chars: tChars, sec: tSec } : undefined,
      scene,
      time: Date.now(),
    };
    setMessages((prev) => [...prev, msg]);
    // 完成后收拢为摘要一行
    finishedRef.current = true;
    if (isSolution && content) {
      addHistory({
        mode: aiMode,
        scene,
        summary: (lastInputRef.current || content.slice(0, 60)).slice(0, 80),
        clarity: msg.clarity,
        category: msg.category,
        content,
        checklist: msg.checklist,
        source_tags: msg.source_tags,
        plagiarism: msg.plagiarism,
        evidence: msg.evidence,
      });
    }
    setElapsedSec(Math.max(1, Math.round((Date.now() - startedAt) / 1000)));
    setFinished(true);
    setPhaseDone(true);
    setStreamText('');
    setThinkingDone(true);
    setThinkingSec(tSec);
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
    lastInputRef.current = value;
    if (view === 'hero') setView('chat');

    setMessages((prev) => [...prev, { id: makeId(), role: 'user', content: value, time: Date.now() }]);
    setLoading(true);
    resetProgress();
    const startedAt = Date.now();

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch(mode === 'deep' ? '/api/deep-analysis' : '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: value, mode, scene, stream: true }),
        signal: ac.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const errData = data as { detail?: string; error?: string };
        if (res.status === 429) {
          pushSystem('发送得有点频繁啦～请等大约一分钟再继续，评审师正在整理思路 ☕');
        } else {
          pushSystem(`评审服务出错：${errData.detail || errData.error || '未知错误'}`);
        }
        return;
      }
      if (!res.body || !res.body.getReader) throw new Error('当前环境不支持流式连接');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      const handleEvent = (ev: Record<string, unknown>) => {
        if (!ev || typeof ev !== 'object') return;
        switch (ev.type) {
          case 'phase':
            if (typeof ev.label === 'string') setPhaseLabel(ev.label);
            if (ev.id === 'judge' && ev.done) setPhaseDone(true);
            break;
          case 'phase_start':
            applyPhase(ev);
            break;
          case 'phase_end':
            applyPhase({ ...ev, end: true });
            break;
          case 'phase_reset':
            resetProgress();
            break;
          case 'reasoning_delta':
            applyReasoning(ev);
            break;
          case 'node':
            applyNode(ev);
            break;
          case 'token':
          case 'content_delta':
            streamAccRef.current += ev.text ?? '';
            setStreamText(streamAccRef.current);
            break;
          case 'result':
            commitResult(ev.result as Record<string, unknown>, startedAt);
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
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(line.slice(6)) as Record<string, unknown>;
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
      if ((e as Error)?.name === 'AbortError') {
        // 用户主动停止：保留已完成阶段与已流式内容
        const partial = streamAccRef.current.trim();
        if (partial) {
          setMessages((prev) => [
            ...prev,
            {
              id: makeId(),
              role: 'ai',
              report: true,
              mode,
              content: partial,
              phases: stagesRef.current,
              thinking: thinkingRef.current.length ? thinkingRef.current.map((t) => ({ ...t })) : undefined,
              scene,
              time: Date.now(),
            },
          ]);
        }
        pushSystem('论证已停止，已完成部分已保留。');
      } else {
        pushSystem(`网络异常或服务不可达：${(e as Error)?.message || '未知错误'}`);
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  }

  function stopAnalysis() {
    abortRef.current?.abort();
  }

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden text-[#1d1d1f]">
      {/* 液态极光背景 */}
      <div className="lg-aurora" />
      {/* 顶部极简导航 */}
      <nav className="app-nav glass no-print z-20 flex h-14 shrink-0 items-center justify-between border-b border-[#f0f0f2] px-5 sm:px-8">
        <button onClick={startNew} className="text-[17px] font-semibold tracking-tight">
          拆解
        </button>
        <div className="flex items-center gap-3">
          <ModeSwitch value={mode} onChange={setMode} />
          <button
            onClick={() => setHistOpen(true)}
            className="inline-flex items-center gap-1 rounded-full border border-[#e8e8ed] bg-white px-3 py-1.5 text-[13px] font-medium text-[#1d1d1f] transition-colors hover:bg-[#f5f5f7] active:bg-[#ececf0]"
          >
            <History className="h-3.5 w-3.5" />
            历史
          </button>
          <button
            onClick={startNew}
            className="inline-flex items-center gap-1 rounded-full bg-[#0071e3] px-3.5 py-1.5 text-[13px] font-medium text-white transition-opacity hover:opacity-85"
          >
            <Plus className="h-3.5 w-3.5" />
            新需求
          </button>
        </div>
      </nav>

      {histOpen && <HistoryDrawer onClose={() => setHistOpen(false)} />}
      <Toast />

      {view === 'hero' ? (
        <HeroStage
          mode={mode}
          scene={scene}
          onScene={setScene}
          input={input}
          onInput={setInput}
          onSend={() => handleSend()}
          onFill={(t) => handleSend(t)}
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
          thinking={thinking}
          thinkingDone={thinkingDone}
          thinkingSec={thinkingSec}
          liveNote={liveNote}
          scrollRef={scrollRef}
          input={input}
          onInput={setInput}
          onSend={() => handleSend()}
          onPick={handleSend}
          onStop={stopAnalysis}
          onNew={startNew}
          onHistory={() => setHistOpen(true)}
        />
      )}
    </div>
  );
}

/* ==================== 模式分段开关 ==================== */
function ModeSwitch({ value, onChange }: { value: Mode; onChange: (m: Mode) => void }) {
  const opts = [
    { k: 'quick', label: '⚡ 快速预诊' },
    { k: 'deep', label: '🔬 深度论证' },
  ] as const;
  const idx = value === 'deep' ? 1 : 0;
  return (
    <div className="lg-pill relative flex items-center rounded-full p-[3px]">
      {/* 果冻滑块：弹簧曲线滑动 */}
      <span
        aria-hidden
        className="absolute bottom-[3px] left-[3px] top-[3px] rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.14)]"
        style={{
          width: 'calc(50% - 3px)',
          transform: `translateX(${idx * 100}%)`,
          transition: 'transform 380ms var(--spring)',
        }}
      />
      {opts.map((it) => {
        const active = value === it.k;
        return (
          <button
            key={it.k}
            onClick={() => onChange(it.k)}
            className={`relative z-10 flex-1 whitespace-nowrap rounded-full px-3.5 py-1 text-[12.5px] transition-colors duration-300 ${
              active ? 'font-semibold text-[#1d1d1f]' : 'text-[#86868b] hover:text-[#1d1d1f]'
            }`}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

/* ==================== 第一幕：首屏 ==================== */
const HERO_EXAMPLES = [
  '我想做一个智能垃圾分类桶，帮社区自动识别垃圾种类',
  '校园二手书交易小程序，学生扫码即可发布和购买',
  '基于 AI 的背单词 App，根据遗忘曲线自动安排复习',
];

function HeroStage({
  mode,
  scene,
  onScene,
  input,
  onInput,
  onSend,
  onFill,
}: {
  mode: Mode;
  scene: string;
  onScene: (s: string) => void;
  input: string;
  onInput: (v: string) => void;
  onSend: () => void;
  onFill: (t: string) => void;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [openFeat, setOpenFeat] = useState<OrbitFeature | null>(null);
  const [kbOpen, setKbOpen] = useState(false);
  const [inspOpen, setInspOpen] = useState(false); // 案例灵感面板：点击也可展开/收起

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenFeat(null);
        setKbOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleOrbitItem = (f: OrbitFeature) => {
    if (f.id === 'kb') setKbOpen(true);
    else setOpenFeat(f);
  };

  return (
    <div className="fade-in relative z-10 flex flex-1 flex-col overflow-y-auto px-4 sm:px-6 lg:overflow-hidden">
      {/* 顶部标题区（不遮挡主体） */}
      <div className="pointer-events-none relative z-20 mx-auto w-full max-w-7xl pt-1.5 text-center">
        <div className="mono-tag">NEED DECOMPOSER</div>
        <h1 className="mt-1 text-[19px] font-bold tracking-tight sm:text-[23px]">
          像评委一样，审视你的每一个项目想法
        </h1>
        <p className="mt-0.5 text-[12px] text-[#86868b] sm:text-[12.5px]">
          输入项目创意，先问后拆，按科创赛评审标准逐项核验，出整改行动方案
        </p>
      </div>

      <div className="relative mx-auto flex w-full max-w-7xl flex-1 flex-col items-center justify-center lg:min-h-0">
        {/* 中央玻璃球体（装饰） */}
        <div className="lg-sphere" />

        {/* 星环：功能卡绕球旋转，拖拽流转 */}
        <div className="absolute inset-0 z-10 hidden lg:block">
          <OrbitRing onItem={handleOrbitItem} />
        </div>

        {/* 中央主功能：只保留场景标签 + 输入（尺寸贴合球体） */}
        <div className="pointer-events-none relative z-20 flex w-full max-w-[336px] flex-col items-center text-center">
          <button
            onClick={() => onScene('科创赛诊断')}
            className="lg-pill pointer-events-auto mb-2.5 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1 text-[12px] font-medium text-[#0071e3]"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            科创赛诊断
          </button>

          <div className="lg-input pointer-events-auto w-full p-2">
            <textarea
              ref={taRef}
              value={input}
              onChange={(e) => onInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onSend();
                }
              }}
              rows={2}
              maxLength={2000}
              placeholder="输入你的项目想法，越具体越好…"
              className="w-full resize-none bg-transparent px-2 py-1 text-[13.5px] leading-5 text-[#1d1d1f] outline-none placeholder:text-[#c7c7cc]"
            />
            <div className="flex items-center justify-between px-1.5 pb-0.5">
              <span className="text-[10.5px] tabular-nums text-[#c7c7cc]">{input.length}/2000</span>
              <button
                onClick={onSend}
                disabled={!input.trim()}
                className="jelly inline-flex items-center gap-1 rounded-full bg-[#0071e3] px-3.5 py-1 text-[12.5px] font-medium text-white shadow-[0_6px_18px_rgba(0,113,227,0.35)] transition-all duration-200 hover:bg-[#0077ed] disabled:cursor-not-allowed disabled:opacity-30 disabled:shadow-none"
                aria-label="开始评审"
              >
                <Send className="h-3 w-3" />
                开始评审
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 右下角：案例灵感 + 模式说明（悬停阻尼展开，移开折叠） */}
      <div className="absolute bottom-4 right-5 z-30 hidden lg:block">
        <div className="group lg-pill rounded-2xl shadow-[0_8px_28px_rgba(31,41,55,0.10)]">
          <button
            onClick={() => setInspOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-2 px-3.5 py-2 text-[12px] font-medium text-[#1d1d1f]"
          >
            <span className="inline-flex items-center gap-1.5">
              <Brain className="h-3.5 w-3.5 text-[#0071e3]" />
              案例灵感
            </span>
            <ChevronDown
              className={`h-3.5 w-3.5 text-[#86868b] transition-transform duration-500 group-hover:rotate-180 ${inspOpen ? 'rotate-180' : ''}`}
              style={{ transitionTimingFunction: 'var(--spring)' }}
            />
          </button>
          <div
            className={`max-h-0 overflow-hidden px-3 opacity-0 transition-all duration-500 group-hover:max-h-64 group-hover:opacity-100 group-hover:pb-3 ${inspOpen ? 'max-h-64 pb-3 opacity-100' : ''}`}
            style={{ transitionTimingFunction: 'var(--damp)' }}
          >
            <div className="flex flex-col items-start gap-1.5">
              {HERO_EXAMPLES.map((t) => (
                <button
                  key={t}
                  onClick={() => onFill(t)}
                  className="jelly w-full rounded-xl border border-white/70 bg-white/60 px-2.5 py-1.5 text-left text-[11.5px] leading-snug text-[#6e6e73] transition-colors hover:text-[#0071e3]"
                >
                  {t}
                </button>
              ))}
            </div>
            <p className="mt-2.5 border-t border-[#e8e8ed]/60 pt-2 text-left text-[11px] leading-relaxed text-[#86868b]">
              {mode === 'deep' ? '🔬 深度论证：约 30-60 秒，评审团多视角核验' : '⚡ 快速预诊：聚焦清晰度与关键缺口的快速评审'}
            </p>
          </div>
        </div>
      </div>

      {/* 移动端：横滑卡片条 */}
      <div className="mt-4 flex gap-3 overflow-x-auto pb-1 lg:hidden">
        {ORBIT_FEATURES.map((f) => (
          <OrbitCard key={f.id} f={f} onOpen={() => handleOrbitItem(f)} />
        ))}
      </div>

      {/* 功能详情弹窗 */}
      {openFeat && <FeatureModal feature={openFeat} onClose={() => setOpenFeat(null)} />}
      {kbOpen && <KnowledgeDrawer onClose={() => setKbOpen(false)} />}
    </div>
  );
}

function OrbitCard({ f, onOpen, compact }: { f: OrbitFeature; onOpen: () => void; compact?: boolean }) {
  return (
    <GlassCard
      className={`bento cursor-pointer select-none ${compact ? 'w-44 shrink-0 !p-4' : '!p-4.5'}`}
      tilt={5}
      scale={1.05}
      onClick={onOpen}
    >
      <div className="flex items-center gap-2.5">
        <div
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: `${f.accent}14`, boxShadow: `inset 0 0 0 1px ${f.accent}22` }}
        >
          <f.icon className="h-4.5 w-4.5" style={{ color: f.accent }} strokeWidth={1.8} />
        </div>
        <div className="min-w-0">
          <div className="mono-tag">{f.tag}</div>
          <h4 className="truncate text-[14.5px] font-semibold text-[#1d1d1f]">{f.title}</h4>
        </div>
      </div>
      <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-[#6e6e73]">{f.desc}</p>
    </GlassCard>
  );
}

function FeatureModal({ feature, onClose }: { feature: OrbitFeature; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-5" role="dialog" aria-modal="true">
      {/* 遮罩：点击窗外退出 */}
      <div className="fade-in absolute inset-0 bg-[#1d1d1f]/25 backdrop-blur-[6px]" onClick={onClose} />
      <div className="relative w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <GlassCard className="p-7 sm:p-8" tilt={0} scale={1}>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="jelly absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full text-[#86868b] transition-all hover:bg-black/5 hover:text-[#1d1d1f]"
          >
            <X className="h-4.5 w-4.5" />
          </button>
          <div
            className="inline-flex h-12 w-12 items-center justify-center rounded-2xl"
            style={{ backgroundColor: `${feature.accent}14`, boxShadow: `inset 0 0 0 1px ${feature.accent}22` }}
          >
            <feature.icon className="h-6 w-6" style={{ color: feature.accent }} strokeWidth={1.8} />
          </div>
          <div className="mono-tag mt-4">{feature.tag}</div>
          <h3 className="mt-1 text-xl font-bold tracking-tight text-[#1d1d1f]">{feature.title}</h3>
          <p className="mt-2.5 text-[14px] leading-relaxed text-[#6e6e73]">{feature.desc}</p>
          <ul className="mt-4 space-y-2.5">
            {feature.points.map((pt) => (
              <li key={pt} className="flex items-start gap-2 text-[13.5px] text-[#3a3a3e]">
                <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: feature.accent }} strokeWidth={2.2} />
                {pt}
              </li>
            ))}
          </ul>
        </GlassCard>
      </div>
    </div>
  );
}

function ModeTip({ mode }: { mode: Mode }) {
  return (
    <p className="mt-3 text-[13px] text-[#86868b]">
      {mode === 'deep' ? '🔬 开始深度论证（约30-60秒）· 评审团将多视角核验' : '聚焦清晰度与关键缺口的快速评审'}
    </p>
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
  thinking,
  thinkingDone,
  thinkingSec,
  liveNote,
  scrollRef,
  input,
  onInput,
  onSend,
  onPick,
  onStop,
  onNew,
  onHistory,
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
  thinking: ThinkingView[];
  thinkingDone: boolean;
  thinkingSec: number;
  liveNote: string;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  input: string;
  onInput: (v: string) => void;
  onSend: () => void;
  onPick: (t: string) => void;
  onStop: () => void;
  onNew: () => void;
  onHistory: () => void;
}) {
  const [confirmExit, setConfirmExit] = useState(false);
  const replying = loading && mode === 'deep';
  const chatTaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = chatTaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [input]);
  return (
    <>
    <div className="no-print fixed inset-0 z-40 flex items-center justify-center bg-[#1d1d1f]/15 p-8 backdrop-blur-[6px] sm:p-10">
      <div
        className="lg-card modal-pop flex h-full max-h-[calc(100vh-80px)] w-full max-w-[760px] flex-col overflow-hidden"
        style={{ background: 'rgba(251, 251, 253, 0.92)' }}
      >
        {/* 窗口头：对话式游戏标题栏 */}
        <div className="flex shrink-0 items-center justify-between border-b border-white/70 px-5 py-3">
          <div className="flex items-center gap-2.5">
            <div
              className="inline-flex h-8 w-8 items-center justify-center rounded-xl"
              style={{ background: 'rgba(0,113,227,0.10)', boxShadow: 'inset 0 0 0 1px rgba(0,113,227,0.18)' }}
            >
              <Brain className="h-4 w-4 text-[#0071e3]" />
            </div>
            <div className="text-left">
              <div className="text-[14px] font-semibold leading-tight text-[#1d1d1f]">拆解师 · 评审对话</div>
              <div className="text-[10.5px] text-[#86868b]">{mode === 'deep' ? '🔬 深度论证 · 评审团多视角' : '⚡ 快速预诊'}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onHistory} className="jelly lg-pill rounded-full px-3 py-1 text-[12px] text-[#1d1d1f]">
              历史
            </button>
            <button
              onClick={onNew}
              className="jelly rounded-full bg-[#0071e3] px-3 py-1 text-[12px] font-medium text-white shadow-[0_4px_14px_rgba(0,113,227,0.3)] transition-all hover:bg-[#0077ed]"
            >
              ＋ 新需求
            </button>
            <button
              onClick={() => setConfirmExit(true)}
              aria-label="退出评审"
              className="jelly inline-flex h-7 w-7 items-center justify-center rounded-full text-[#86868b] transition-colors hover:bg-[#ffeceb] hover:text-[#e5484d]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div
          ref={scrollRef}
          data-chat-scroll
          className="flex min-h-0 w-full flex-1 flex-col gap-5 overflow-y-auto px-5 py-5 sm:px-6"
        >
        {messages.map((m) => (
          <MessageRow key={m.id} msg={m} onPick={onPick} />
        ))}

        {loading && (
          <div className="scale-in flex flex-col items-center gap-3">
            {replying ? (
              <>
                <DeepReviewPanel stages={stages} finished={finished} elapsedSec={elapsedSec} liveNote={liveNote} />
                <DeepThinkingPanel views={thinking} done={thinkingDone} sec={thinkingSec} live={!finished} />
                {!finished && (
                  <button
                    onClick={onStop}
                    className="rounded-full border border-[#e8e8ed] bg-white px-4 py-1.5 text-[12.5px] text-[#86868b] transition-colors hover:border-[#d8d8dd] hover:text-[#1d1d1f]"
                  >
                    停止论证
                  </button>
                )}
              </>
            ) : (
              <QuickReview phaseLabel={phaseLabel} streamText={streamText} finished={finished} elapsedSec={elapsedSec} />
            )}
          </div>
        )}
        {loading && !replying && !streamText && !finished && (
          <div className="mx-auto w-full max-w-md space-y-3">
            <div className="flex justify-center">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#f0f0f2] bg-white px-4 py-2 text-[12.5px] text-[#86868b]">
                <span className="review-pulse inline-block h-1.5 w-1.5 rounded-full bg-[#0071e3]" />
                {phaseLabel || '快速预诊中…'}
              </div>
            </div>
            <ReportSkeleton />
          </div>
        )}
      </div>

      {/* 底部输入 */}
      <div className="no-print shrink-0 border-t border-white/70 px-5 pb-3 pt-3 sm:px-6">
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
          <div className="flex items-end gap-2 rounded-[20px] border border-[#d8d8dd] bg-white px-4 py-2 shadow-[0_4px_24px_rgba(0,0,0,0.04)] transition-all focus-within:border-[#0071e3]">
            <textarea
              ref={chatTaRef}
              value={input}
              onChange={(e) => onInput(e.target.value)}
              onFocus={(e) => {
                // 软键盘弹出时确保输入框可见
                setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onSend();
                }
              }}
              rows={1}
              maxLength={2000}
              placeholder="继续输入…（回车发送）"
              className="min-h-9 flex-1 resize-none bg-transparent py-1.5 text-[15px] leading-6 text-[#1d1d1f] outline-none placeholder:text-[#c7c7cc]"
            />
            <span className="pb-2 text-[11px] tabular-nums text-[#c7c7cc]">{input.length}/2000</span>
            <button
              onClick={onSend}
              disabled={!input.trim() || loading}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#0071e3] text-white transition-opacity hover:opacity-85 active:opacity-70 disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="发送"
            >
              {loading ? (
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </div>
      </div>
    </div>

      {/* 退出确认：玻璃小弹窗，外面模糊；不是=左(笑脸) 是的=右(哭脸) */}
      {confirmExit && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-[#1d1d1f]/20 p-6 backdrop-blur-[6px]"
          onClick={() => setConfirmExit(false)}
        >
          <div
            className="lg-card modal-pop w-full max-w-[340px] p-6 text-center"
            style={{ background: 'rgba(251, 251, 253, 0.92)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[15px] font-semibold text-[#1d1d1f]">退出评审？</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[#86868b]">
              退出后将不保存本次评审进度
            </p>
            <div className="mt-5 flex items-center justify-center gap-3">
              {/* 不是（左）→ 笑脸 */}
              <div className="group relative">
                <span
                  className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-full bg-white/95 px-3 py-1 text-[13px] text-[#34C759] shadow-[0_4px_14px_rgba(0,0,0,0.12)] opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100"
                  style={{ transitionTimingFunction: 'var(--spring)' }}
                >
                  (´▽`) 一起拆完吧！
                </span>
                <button
                  onClick={() => setConfirmExit(false)}
                  className="jelly rounded-full border border-[#e8e8ed] bg-white/80 px-5 py-2 text-[13.5px] font-medium text-[#1d1d1f] transition-colors hover:bg-white"
                >
                  不是
                </button>
              </div>
              {/* 是的（右）→ 哭脸 */}
              <div className="group relative">
                <span
                  className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-full bg-white/95 px-3 py-1 text-[13px] text-[#e5484d] shadow-[0_4px_14px_rgba(0,0,0,0.12)] opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100"
                  style={{ transitionTimingFunction: 'var(--spring)' }}
                >
                  (╥﹏╥) 进度会没掉的…
                </span>
                <button
                  onClick={() => {
                    setConfirmExit(false);
                    onNew();
                  }}
                  className="jelly rounded-full bg-[#e5484d] px-5 py-2 text-[13.5px] font-medium text-white transition-colors hover:bg-[#d93a3f]"
                >
                  是的，退出
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function AiAvatar() {
  return (
    <div
      className="no-print inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
      style={{ background: 'rgba(0,113,227,0.10)', boxShadow: 'inset 0 0 0 1px rgba(0,113,227,0.18)' }}
    >
      <Brain className="h-4 w-4 text-[#0071e3]" />
    </div>
  );
}

function UserAvatar() {
  return (
    <div className="no-print inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/85 text-[12px] font-semibold text-[#0071e3] shadow-[inset_0_0_0_1px_rgba(0,113,227,0.18)]">
      我
    </div>
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
          {msg.notice && (
            <div className="mb-3 rounded-[12px] bg-[#f5f5f7] px-4 py-2.5 text-[12px] leading-5 text-[#86868b]">
              {msg.notice}
            </div>
          )}
          {msg.phases?.length || msg.thinking?.length ? <ReplayBar msg={msg} /> : null}
          <ReportView
            content={msg.content}
            mode={msg.mode}
            checklist={msg.checklist}
            sourceTags={msg.source_tags}
            plagiarism={msg.plagiarism}
            evidence={msg.evidence}
            clarity={msg.clarity}
            scene={msg.scene}
            structured={msg.structured}
            clarifications={msg.clarifications}
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

  // 先问后拆：澄清问题卡（回答后进入完整论证）
  if (msg.role === 'ai' && !msg.report && msg.clarifications && msg.clarifications.length > 0) {
    return (
      <div className="flex w-full items-start justify-start gap-2">
        <AiAvatar />
        <div className="w-full max-w-[85%]">
          <div className="mb-1 text-[11px] font-medium text-[#86868b] no-print">🔬 深度论证 · 先问后拆</div>
          <div className="rounded-[20px] border border-[#e8e8ed] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_8px_28px_rgba(0,0,0,0.06)]">
            <p className="text-[15px] font-semibold text-[#1d1d1f]">开工前，先确认几个关键问题</p>
            <p className="mt-1 text-[12.5px] text-[#86868b]">回答后评审团将带着这些前提开始论证（也可以跳过）。</p>
            <ClarifyForm items={msg.clarifications} onSend={onPick} />
          </div>
        </div>
      </div>
    );
  }

  // 追问诊断卡片
  if (msg.role === 'ai' && !msg.report && msg.options && msg.options.length > 0) {
    return (
      <div className="flex w-full items-start justify-start gap-2">
        <AiAvatar />
        <div className="max-w-[85%]">
          {msg.notice && (
            <div className="mb-2 rounded-[12px] bg-[#f5f5f7] px-3.5 py-2 text-[12px] leading-5 text-[#86868b]">
              {msg.notice}
            </div>
          )}
          {/* 先像正常聊天一样回应，再进入追问卡片 */}
          {msg.ack && (
            <div className="mb-2 flex items-end gap-2">
              <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-[#f0f0f2] bg-[#f5f5f7] px-4 py-2.5 text-[15px] leading-7 text-[#1d1d1f]">
                {msg.ack}
              </div>
            </div>
          )}
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
      </div>
    );
  }

  return (
    <div className={`flex w-full items-end gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && <AiAvatar />}
      <div className={isUser ? 'max-w-[74%]' : 'flex max-w-[74%] flex-col items-start'}>
        {!isUser && (
          <div className="mb-1 text-[11px] font-medium text-[#86868b] no-print">
            {msg.mode === 'deep' ? '🔬 深度论证' : '⚡ 快速预诊'}
          </div>
        )}
        {!isUser && msg.notice && (
          <div className="mb-1.5 rounded-[12px] bg-[#f5f5f7] px-3.5 py-2 text-[12px] leading-5 text-[#86868b]">
            {msg.notice}
          </div>
        )}
        {!isUser && !msg.report && msg.ack && (
          <div className="mb-1.5 max-w-full rounded-2xl rounded-bl-sm border border-[#f0f0f2] bg-[#f5f5f7] px-4 py-2.5 text-[15px] leading-7 text-[#1d1d1f]">
            {msg.ack}
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
        {isUser && <UserAvatar />}
      </div>
    </div>
  );
}

/* ---------- 先问后拆：逐题对话（一次只问一题，像游戏选项一样推进） ---------- */
function ClarifyForm({ items, onSend }: { items: ClarifyQuestion[]; onSend: (t: string) => void }) {
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [typed, setTyped] = useState('');
  const last = idx === items.length - 1;
  const c = items[idx];

  const advance = (answer: string) => {
    const next = { ...answers, [idx]: answer };
    setAnswers(next);
    setTyped('');
    if (last) {
      const all = items
        .map((cc, i) => `${cc.q}\n我的回答：${(next[i] ?? '').trim() || '（未回答）'}`)
        .join('\n');
      onSend(`【澄清回答】\n${all}\n请基于以上回答开始完整深度论证。`);
    } else {
      setIdx(idx + 1);
    }
  };

  return (
    <div className="mt-3">
      {/* 进度指示：第几题 */}
      <div className="mb-2.5 flex items-center gap-1.5">
        {items.map((_, i) => (
          <span
            key={i}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              i === idx ? 'w-5 bg-[#0071e3]' : i < idx ? 'w-1.5 bg-[#0071e3]/50' : 'w-1.5 bg-[#e8e8ed]'
            }`}
          />
        ))}
        <span className="ml-1 text-[11px] tabular-nums text-[#86868b]">
          {idx + 1} / {items.length}
        </span>
      </div>

      {/* 当前这题（切题时淡入） */}
      <div key={idx} className="fade-in rounded-2xl bg-[#f5f5f7] px-4 py-3">
        <p className="text-[13.5px] font-medium text-[#1d1d1f]">{c.q}</p>
        {c.hint ? (
          <button
            onClick={() => setTyped(c.hint ?? '')}
            className="jelly mt-1.5 inline-flex items-start gap-1 rounded-full bg-white/80 px-2.5 py-1 text-left text-[11.5px] leading-snug text-[#0071e3] shadow-[inset_0_0_0_1px_rgba(0,113,227,0.15)]"
          >
            💡 {c.hint}
          </button>
        ) : null}
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && typed.trim()) advance(typed.trim());
          }}
          placeholder="输入你的回答…（回车提交）"
          className="mt-2 w-full rounded-xl border border-[#e8e8ed] bg-white px-3 py-2 text-[13.5px] text-[#1d1d1f] outline-none transition-colors focus:border-[#0071e3]"
        />
      </div>

      {/* 操作：下一个 / 跳过 / 上一题 */}
      <div className="mt-2.5 flex items-center gap-2">
        <button
          onClick={() => advance(typed.trim())}
          disabled={!typed.trim()}
          className="jelly rounded-full bg-[#0071e3] px-4 py-1.5 text-[12.5px] font-medium text-white transition-all hover:bg-[#0077ed] disabled:cursor-not-allowed disabled:opacity-30"
        >
          {last ? '✓ 回答完毕，开始论证' : '下一个 →'}
        </button>
        <button
          onClick={() => advance('')}
          className="rounded-full px-3 py-1.5 text-[12px] text-[#86868b] transition-colors hover:text-[#1d1d1f]"
        >
          跳过这题
        </button>
        {idx > 0 && (
          <button
            onClick={() => {
              setIdx(idx - 1);
              setTyped(answers[idx - 1] ?? '');
            }}
            className="rounded-full px-3 py-1.5 text-[12px] text-[#86868b] transition-colors hover:text-[#1d1d1f]"
          >
            ← 上一题
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------- 报告消息回看条：评审阶段 + 思考摘录可展开 ---------- */
function ReplayBar({ msg }: { msg: ChatMsg }) {
  const [open, setOpen] = useState(false);
  const tChars = (msg.thinking ?? []).reduce((n, t) => n + t.text.length, 0);
  return (
    <div className="no-print mb-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full border border-[#f0f0f2] bg-[#fbfbfd] px-3.5 py-1.5 text-[12px] text-[#86868b] transition-colors hover:text-[#1d1d1f]"
      >
        {msg.mode === 'deep' ? '🔬' : '⚡'}
        {msg.mode === 'deep' ? '评审过程回看' : '预诊过程回看'}
        {msg.thinking?.length ? ` · 思考摘录${tChars}字` : ''}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="fade-in mt-2 space-y-3 rounded-[16px] border border-[#f0f0f2] bg-[#fbfbfd] p-4">
          {msg.phases?.length ? (
            <div className="space-y-1.5">
              {msg.phases.map((s, i) => (
                <div key={i} className="flex items-center gap-2.5 text-[12.5px]">
                  {s.status === 'done' ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#2EA043]" />
                  ) : (
                    <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-[#d8d8dd]" />
                  )}
                  <span className="shrink-0 text-[#1d1d1f]">{s.label}</span>
                  {typeof s.elapsedMs === 'number' ? (
                    <span className="shrink-0 font-mono text-[11px] text-[#c7c7cc]">{(s.elapsedMs / 1000).toFixed(1)}s</span>
                  ) : null}
                  <span className="ml-auto min-w-0 truncate text-right text-[11px] text-[#c7c7cc]">{s.desc}</span>
                </div>
              ))}
            </div>
          ) : null}
          {msg.thinking?.map((v) => (
            <ThinkBlock key={v.view} view={v} collapsedHeight />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- 深度论证：评审日志面板（五阶段逐个点亮） ---------- */
function DeepReviewPanel({
  stages,
  finished,
  elapsedSec,
  liveNote = '',
}: {
  stages: RStage[];
  finished: boolean;
  elapsedSec: number;
  liveNote?: string;
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
    <div className="mx-auto w-full max-w-md rounded-[16px] border border-[#f0f0f2] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_8px_28px_rgba(0,0,0,0.06)]">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-[#1d1d1f]">
        <span className="review-pulse -ml-1 inline-block h-2 w-2 rounded-full bg-[#0071e3]" />
        评审团正在多视角论证中…
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
              className="min-w-0 shrink-0"
              style={{
                color: s.status === 'done' ? '#86868b' : s.status === 'active' ? '#0071e3' : '#c7c7cc',
                fontWeight: s.status === 'active' ? 600 : 400,
              }}
            >
              {s.label}
            </span>
            {s.status === 'done' && typeof s.elapsedMs === 'number' ? (
              <span className="shrink-0 font-mono text-[11px] text-[#c7c7cc]">{(s.elapsedMs / 1000).toFixed(1)}s</span>
            ) : null}
            <span className="ml-auto min-w-0 truncate text-right text-[11px] text-[#c7c7cc]"> {s.desc}</span>
          </div>
        ))}
      </div>
      {liveNote ? (
        <div className="mt-3 rounded-xl bg-[#f5f5f7] px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#86868b]">
            <Brain className="h-3 w-3 text-[#0071e3]" />
            评审团正在思考
            <span className="review-pulse inline-block h-1 w-1 rounded-full bg-[#0071e3]" />
          </div>
          <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-[#86868b]">{liveNote}</p>
        </div>
      ) : null}
    </div>
  );
}

/* ---------- 深度思考摘录（reasoning 实时流 + 完成收起可回看） ---------- */
function DeepThinkingPanel({
  views,
  done,
  sec,
  live,
}: {
  views: ThinkingView[];
  done: boolean;
  sec: number;
  live: boolean;
}) {
  const chars = views.reduce((n, t) => n + t.text.length, 0);
  const [expanded, setExpanded] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (expanded && live && boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight;
    }
  }, [views, expanded, live]);

  if (!views.length) return null;
  if (done && !live) {
    return (
      <div className="mx-auto w-full max-w-md">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mx-auto flex items-center gap-1.5 rounded-full border border-[#f0f0f2] bg-[#fbfbfd] px-4 py-1.5 text-[12px] text-[#86868b] transition-colors hover:text-[#1d1d1f]"
        >
          <Check className="h-3.5 w-3.5 text-[#0071e3]" />
          深度思考完成 · {chars}字 · {sec}秒
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
        {expanded && (
          <div className="mt-2 space-y-2">
            {views.map((v) => (
              <ThinkBlock key={v.view} view={v} collapsedHeight />
            ))}
          </div>
        )}
      </div>
    );
  }
  // 进行中：实时摘录
  return (
    <div className="mx-auto w-full max-w-md space-y-2">
      {views.map((v) => (
        <ThinkBlock key={v.view} view={v} />
      ))}
    </div>
  );
}

function ThinkBlock({ view, collapsedHeight }: { view: ThinkingView; collapsedHeight?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [view.text]);
  return (
    <div className="rounded-[12px] border border-[#f0f0f2] bg-[#fbfbfd] px-3.5 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#86868b]">
        <Brain className="h-3 w-3 text-[#0071e3]" />
        {view.viewName}
        {!view.done && <span className="review-pulse inline-block h-1 w-1 rounded-full bg-[#0071e3]" />}
      </div>
      <div
        ref={ref}
        className={`mt-1.5 overflow-y-auto whitespace-pre-wrap text-[12px] leading-5 text-[#86868b] ${collapsedHeight ? 'max-h-40' : 'max-h-32'}`}
      >
        {view.text}
        <span className="review-caret ml-0.5 inline-block h-3 w-[2px] translate-y-[1px] bg-[#0071e3]" />
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