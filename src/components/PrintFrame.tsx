'use client';

import type { StructuredReport } from '@/lib/deepChain';

interface PrintFrameProps {
  full: boolean;
  title: string;
  date: string;
  no: string;
  structured: StructuredReport | null;
  reportText: string;
}

const SECTIONS = ['需求档案', '五阶段论证', '正反交锋', '需求地图', '行动清单', '风险与预案'];

/** PDF 精装打印层：屏幕隐藏，仅打印可见。full=完整版（5-8页）/ quick=速览版（1页） */
export default function PrintFrame({ full, title, date, no, structured, reportText }: PrintFrameProps) {
  const s = structured;
  return (
    <div className={`print-sheet ${full ? 'print-full-only' : 'print-quick-only'}`} aria-hidden>
      <div className="print-header">
        <span>需求拆解师 · 评审报告</span>
        <span>{no}</span>
      </div>

      {!full ? (
        /* ---------- 速览版：1 页 ---------- */
        <div>
          <div className="print-h1 mb-1">{s?.card?.title || title}</div>
          <div style={{ color: '#86868b', fontSize: '9pt' }}>
            速览版 · {date} · {no}
          </div>
          <div className="print-h2">核心结论</div>
          <p style={{ fontSize: '11.5pt', fontWeight: 600 }}>
            {s?.card?.conclusion || s?.summary || firstParagraph(reportText)}
          </p>
          <div className="print-h2">行动清单</div>
          {(s?.actions ?? []).map((a, i) => (
            <div key={i} className="print-card pb-avoid mb-2" style={{ fontSize: '10pt' }}>
              <strong>
                {i + 1}. {a.task}
              </strong>
              <div style={{ color: '#86868b', fontSize: '8.5pt' }}>
                {a.role ? `角色：${a.role}` : ''}
                {a.time ? ` ｜ 时间：${a.time}` : ''}
                {a.priority ? ` ｜ 优先级：${a.priority}` : ''}
              </div>
            </div>
          ))}
          {!s && <p style={{ whiteSpace: 'pre-wrap', fontSize: '10pt' }}>{plainBody(reportText).slice(0, 2400)}</p>}
          <div className="print-footer">
            <span>需求拆解师 · AI 评审助手</span>
            <span>速览版 · 第 1 页</span>
          </div>
        </div>
      ) : (
        /* ---------- 完整版：封面 → 目录 → 六板块 → 需求地图整页 → 尾页拆解卡 ---------- */
        <div>
          {/* 封面页 */}
          <div className="print-cover">
            <div style={{ fontSize: '10pt', color: '#0071e3', letterSpacing: '0.2em' }}>NEED DECOMPOSER</div>
            <div className="print-h1" style={{ fontSize: '30pt', marginTop: '10pt' }}>
              需求拆解报告
            </div>
            <div style={{ marginTop: '16pt', fontSize: '13pt', fontWeight: 600 }}>{s?.card?.title || title}</div>
            <div style={{ marginTop: '6pt', color: '#86868b', fontSize: '10pt' }}>
              {date} ｜ {no}
            </div>
            {s?.card?.conclusion ? (
              <div className="print-card" style={{ marginTop: '24pt', fontSize: '11pt' }}>
                <strong>核心结论：</strong>
                {s.card.conclusion}
              </div>
            ) : null}
          </div>

          {/* 目录页 */}
          <div className="print-toc">
            <div className="print-h1">目录</div>
            <ol>
              {SECTIONS.map((name, i) => (
                <li key={name}>
                  <span>
                    {String(i + 1).padStart(2, '0')}　{name}
                  </span>
                  <span style={{ color: '#86868b' }}>{tocNote(name, s)}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* 六板块分页正文 */}
          {s ? (
            <>
              <div className="pb-page">
                <div className="print-h2">一、需求档案</div>
                <p style={{ fontSize: '11pt', fontWeight: 600 }}>{s.summary}</p>
                <div className="print-card pb-avoid" style={{ marginTop: '8pt' }}>
                  {Object.entries(s.archive ?? {}).map(([k, v]) => (
                    <div key={k} style={{ padding: '2pt 0' }}>
                      <strong>{k}：</strong>
                      {v}
                    </div>
                  ))}
                </div>
              </div>

              <div className="pb-page">
                <div className="print-h2">二、五阶段论证</div>
                {s.stages.map((st, i) => (
                  <div key={i} className="pb-avoid" style={{ marginBottom: '8pt' }}>
                    <div style={{ fontWeight: 700 }}>
                      {String(i + 1).padStart(2, '0')}　{st.name}
                    </div>
                    <div style={{ color: '#6e6e73' }}>{st.summary}</div>
                    <ul style={{ margin: '3pt 0 0 14pt', padding: 0 }}>
                      {st.points.map((p, j) => (
                        <li key={j} style={{ fontSize: '10pt' }}>
                          {p}
                        </li>
                      ))}
                    </ul>
                    <div className="print-mark">阶段结论：{st.conclusion}</div>
                  </div>
                ))}
              </div>

              <div className="pb-page">
                <div className="print-h2">三、正反交锋</div>
                {s.debate.map((d, i) => (
                  <div key={i} className="print-card pb-avoid" style={{ marginBottom: '8pt', fontSize: '10pt' }}>
                    <strong>{d.topic}</strong>
                    <div style={{ marginTop: '3pt' }}>正方：{d.pro}</div>
                    <div>反方：{d.con}</div>
                    <div className="print-mark">裁决：{d.resolved}</div>
                  </div>
                ))}
              </div>

              <div className="pb-page">
                <div className="print-h2">四、需求地图</div>
                <PrintTree node={s.tree} />
              </div>

              <div className="pb-page">
                <div className="print-h2">五、行动清单</div>
                {s.actions.map((a, i) => (
                  <div key={i} className="pb-avoid" style={{ padding: '4pt 0', borderBottom: '0.5pt solid #e8e8ed' }}>
                    <strong>
                      {i + 1}. {a.task}
                    </strong>
                    <div style={{ color: '#86868b', fontSize: '9pt' }}>
                      {a.role ? `建议角色：${a.role}` : ''}
                      {a.time ? ` ｜ 时间：${a.time}` : ''}
                      {a.priority ? ` ｜ 优先级：${a.priority}` : ''}
                    </div>
                  </div>
                ))}
              </div>

              <div className="pb-page">
                <div className="print-h2">六、风险与预案</div>
                {s.risks.map((r, i) => (
                  <div key={i} className="print-card pb-avoid" style={{ marginBottom: '8pt', fontSize: '10pt' }}>
                    <strong style={{ color: '#b0352b' }}>
                      {i + 1}. {r.risk}
                    </strong>
                    <div style={{ marginTop: '3pt' }}>应对：{r.response}</div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            /* structured 缺失：纯文本分页兜底 */
            <>
              {SECTIONS.map((name, i) => (
                <div key={name} className="pb-page">
                  <div className="print-h2">
                    {['一', '二', '三', '四', '五', '六'][i]}、{name}
                  </div>
                  <p style={{ whiteSpace: 'pre-wrap', fontSize: '10.5pt' }}>
                    {extractSection(plainBody(reportText), i + 1)?.slice(0, 1600) || '（本节内容见完整报告）'}
                  </p>
                </div>
              ))}
            </>
          )}

          {/* 尾页：拆解卡 */}
          <div className="pb-page">
            <div style={{ border: '2pt solid #1d1d1f', borderRadius: '14pt', padding: '24pt', minHeight: '150mm' }}>
              <div style={{ fontSize: '9pt', color: '#0071e3', letterSpacing: '0.15em' }}>NEED DECOMPOSER · 拆解卡</div>
              <div style={{ fontSize: '20pt', fontWeight: 700, marginTop: '12pt' }}>{s?.card?.title || title}</div>
              <div style={{ marginTop: '12pt', fontSize: '12pt', lineHeight: 1.9 }}>
                {s?.card?.conclusion || s?.summary || firstParagraph(reportText)}
              </div>
              <div style={{ marginTop: '24pt', color: '#86868b', fontSize: '10pt' }}>
                {date} ｜ {no}
              </div>
            </div>
          </div>

          <div className="print-footer">
            <span>需求拆解师 · AI 评审助手</span>
            <span>完整版</span>
          </div>
        </div>
      )}
    </div>
  );
}

function PrintTree({ node, depth = 0 }: { node: { label: string; basis?: string; children?: { label: string; basis?: string; children?: unknown[] }[] }; depth?: number }) {
  return (
    <div style={{ marginLeft: depth * 14 }}>
      <div style={{ fontSize: depth === 0 ? '12pt' : '10.5pt', fontWeight: depth === 0 ? 700 : 500 }}>
        {depth === 0 ? '◆ ' : '└ '}
        {node.label}
      </div>
      {(node.children ?? []).map((c, i) => (
        <div key={i}>
          <PrintTree node={c as never} depth={depth + 1} />
        </div>
      ))}
    </div>
  );
}

function tocNote(name: string, s: StructuredReport | null): string {
  if (!s) return '';
  if (name === '五阶段论证') return `${s.stages.length} 阶段`;
  if (name === '正反交锋') return `${s.debate.length} 组`;
  if (name === '行动清单') return `${s.actions.length} 条`;
  if (name === '风险与预案') return `${s.risks.length} 条`;
  return '';
}

function plainBody(text: string): string {
  return text.replace(/^---[\s\S]*$/m, '').trim();
}

function firstParagraph(text: string): string {
  const body = plainBody(text);
  return body.split('\n').find((l) => l.trim() && !l.startsWith('#'))?.slice(0, 160) || body.slice(0, 160);
}

/** 从纯文本报告按「一、二、…」提取章节 */
function extractSection(body: string, idx: number): string | null {
  const heads = ['一、', '二、', '三、', '四、', '五、', '六、', '七、'];
  const start = body.indexOf(heads[idx - 1]);
  if (start < 0) return null;
  const next = heads[idx] ? body.indexOf(heads[idx], start + 1) : -1;
  return body.slice(start, next > 0 ? next : undefined);
}
