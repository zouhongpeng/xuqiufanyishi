# 项目上下文

## 项目概述

「需求拆解师」——科创大赛展示作品。定位：**一个安静的拆解大师**（对标苹果官网设计语言），已升级为**专业评审系统**，把模糊想法按科创赛评审口径拆成可执行方案。
产品流程：用户输入想法 → 判断清晰度(0-3) → 低则出「诊断卡片」追问（缺失信息 + 可点选项） → 继续对话 → 清晰度≥2 生成完整「行动看板」报告（需求理解/拆解方案/风险预警与降级方案/整改行动方案/「下一步，你可以：」A·B·C + 报告末尾 14 项评审检查清单）。
**双模式引擎**：快速预诊(LLM 两次调用，流式打字机) / 深度论证(**DeepSeek 五阶段论证链**，SSE 逐阶段点亮 + 三视角并行思维链摘录；扣子工作流保留为降级通道)。**场景标签四项：科创赛诊断(默认)/社团策划/学习规划/内容创作**，各场景有补充提示词（`prompts/scenes.json`）。附加：知识库说明抽屉、报告分享图导出、历史记录(浏览器本地 20 条)、/admin 用量看板。

## 技术栈

- **Framework**: Next.js 16 (App Router) + 自定义服务端入口 `src/server.ts`
- **Core**: React 19，TypeScript 5
- **UI/Styling**: Tailwind CSS 4 + 手写 Apple 风格（白底 #FFFFFF、文字 #1D1D1F、唯一强调色 #0071E3；见 `DESIGN.md`）
- **包管理器**: `pnpm`（严禁 npm/yarn）
- **LLM 接入**: `src/lib/llmProvider.ts` 供应商抽象——配置 `DEEPSEEK_API_KEY` 时**直连 DeepSeek**（OpenAI 兼容 `{DEEPSEEK_BASE_URL||https://api.deepseek.com}/chat/completions`，Bearer，SSE；**实测网关直接接受官方模型名 `deepseek-chat` 与 `deepseek-reasoner`**，reasoner 流式 delta 分离 `reasoning_content`/`content`，`stream_options.include_usage` 返回 token 用量），用用户自有额度；未配置时回退 `coze-coding-dev-sdk` 调豆包（豆包侧 `deepseek-reasoner`→reportModel 映射）。每次调用经 `usageLog.ts` 写 `.usage/llm-usage.json`（git 忽略）供 /admin 聚合。
- **工作流接入（降级通道）**: 扣子 `POST /v1/workflow/run`（非流式）与 `/v1/workflow/stream_run`（流式事件）。深度链失败（reasoner 降级后仍失败）时回退此通道。

## 知识库（`src/data/knowledge/*.json` + `src/lib/knowledge.ts`）

三张表（每条带 `keywords` 数组供关键词匹配注入；首页「知识库说明」抽屉与雷区警示榜、背书条计数均读这三张表）：
- `rules.json` 评审规则库（id R1-R8、dimension 维度、content 规则内容、weight 权重、deduction 常见扣分点）
- `cases.json` 往届案例库（id、name、domain、result、seaStatus 红海/拥挤/蓝海、redSea 雷区分析、differentiation 差异化建议；示例数据，持续补充）
- `boundaries.json` 能力边界库（id B1-B10、item、safe 安全区布尔、risk 风险说明、fallback 降级建议）
- `knowledge.ts` 导出：`buildKBContext`（命中条目压缩注入）、`findRedSeaCase`/`redSeaHitOnText`（关键词重合度粗匹配）、`plagiarismHint`（查重提示卡数据：caseName/domain/result/redSea/differentiation）、`matchEvidence`（依据角标数组 {ref,label,kind,text}）
- 拆解结果（quick/deep）均附 `plagiarism` + `evidence`，前端风险预警区渲染查重提示卡与「依据：评审规则库R2」角标（点击显原文）。

## 双模式引擎（核心）

