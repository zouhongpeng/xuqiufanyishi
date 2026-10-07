# 项目上下文

## 项目概述

「需求拆解师」——科创大赛展示作品。定位：**一个安静的拆解大师**（对标苹果官网设计语言），已升级为**专业评审系统**，把模糊想法按科创赛评审口径拆成可执行方案。
产品流程：用户输入想法 → 判断清晰度(0-3) → 低则出「诊断卡片」追问（缺失信息 + 可点选项） → 继续对话 → 清晰度≥2 生成完整「行动看板」报告（需求理解/拆解方案/风险预警与降级方案/整改行动方案/「下一步，你可以：」A·B·C + 报告末尾 14 项评审检查清单）。
**双模式引擎**：快速预诊(LLM 两次调用，流式打字机) / 深度论证(扣子工作流，逐节点事件流 + 评审日志面板)。**场景标签默认「科创赛诊断」，此场景注入科创赛知识库 + 评委专家视角。**

## 技术栈

- **Framework**: Next.js 16 (App Router) + 自定义服务端入口 `src/server.ts`
- **Core**: React 19，TypeScript 5
- **UI/Styling**: Tailwind CSS 4 + 手写 Apple 风格（白底 #FFFFFF、文字 #1D1D1F、唯一强调色 #0071E3；见 `DESIGN.md`）
- **包管理器**: `pnpm`（严禁 npm/yarn）
- **LLM 接入**: `coze-coding-dev-sdk` 的 LLM 能力调**豆包**（快速预诊；支持 `client.stream` 流式）
- **工作流接入**: 扣子 `POST /v1/workflow/run`（非流式）与 `/v1/workflow/stream_run`（流式事件）（深度论证）

## 科创赛知识库（`src/data/*.json` + `src/lib/knowledge.ts`）

- `review-rules.json` 评审规则库（rule_type, rule_name, rule_content, severity：三自/三性红线、创新性/科学性权重、答辩/工作量扣分项）
- `past-cases.json` 往届案例库（project_name, core_tech, award_level, innovation_tags, sea_status 红海/中等/蓝海, differentiation_hint）
- `capability-boundary.json` 能力边界库（zone 安全区/高风险区, item, alternative）
- `knowledge.ts`：`SCIENCE_FAIR_CONTEXT()` 压缩三表为注入文本；`redSeaHitOnText(text)` 红海案例关键字命中检测（垃圾分类/人脸门禁/浇花 等），命中返回案例 + 差异化建议。

## 双模式引擎（核心）

### 快速预诊（`src/lib/decomposer.ts`，纯 LLM）
- `judge(context, headers, scene?)`：调用1「清晰度判断」。`JUDGE_SYSTEM` 为**评委视角**（严格、不恭维、「太宽泛，需要聚焦」）；scene/category 命中「科创赛诊断」时追加 `SCIENCE_FAIR_EXPERT`（三自原则/三性原则）**并注入 `SCIENCE_FAIR_CONTEXT()` 知识库 + 红海关键字检测职责**（命中在 `missing_info` 标注「该方向已高度饱和，需差异化」）。JSON：`{clarity(0-3从严), category, clarity_desc, missing_info[], next_question, options[{label,hint}], source_tags[]}`。模型 `MODEL_JUDGE`。
- `decomposeReport(context, headers, category?)`：调用2「完整拆解」，输出 Markdown 报告；**科创赛场景同样注入知识库**；返回 `{report, checklist(14项), source_tags}`。模型 `MODEL_REPORT`。
- `streamReport(context, headers, category?)`：`LLMClient.stream()` 逐 token 返回报告正文，末尾 item 携带完整串（`{kind:'__final', full}`）。
- `splitReviewOutput(full)`：从报告全文拆分出 `checklist` / `source_tags`（报告内嵌 `---CHECKLIST_JSON---` 分隔块）。
- `checklist` 14 项固定：自主选题核查/创新性论证/科学性校验/查重比对/能力边界校验/工作量规划/技术路线核查/时间线合理性/资源匹配/风险预案/差异化空间/展示逻辑/答辩风险/迭代空间；每项 `{item,status:'pass'|'warn'|'fail',note}`。
- `buildContextInput()` 拼「第1轮:[..]第2轮:[..]」；`isNewTopic()` 命中触发词清空历史。

