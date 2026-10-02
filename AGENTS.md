# 项目上下文

## 项目概述

「需求拆解师」——科创大赛展示作品。定位：**一个安静的拆解大师**（对标苹果官网设计语言），把模糊想法拆成可执行方案。
产品流程：用户输入想法 → 引擎判断清晰度(0-3) → 低则追问 → 继续对话 → 清晰度≥2 生成完整拆解报告（方案/行动清单/A·B·C）。
**双模式引擎**：快速(LLM 两次调用，秒级) / 深度(扣子工作流，约1分钟、逐节点分析)。

## 技术栈

- **Framework**: Next.js 16 (App Router) + 自定义服务端入口 `src/server.ts`
- **Core**: React 19，TypeScript 5
- **UI/Styling**: Tailwind CSS 4 + 手写 Apple 风格（白底 #FFFFFF、文字 #1D1D1F、唯一强调色 #0071E3；见 `DESIGN.md`）
- **包管理器**: `pnpm`（严禁 npm/yarn）
- **LLM 接入**: `coze-coding-dev-sdk` 的 LLM 能力调**豆包**（快速模式）
- **工作流接入**: 扣子 `POST /v1/workflow/run`（深度模式）

## 双模式引擎（核心）

### 快速模式（`src/lib/decomposer.ts`，纯 LLM）
- `judge()`：调用1「需求清晰度判断」，`JUDGE_SYSTEM` 输出 JSON `{clarity, category, clarity_desc, next_question}`，clarity 0-3 从严判；模型 `MODEL_JUDGE`（doubao mini）。
- `decomposeReport()`：调用2「完整拆解」，clarity≥2 时生成 Markdown 报告（需求理解/拆解方案/风险规避/行动清单/继续推进 A·B·C）；模型 `MODEL_REPORT`（doubao pro）。
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
│   ├── components/ReportView.tsx  # 苹果产品页式报告（Markdown 解析、行动清单卡片、低饱和优先级、复制/打印）
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

- **前端入口**: `src/app/page.tsx` —— 三幕式：首屏(slogan「把想法，拆到能执行。」+ 大输入框 + 场景胶囊)、对话(气泡 + 模式徽标)、报告(满屏苹果页 + A/B/C + 一键复制)；localStorage 持久化会话与模式；深度等待显示「专项分析节点」逐条浮现进度。
- **后端接口**: `POST /api/chat`，body `{ sessionId, message, mode?, scene? }`；mode=quick|deep，scene 作为弱提示辅助归类。
  - returns `{ type:'question'|'solution', mode, clarity, category, clarity_desc, content, round }`
  - 内存 Map 维护每 session 多轮用户消息；命中「新需求」触发词清空重开。
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
- 需求判断要「从严」，多数清晰度为 0/1，追问一次只问最关键一件事。
- 视觉：苹果官网风格，全站唯一强调色 #0071E3，禁弹跳/花哨动画。

## 常见问题和预防

- **深度模式失败**：多为 `COZE_PAT` 未配置或工作流较慢；`/api/chat` 返回 502 带 detail，前端显示报错气泡。
- **判断解析失败**：`extractJson` 剥围栏/首个 `{}`/重试，仍失败则报错不崩溃。
- **换话题误清空**：仅整段匹配触发词（长度 ≤14）才清空。
- **报告渲染**：优先 Markdown 标题/列表/行动清单（【高】红/#FF6B6B、【中】橙/#FFA94D、【低】灰/#ADB5BD 低饱和彩标），无法解析按纯文本兜底。
- **Hydration**：聊天页 `'use client'`，localStorage 读取在 `useEffect` 且先置 `hydrated`；`window.print`/`navigator.clipboard` 仅在用户交互时调用。