### 快速预诊（`src/lib/decomposer.ts`，纯 LLM；底层经 `src/lib/llmProvider.ts`）
- `judge(context, headers, scene?)`：调用1「清晰度判断」。`JUDGE_SYSTEM` 为**评委视角**（严格、不恭维、「太宽泛，需要聚焦」）；scene/category 命中「科创赛诊断」时追加 `SCIENCE_FAIR_EXPERT`（三自原则/三性原则）**并注入 `SCIENCE_FAIR_CONTEXT()` 知识库 + 红海关键字检测职责**（命中在 `missing_info` 标注「该方向已高度饱和，需差异化」）。JSON：`{clarity(0-3从严), category, clarity_desc, missing_info[], next_question, options[{label,hint}], source_tags[]}`。模型 `MODEL_JUDGE`。
- `decomposeReport(context, headers, category?)`：调用2「完整拆解」，**报告正文纯 Markdown 流式输出（DECOMPOSE_SYSTEM 明令不输出 JSON/分隔块）**；checklist 由独立的第三次调用生成（见 `reviewChecklist`）；返回 `{report, checklist(14项), source_tags}`。模型 `MODEL_REPORT`。
- `streamReport(context, headers, category?)`：`chatStream()` 逐 token yield 报告正文，末尾 item 携带完整串（`{kind:'__final', full}`）；route.ts 只消费 string 分支（`__final` 已废弃使用）。
- `reviewChecklist(context, report, headers)`：**checklist 独立廉价调用**——`CHECKLIST_SYSTEM` 要求输出严格 JSON `{checklist:[{item,status,note}],source_tags:[...]}`（judgeModel、temperature 0.2，2 次尝试 + `extractJson` 解析，`checklist.length>=10` 才接受）；失败/缺项由 `padChecklist` 兜底补齐 14 项（缺失项 `{status:'warn', note:'未生成评估，请人工复核'}`）。
  - **架构决策（重要）**：旧方案「报告正文末尾内嵌 `---REVIEW_JSON---` 分隔块再拆分」已废弃——报告模型输出契约不稳定，模型经常漏输出 JSON 块导致 checklist 为空；现拆为独立调用，报告流式不被污染。`splitReviewOutput` 已删除，route.ts 不得再引用。
- `checklist` 14 项固定（`CHECKLIST_ITEMS`）：自主选题核查/创新性论证/科学性校验/查重比对/能力边界校验/工作量规划/技术路线核查/时间线合理性/资源匹配/风险预案/差异化空间/展示逻辑/答辩风险/迭代空间；每项 `{item,status:'pass'|'warn'|'fail',note}`。
- `buildContextInput()` 拼「第1轮:[..]第2轮:[..]」；`isNewTopic()` 命中触发词清空历史。

### 深度论证（`src/lib/deepChain.ts` 五阶段论证链，SSE `/api/deep-analysis`）
- **五阶段**：①需求诊断(judge, deepseek-chat, clarity<=1 出追问 result) → ②多视角论证(deepseek-reasoner ×3 并行：A创新性/B科学性与可行性/C应用价值与红海风险，`reasoning_delta` 事件实时推思维链) → ③评委质询(reasoner，合并三视角，能力边界/工作量/答辩风险) → ④报告整合(chat，`content_delta` 流式) → ⑤检查清单(reviewChecklist)。`DEEP_PHASES` 为阶段定义；事件协议 `{type:'phase_start'|'phase_end'(elapsed_ms)|'reasoning_delta'(view A/B/C/grill)|'content_delta'|'result'|'error'|'done'|'phase_reset'}`
- **降级链**：reasoner 失败/60s 无输出 → deepseek-chat + 「请逐步推理后再给结论」重试1次 → 仍失败抛错 → route 层 `phase_reset` 后回退 `streamDeepWorkflow`（扣子工作流 node 事件）→ 再失败发 `error`。无 COZE_PAT 时工作流路径自动走 `deepViaLLM`（judge+decomposeReport + notice）。
- 频控（`src/lib/rateLimit.ts`，内存 Map per IP）：深度 3次/时、20次/日；快速 5次/分。超限 429。
- 多轮上下文由 `src/lib/sessionStore.ts` 共享（chat 与 deep-analysis 两个 route 共用）。
- 扣子工作流代码保留：`workflow.ts`(deepRun 非流式兜底) + `workflowStream.ts`(streamDeepWorkflow/REVIEW_STAGES/FALLBACK_STAGES)；配置 `DEEP_CONFIG`。**实测：扣子账户当前欠费（Insufficient coze credits balance），工作流降级通道不可用，最终 error 事件兜底正常。**

## 目录结构