### 深度论证（`src/lib/workflow.ts` + `workflowStream.ts`，扣子工作流）
- `deepRun(context)`：非流式兜底，一次完成判断+拆解，`findKey` 递归取 `clarity/question_result/solution_result`。
- `streamDeepWorkflow(context)`：优先 `POST /v1/workflow/stream_run` 解析节点事件；`REVIEW_STAGES` 为默认评审环节（立项材料审查→报告整合 9 项，带 keyword 用于节点名模式匹配，未匹配归「扩展检查项」），`FALLBACK_STAGES` 为降级定时环节；事件 `{kind:'node', status,label,desc,idx}` / `{kind:'result', result}`；`try` 失败（找不到节点/超时）则 `animateFallback` 定时播放后调用 `deepRun` 兜底。
- 配置在 `src/lib/config.ts` 的 `DEEP_CONFIG`（workflowId、inputParam=context、timeoutMs）。

## 目录结构

```
├── scripts/                 # 构建/启动/预览脚本（dev.sh 起 5000）
├── src/
│   ├── app/
│   │   ├── page.tsx         # 三幕式页面（首屏/对话/报告）+ 模式开关 + 场景胶囊 + 评审日志面板 + 快速打字机 + 雷区警示榜
│   │   ├── layout.tsx       # 根布局（metadata 中文标题）
│   │   ├── api/chat/route.ts# 后端：多轮上下文 → quick(LLM)/deep(工作流)，支持 SSE 流式
│   │   └── globals.css      # Apple 设计 token + 毛玻璃 + 光斑 + review-pulse/caret 动效 + 打印
│   ├── components/DiagnosisCard.tsx # 追问诊断卡片（清晰度可视化、缺失信息、可点选项）
│   ├── components/ReportView.tsx    # 苹果页式报告（行动看板 checkbox 本地持久、风险红区、14 项评审检查清单、依据标签）
│   ├── data/                # 科创赛知识库三表 JSON
│   ├── lib/
│   │   ├── config.ts        # LLM_CONFIG + DEEP_CONFIG
│   │   ├── knowledge.ts     # 知识库压缩注入 + 红海命中检测
│   │   ├── decomposer.ts    # 快速预诊 LLM 引擎（judge/decomposeReport/streamReport/splitReviewOutput）
│   │   ├── workflow.ts      # 深度模式非流式调用
│   │   └── workflowStream.ts# 深度模式流式事件 + REVIEW_STAGES/FALLBACK_STAGES + 节点映射
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

## 配置

- **认证**：`coze-coding-dev-sdk` 的 `Config()` 自动从 Coze Coding 运行环境注入；深度论证需 `COZE_PAT`（扣子开放平台令牌）放环境变量（`.env.local`，git 忽略）。**严禁在代码/配置文件写死密钥。**
- **WORKFLOW_ID**：`src/lib/config.ts` 的 `DEEP_CONFIG.workflowId`（可用环境变量 `WORKFLOW_ID` 覆盖）。
- 可选模型覆盖：`MODEL_JUDGE` / `MODEL_REPORT`。

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
- **LLM 账户欠费**：`judge/decomposeReport/streamReport` 抛「[临时不可用] 余额已欠费」→ `/api/chat` 返回 502 带 detail，流式路径发 `error` 事件；属外部依赖，前端正常显示错误，不白屏。
- **深度流式节点匹配**：`REVIEW_STAGES` 以 keyword 模式匹配真实工作流节点名，未匹配归「扩展检查项」；映射可后续按真实节点校正（用户保留校正权）。
- **判断解析失败**：`extractJson` 剥围栏/首个 `{}`/重试，仍失败则报错不崩溃。
- **换话题误清空**：仅整段匹配触发词（长度 ≤14）才清空。
- **报告渲染**：优先 Markdown 标题/列表/行动清单（解析成任务卡：优先级标签【高】红/#FF6B6B、【中】橙/#FFA94D、【低】灰/#ADB5BD + 预计耗时 + 验收标准 + 依赖项 + checkbox），无法解析按纯文本兜底；`---CHECKLIST_JSON---` 分隔块被引擎截取为 `checklist/source_tags`。
- **诊断卡片**：`judge` 返回的 `options`/`missing_info` 解析失败时给空数组 + 默认选项兜底，不崩溃。
- **边界**：前端不重复实现 AI 逻辑，判断/拆解只由引擎（LLM/工作流）负责。
- **Hydration**：聊天页 `'use client'`，localStorage 读取在 `useEffect` 且先置 `hydrated`；`window.print`/`navigator.clipboard` 仅在用户交互时调用。