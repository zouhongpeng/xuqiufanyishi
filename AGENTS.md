# 项目上下文

## 项目概述

「需求拆解师」——科创大赛展示作品。定位：**一个安静的拆解大师**（对标苹果官网设计语言），把模糊想法拆成可执行方案。
产品流程：用户输入想法 → 引擎判断清晰度(0-3) → 低则出「诊断卡片」追问（缺失信息 + 可点选项） → 继续对话 → 清晰度≥2 生成完整拆解「行动看板」报告（方案/风险/行动清单/A·B·C）。
**双模式引擎**：快速(LLM 两次调用) / 深度(扣子工作流，逐节点分析)。**场景标签默认「科创赛诊断」，此场景走评委专家视角。**

## 技术栈

- **Framework**: Next.js 16 (App Router) + 自定义服务端入口 `src/server.ts`
- **Core**: React 19，TypeScript 5
- **UI/Styling**: Tailwind CSS 4 + 手写 Apple 风格（白底 #FFFFFF、文字 #1D1D1F、唯一强调色 #0071E3；见 `DESIGN.md`）
- **包管理器**: `pnpm`（严禁 npm/yarn）
- **LLM 接入**: `coze-coding-dev-sdk` 的 LLM 能力调**豆包**（快速模式）
- **工作流接入**: 扣子 `POST /v1/workflow/run`（深度模式）

## 双模式引擎（核心）

### 快速模式（`src/lib/decomposer.ts`，纯 LLM）
- `judge(context, headers, scene?)`：调用1「需求清晰度判断」。`JUDGE_SYSTEM` 为**评委视角**（严格、不恭维、「太宽泛，需要聚焦」）；当 scene/category 命中 `SCIENCE_FAIR_EXPERT`（scence 即「科创赛诊断」）时追加评委专家设定（三自原则/三性原则，查真实性、创新点、工作量可行性、红海撞车）。JSON：`{clarity(0-3从严), category, clarity_desc, missing_info[], next_question, options[{label,hint}]}`。模型 `MODEL_JUDGE`（doubao mini）。
- `parseOptions()`/`parseStringList()`：容错解析 `options[]` / `missing_info[]`（缺省给空数组，兜底 2 个默认选项）。
- `decomposeReport(context, headers, category?)`：调用2「完整拆解」，clarity≥2 时生成 Markdown 报告（需求理解/拆解方案/风险规避/行动清单/继续推进 A·B·C）；category 命中科创赛诊断同样追加评委设定；模型 `MODEL_REPORT`（doubao pro）。
- `llmInvoke()`：`LLMClient` + `Config` + `HeaderUtils.extractForwardHeaders(req.headers)`；非流式。
- `extractJson()`：剥围栏/取 `{}`/失败重试。
- `isNewTopic()`：命中「新需求/换话题/重新开始…」清空历史；`buildContextInput()` 拼「第1轮:[..]第2轮:[..]」。

### 深度模式（`src/lib/workflow.ts`，扣子工作流）
- `deepRun(context)`：调用工作流一次完成「判断+拆解」，`data` 双层 JSON 解析，`findKey` 递归取 `clarity/question_result/solution_result`；clarity≤1 回 question_result，≥2 回 solution_result。
- 配置在 `src/lib/config.ts` 的 `DEEP_CONFIG`（`workflowId` 放配置文件，`inputParam` 默认 context）。

## 目录结构

```
├── scripts/                 # 构建/启动/预览脚本（dev.sh 起 5000）
├── src/
│   ├── app/
│   │   ├── page.tsx         # 三幕式页面（首屏/对话/报告）+ 双模式开关 + 场景胶囊 + 深度进度动画
│   │   ├── layout.tsx       # 根布局（metadata 中文标题）
│   │   ├── api/chat/route.ts# 后端：多轮上下文 → 按 mode 分发 quick(LLM)/deep(工作流)
│   │   └── globals.css      # Apple 设计 token + 毛玻璃 + 光斑 + 动效 + 打印
│   ├── components/DiagnosisCard.tsx # 追问诊断卡片（清晰度可视化、缺失信息、可点选项）
│   ├── components/ReportView.tsx    # 苹果产品页式报告（行动看板 + checkbox 本地持久、风险红色预警区、复制/打印）
│   ├── lib/
│   │   ├── config.ts        # LLM_CONFIG + DEEP_CONFIG
│   │   ├── decomposer.ts    # 快速模式 LLM 引擎（judge + decompose）
│   │   └── workflow.ts      # 深度模式扣子工作流调用
│   └── server.ts            # Next 自定义 HTTP 入口（读 PORT，默认 5000）
├── .env.example             # 环境变量模板
├── .coze                    # 项目/预览/部署配置
└── DESIGN.md                # 苹果设计语言
```

