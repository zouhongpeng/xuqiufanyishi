# 项目上下文

## 项目概述

「需求拆解师」——科创大赛用的对话式需求拆解 Web 应用。
用户输入一个模糊想法 → 后端调用豆包大模型做「需求清晰度判断」→ 不够清楚则返回追问、继续对话 → 清晰度 ≥2 时再调用一次大模型生成完整拆解报告（方案 + 行动清单 + 后续 A/B/C 选择）。
**判断与拆解逻辑全部由 LLM 完成（不依赖扣子工作流 API），本仓库负责对话交互、多轮上下文维护与报告展示。**

## 技术栈

- **Framework**: Next.js 16 (App Router) + 自定义服务端入口 `src/server.ts`
- **Core**: React 19，**TypeScript 5**
- **UI/Styling**: Tailwind CSS 4 + 少量手写 CSS（工程蓝图风格，见 `DESIGN.md`）
- **包管理器**: `pnpm`（严禁 npm/yarn）
- **LLM 接入**: `coze-coding-dev-sdk` 的 LLM 能力调用**豆包**大模型（判断用 mini 低时延、拆解用 pro 强推理）

## LLM 引擎（核心）

- **引擎文件**: `src/lib/decomposer.ts`
  - `judge()`：调用1「需求清晰度判断」，`JUDGE_SYSTEM` 提示词要求严格输出 JSON `{clarity, category, clarity_desc, next_question}`。clarity 0-3，从严判，默认低分。
  - `decomposeReport()`：调用2「完整拆解」，`DECOMPOSE_SYSTEM` 提示词生成 Markdown 报告（需求理解/拆解方案/风险规避/行动清单/继续推进 A·B·C）。
  - `llmInvoke()`：`LLMClient` + `Config` + `HeaderUtils.extractForwardHeaders(req.headers)`；`invoke()` 非流式；`thinking:'disabled', caching:'disabled'`。
  - `extractJson()`：稳健提取 LLM 响应的 JSON（兼容 ```json 围栏、前后杂质），失败自动重试（见 `LLM_CONFIG.retries`）。
  - `isNewTopic()`：命中「新需求/换话题/重新开始/换一个…」等整段触发词时清空历史；`buildContextInput()` 把轮次拼成「第1轮:[…]第2轮:[…]」传给 LLM。
- **模型配置**: `src/lib/config.ts` —— `MODEL_JUDGE`（默认 doubao-seed-2-0-mini）、`MODEL_REPORT`（默认 doubao-seed-2-0-pro）、超时、重试次数（可用环境变量覆盖）。

## 目录结构

```
├── scripts/                 # 构建/启动/预览脚本（模板自带；dev.sh 起 5000）
├── src/
│   ├── app/
│   │   ├── page.tsx         # 聊天主页面（'use client'，聊天气泡 + 报告 + A/B/C 快捷按钮）
│   │   ├── layout.tsx       # 根布局（metadata 中文标题）
│   │   ├── api/chat/route.ts# 后端：多轮上下文 → judge →（clarity≥2 时）decompose
│   │   └── globals.css      # 全局样式 + 蓝图网格 + 打印样式
│   ├── components/ReportView.tsx  # 报告渲染器（Markdown-lite/JSON、优先级彩标、复制/打印、A/B/C 操作）
│   ├── lib/
│   │   ├── config.ts        # LLM 模型/超时/重试配置
│   │   └── decomposer.ts    # LLM 需求拆解引擎（judge + decompose）
│   └── server.ts            # Next 自定义 HTTP 入口（读 PORT，默认 5000）
├── .env.example             # 环境变量模板（LLM 模型覆盖项）
├── .coze                    # 项目/预览/部署配置
└── DESIGN.md                # 设计风格（工程蓝图意象）
```

## 关键入口 / 核心逻辑

- **前端入口**: `src/app/page.tsx` —— 聊天气泡 UI、localStorage 会话持久化、`/api/chat` 调用、报告展示 + 一键复制 + A/B/C 快捷继续。
- **后端接口**: `POST /api/chat`，body `{ sessionId, message }`
  - returns `{ type:'question', clarity, category, clarity_desc, content:next_question, round }`（clarity ≤1，展示追问）
  - 或 `{ type:'solution', clarity, category, clarity_desc, content:markdownReport, round }`（clarity ≥2，ReportView 渲染报告）
  - 内部用内存 Map 维护每个 sessionId 的多轮用户消息；命中「新需求」触发词则清空重新从第 1 轮开始。
- **接续 A/B/C**: 报告下方的 A/B/C 快捷按钮（A 做第一步 / B 评估时间成本 / C 调整方向）作为普通用户消息进入多轮上下文继续对话，引擎据此再判断→拆解。

## 运行与预览

- 可预览型（`project_type = web`，`preview_enable = enabled`），预览暴露端口 **5000**（读 `.preview` 的 `expose_port`）。
- 预览：`bash ./scripts/dev.sh`（[dev].run）；生产构建/启动：`bash ./scripts/build.sh` / `bash ./scripts/start.sh`（[deploy]，`src/server.ts` 读 `PORT`=5000）。
- 验收：web 项目统一用 `test_run` 做静态检查（lint/ts-check）+ 接口冒烟 + 服务探活。

## 配置（无必须手工项）

- **大模型凭据**：`coze-coding-dev-sdk` 的 `Config()` 自动从 Coze Coding 运行环境注入（`COZE_WORKLOAD_IDENTITY_API_KEY` 等），本地/沙箱无需配置明文密钥；部署到其他平台按该平台要求注入对应密钥环境变量。**严禁在代码或配置文件中写死密钥。**
- **可选覆盖模型**：环境变量 `MODEL_JUDGE` / `MODEL_REPORT`（默认见 `src/lib/config.ts`）。

## 用户偏好与长期约束

- 判断与拆解逻辑只由 LLM 负责，前端/仓库不重复实现 AI 逻辑，不用扣子工作流。
- 模型密钥只通过后端环境变量读取，绝不进前端。
- 多轮上下文由后端维护；前端 localStorage 仅缓存渲染消息，供刷新后恢复展示。
- 需求判断要「从严」，大多数清晰度应为 0/1，追问一次只问最关键的一件事。

## 常见问题和预防

- **工具返回失败**：多为 `coze-coding-dev-sdk` 凭据/网络问题；`/api/chat` 返回 502 并带 `detail`，前端显示报错气泡。
- **判断结果解析失败**：`extractJson` 会剥围栏、取首个 `{}`、失败自动重试 `LLM_CONFIG.retries` 次；仍失败则报错，不崩溃。
- **换话题误清空**：仅整段匹配「新需求 / 换话题 / 重新开始」等触发词（且长度 ≤14）才清空，对话正文出现不触发。
- **报告渲染**：优先解析 Markdown 标题/列表/行动清单（含 【高】〔红〕【中】〔橙〕【低】〔灰〕优先级彩标），无法解析则按纯文本优雅兜底。
- **Hydration**：聊天页为 `'use client'`，localStorage 读取在 `useEffect` 中并先置 `hydrated`；报告内 `window.print`/`navigator.clipboard` 仅在用户交互时调用。