```
├── scripts/                 # 构建/启动/预览脚本（dev.sh 起 5000）
├── prompts/scenes.json      # 四场景补充提示词（科创赛诊断/社团策划/学习规划/内容创作）
├── src/
│   ├── app/
│   │   ├── page.tsx         # 三幕式页面 + 模式开关 + 四场景胶囊 + 五阶段评审日志 + 思考摘录 + 雷区警示榜 + 历史入口
│   │   ├── layout.tsx       # 根布局（metadata 中文标题）
│   │   ├── admin/page.tsx   # /admin 用量看板（口令 SHA-256 验证，cookie 会话）
│   │   ├── api/chat/route.ts        # 快速模式 SSE + 非流式；deep 分支委托 deepChain
│   │   ├── api/deep-analysis/route.ts # 深度五阶段 SSE（频控 3/时·20/日）
│   │   ├── api/admin/{login,stats}/route.ts # 看板口令验证与统计聚合
│   │   └── globals.css      # Apple 设计 token + 毛玻璃 + 光斑 + 动效 + 打印
│   ├── components/
│   │   ├── DiagnosisCard.tsx   # 追问诊断卡片
│   │   ├── ReportView.tsx      # 报告（行动看板/查重提示卡/依据角标/14项清单/导出分享图按钮）
│   │   ├── shareCard.ts        # Canvas 竖版分享卡 900x1200 @2x 绘制与下载
│   │   ├── KnowledgeDrawer.tsx # 知识库说明抽屉（三表浏览，遮罩+Esc+X 关闭）
│   │   ├── HistoryDrawer.tsx   # 历史记录抽屉（回看/单删/清空，空态+隐私提示）
│   │   ├── ConfirmDialog.tsx   # 危险操作确认框（X/取消/确认三出口）
│   │   └── Toast.tsx           # 全局轻提示（showToast 事件总线，z-[2000]）
│   ├── data/knowledge/      # 知识库三表 JSON（rules/cases/boundaries）
│   ├── lib/
│   │   ├── config.ts        # LLM_CONFIG（含 deepseek 段）+ DEEP_CONFIG
│   │   ├── llmProvider.ts   # 供应商抽象（DeepSeek 直连优先/coze SDK 回退；reasoning 流解析、usage 记账、mode 归因）
│   │   ├── deepChain.ts     # 深度五阶段论证链（含 reasoner 降级、知识库/场景注入）
│   │   ├── decomposer.ts    # 快速预诊 LLM 引擎（judge/decomposeReport/streamReport/reviewChecklist）
│   │   ├── knowledge.ts     # 知识库检索注入 + 查重粗匹配 + 依据角标数据
│   │   ├── scenePrompts.ts  # 场景补充提示词读取
│   │   ├── sessionStore.ts  # 多轮上下文（chat 与 deep-analysis 共享）
│   │   ├── rateLimit.ts     # IP 频控（内存 Map）
│   │   ├── usageLog.ts      # LLM 调用用量 JSON 文件持久化（.usage/）
│   │   ├── history.ts       # 浏览器历史记录存取（localStorage，最近 20 条）
│   │   ├── workflow.ts      # 扣子工作流非流式（降级通道）
│   │   └── workflowStream.ts# 扣子工作流流式（降级通道）
│   └── server.ts            # Next 自定义 HTTP 入口（读 PORT，默认 5000）
├── .env.example             # 环境变量模板
├── .coze                    # 项目/预览/部署配置
└── DESIGN.md                # 苹果设计语言
```

## 关键入口 / 核心逻辑

- **前端入口**: `src/app/page.tsx` —— 三幕式：
  - 首屏 slogan「像评委一样，审视你的每一个项目想法」+ 大输入框 + 状态栏「评审知识库 · 覆盖评审规则 / 往届案例 / 能力边界」+ 场景胶囊 [科创赛诊断✓默认][视频创作][写作][创业][学习][活动] + 底部知识库数据背书 + 可展开「雷区警示榜」（红海案例卡片，数据来自 `past-cases.json`）。
  - 对话：气泡 + 模式徽标（⚡快速预诊 / 🔬深度论证）；AI 追问带 `options` 渲染成 `DiagnosisCard`（点选项=当回答发送）。
  - 加载可视化：深度论证渲染 `DeepReviewPanel`（评审日志面板，环节逐个点亮，完成后收拢为「✓ 深度论证完成 · 已完成评审检查 · 用时 X 秒」）；快速预诊渲染 `QuickReview`（阶段感「清晰度评估→生成整改方案」+ 报告 Markdown 打字机流式渲染）。
  - 报告：满屏苹果页 + 行动看板 + **14 项评审检查清单** + 依据标签 + 「下一步，你可以：」A/B/C + 一键复制/打印；localStorage 持久化会话/模式/消息/任务勾选。