## 关键入口 / 核心逻辑

- **前端入口**: `src/app/page.tsx` —— 三幕式：首屏(slogan「说出你的想法，我帮你拆到能执行。」+ 大输入框 + 输入框下方小字「专家知识库已就绪 · 支持深度推理」 + 场景胶囊 [科创赛诊断✓默认] [视频创作] [写作] [创业] [学习] [活动])、对话(气泡 + 模式徽标；AI 追问若带 `options` 则渲染成 `DiagnosisCard`，点选项=作为回答发送)、报告(满屏苹果页 + A/B/C + 一键复制)；localStorage 持久化会话/模式/消息与任务勾选。
- **后端接口**: `POST /api/chat`，body `{ sessionId, message, mode?, scene? }`；mode=quick|deep，scene 作为弱提示辅助归类。
  - returns `{ type:'question'|'solution', mode, clarity, category, clarity_desc, content, round, missing_info?, options? }`
  - 内存 Map 维护每 session 多轮用户消息；命中「新需求」触发词清空重开。
  - scene 上下文追加（`（用户期望聚焦场景：{scene}）`）只在 **deep 模式**做，避免与 quick judge 的 sceneHint 重复。
- **接续 A/B/C**: 报告底部三个胶囊按钮，点击作为新轮用户消息进入多轮上下文继续对话。

## 运行与预览

- 可预览型（`project_type = web`，`preview_enable = enabled`），预览暴露端口 5000（读 `.preview`）。
- 预览：`bash ./scripts/dev.sh`；生产：`bash ./scripts/build.sh` / `bash ./scripts/start.sh`（`src/server.ts` 读 `PORT`=5000）。
- 验收：web 项目统一用 `test_run` 静态检查 + 接口冒烟 + 探活。

## 配置

- **认证**：`coze-coding-dev-sdk` 的 `Config()` 自动从 Coze Coding 运行环境注入；深度模式需 `COZE_PAT`（扣子开放平台令牌）放环境变量（`.env.local`，git 忽略）。**严禁在代码/配置文件写死密钥。**
- **WORKFLOW_ID**：放配置文件 `src/lib/config.ts` 的 `DEEP_CONFIG.workflowId`（可用环境变量 `WORKFLOW_ID` 覆盖）。
- 可选模型覆盖：`MODEL_JUDGE` / `MODEL_REPORT`。

## 用户偏好与长期约束

- 判断与拆解逻辑只由引擎（LLM/工作流）负责，前端不重复实现 AI 逻辑。
- 密钥只走后端环境变量，绝不进前端。
- 多轮上下文由后端维护；前端 localStorage 仅缓存渲染消息供刷新恢复。
- 需求判断要「从严」+「评委视角」，多数清晰度为 0/1，追问一次只问最关键一件事，摆出缺失信息与 2-4 个可点选项。
- 视觉：苹果官网风格，全站唯一强调色 #0071E3，禁弹跳/花哨动画；展示文案不暴露技术实现（如「两次调用」「秒级」）。
- 行动清单勾选状态存 `localStorage`（key 前缀 `req-decomposer:check:`），刷新保留。
- 风险规避渲染为红色警示区（左红竖条 + 浅红底 #fff5f5），标题「风险预警与降级方案」。

## 常见问题和预防

- **深度模式失败**：多为 `COZE_PAT` 未配置或工作流较慢；`/api/chat` 返回 502 带 detail，前端显示报错气泡。
- **判断解析失败**：`extractJson` 剥围栏/首个 `{}`/重试，仍失败则报错不崩溃。
- **换话题误清空**：仅整段匹配触发词（长度 ≤14）才清空。
- **报告渲染**：优先 Markdown 标题/列表/行动清单（解析成任务卡：优先级标签【高】红/#FF6B6B、【中】橙/#FFA94D、【低】灰/#ADB5BD + 预计耗时 + 验收标准 + 依赖项 + checkbox），无法解析按纯文本兜底。
- **诊断卡片**：`judge` 返回的 `options`/`missing_info` 解析失败时给空数组 + 默认选项兜底，不崩溃。
- **边界**：前端不重复实现 AI 逻辑，判断/拆解只由引擎（LLM/工作流）负责。
- **Hydration**：聊天页 `'use client'`，localStorage 读取在 `useEffect` 且先置 `hydrated`；`window.print`/`navigator.clipboard` 仅在用户交互时调用。