- **后端接口**: `POST /api/chat`，body `{ sessionId, message, mode?, scene?, stream? }`。
  - `stream:true` → SSE（`text/event-stream`），事件 `data: {...}\n\n`，类型：`phase`（阶段切换）、`node`（评审环节 `{status,label,desc,idx}`）、`token`（报告流式文本）、`result`（最终 JSON）、`error`（失败信息）。
  - `stream:false` → 直接 JSON（无真实 LLM 时构建器/脚本调试用）。
  - 结果 JSON：`{ type:'question'|'solution', mode, clarity, category, clarity_desc, content, round, missing_info?, options?, checklist?, source_tags? }`。
  - 内存 Map 维护每 session 多轮用户消息；命中「新需求」触发词清空重开。
  - scene 上下文追加（`（用户期望聚焦场景：{scene}）`）只在 **deep 模式**做，避免与 quick judge 的 sceneHint 重复。
- **接续 A/B/C**: 报告底部「下一步，你可以：」三个胶囊按钮，点击作为新轮用户消息进入多轮上下文继续对话。

## 运行与预览

- 可预览型（`project_type = web`，`preview_enable = enabled`），预览暴露端口 5000（读 `.preview`）。
- 预览：`bash ./scripts/dev.sh`；生产：`bash ./scripts/build.sh` / `bash ./scripts/start.sh`（`src/server.ts` 读 `PORT`=5000）。
- 验收：web 项目统一用 `test_run` 静态检查 + 接口冒烟 + 探活（真实 LLM 冒烟依赖外部余额）。
- **DeepSeek 五阶段链路耗时**：完整深度一次约 60-120s（3 路 reasoner 并行为主要开销）；`/api/deep-analysis` SSE 事件序：phase_start(diagnosis) → [result(question) | phase_end → phase_start(argument) → reasoning_delta×N(A/B/C 交错) → grill → report(content_delta) → checklist] → result → done。

## 配置

- **认证**：`coze-coding-dev-sdk` 的 `Config()` 自动从 Coze Coding 运行环境注入；深度论证需 `COZE_PAT`（扣子开放平台令牌）放环境变量（`.env.local`，git 忽略）。**严禁在代码/配置文件写死密钥。**
- **DeepSeek 直连（快速预诊主路径）**：`DEEPSEEK_API_KEY` 放 `.env.local`（git 忽略）；可选 `DEEPSEEK_BASE_URL`（默认 `https://api.deepseek.com`）。配置后 `llmProvider` 全部 LLM 调用（judge/report/checklist）直连 DeepSeek 官方 API，消耗用户自有额度；模型名为 `deepseek-flash`（判断/检查清单）与 `deepseek-v4-pro`（报告），由 `resolveModel` 从豆包语义模型名映射（`MODEL_JUDGE`/`MODEL_REPORT` 环境变量仍可覆盖）。
- **WORKFLOW_ID**：`src/lib/config.ts` 的 `DEEP_CONFIG.workflowId`（可用环境变量 `WORKFLOW_ID` 覆盖）。
- 可选模型覆盖：`MODEL_JUDGE` / `MODEL_REPORT`。
- **ADMIN_PASSCODE**：/admin 看板口令（.env.local）；前端仅传 SHA-256 摘要，Network 无明文；未配置时看板 403。

## 用户偏好与长期约束

- 判断与拆解逻辑只由引擎（LLM/工作流）负责，前端不重复实现 AI 逻辑。
- 密钥只走后端环境变量，绝不进前端。
- 多轮上下文由后端维护；前端 localStorage 仅缓存渲染消息供刷新恢复。
- 需求判断要「从严」+「评委视角」，多数清晰度为 0/1，追问一次只问最关键一件事，摆出缺失信息与 2-4 个可点选项。
- 视觉：苹果官网风格，全站唯一强调色 #0071E3，禁弹跳/花哨动画，状态图标动画只动 opacity/transform；展示文案不暴露技术实现，且**全站用评审化语汇**：快速预诊/深度论证、评审知识库、整改行动方案、风险预警与降级方案、「下一步，你可以：」；禁用「快速/秒级/及时」类营销词。
- 行动清单勾选状态存 `localStorage`（key 前缀 `req-decomposer:check:`），刷新保留。
- 风险预警与降级方案渲染为红色警示区（左红竖条 + 浅红底 #fff5f5）。
- **科创赛诊断场景**：判断与拆解均注入科创赛知识库 + 评委专家设定 + 红海撞车检测，报告附 14 项评审检查清单与依据标签（source_tags: 规则·三自原则 / 查重·往届案例 / 边界·高风险区）。

## 常见问题和预防

- **自定义服务端不自动加载 .env.local**：`src/server.ts` 走 `next({dev})` 编程 API，不是 `next dev` CLI，Next 不会自动读 `.env.local`；server.ts 启动时已手动解析 `.env.local`/`.env` 注入 `process.env`（不覆盖已有变量）。新增环境变量直接写 `.env.local` 即可，但**改 server.ts 或环境文件后必须重启 dev**。
- **深度论证失败**：多为 `COZE_PAT` 未配置、账户欠费或工作流较慢；流式路径自动降级（定时赛事动画 + 非流式 `deepRun` 兜底），最终通过 `error` 事件让前端显示报错气泡。
- **部署环境无 COZE_PAT（重要）**：部署走 git 传输（`[deploy].deps=["git"]`），`.env.local` 被 gitignore 不随部署带走 → 线上 `dist/server.js` 读不到令牌。已做产品级降级：无令牌时深度模式自动回退 LLM 引擎（judge + decomposeReport，`deepViaLLM`），评审环节动画照常播放，结果携带 `notice` 字段提示「本次由快速预诊引擎完成」，前端渲染为灰色说明条。若要在部署实例启用真工作流，需在平台部署环境变量中配置 `COZE_PAT`（严禁把令牌写进任何 git 追踪的文件）。预览环境（next dev）读 `.env.local`，不受影响。
- **部署环境无 DEEPSEEK_API_KEY（同理）**：`.env.local` 同样不随 git 部署带走 → 线上 `llmProvider` 回退 coze SDK 调豆包。要在部署实例用 DeepSeek 额度，需在平台部署环境变量中配置 `DEEPSEEK_API_KEY`（严禁写进 git 追踪文件）。
- **LLM 账户欠费**：豆包 SDK 路径抛「[临时不可用] 余额已欠费」；DeepSeek 路径抛 `DeepSeek API <status>: <detail>`（非 2xx）→ 快速路径 502/error 事件；深度链触发降级（reasoner→chat→扣子工作流→error）。**扣子账户当前欠费**，工作流降级通道实际不可用，属外部依赖。
- **.usage/llm-usage.json 与 .env.local 均被 gitignore**，不随 git 部署带走；/admin 在部署实例需配 `ADMIN_PASSCODE` 方可用。
- **深度流式节点匹配**：`REVIEW_STAGES` 以 keyword 模式匹配真实工作流节点名，未匹配归「扩展检查项」；映射可后续按真实节点校正（用户保留校正权）。
- **判断解析失败**：`extractJson` 剥围栏/首个 `{}`/重试，仍失败则报错不崩溃。
- **换话题误清空**：仅整段匹配触发词（长度 ≤14）才清空。
- **报告渲染**：优先 Markdown 标题/列表/行动清单（解析成任务卡：优先级标签【高】红/#FF6B6B、【中】橙/#FFA94D、【低】灰/#ADB5BD + 预计耗时 + 验收标准 + 依赖项 + checkbox），无法解析按纯文本兜底；checklist/source_tags 由独立 `reviewChecklist` 调用生成（不再依赖报告内嵌 JSON，`padChecklist` 兜底补齐 14 项）。
- **诊断卡片**：`judge` 返回的 `options`/`missing_info` 解析失败时给空数组 + 默认选项兜底，不崩溃。
- **边界**：前端不重复实现 AI 逻辑，判断/拆解只由引擎（LLM/工作流）负责。
- **Hydration**：聊天页 `'use client'`，localStorage 读取在 `useEffect` 且先置 `hydrated`；`window.print`/`navigator.clipboard` 仅在用户交互时调用。