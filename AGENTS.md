# 项目上下文

## 项目概述

「需求拆解师」——科创大赛用的对话式需求拆解 Web 应用。
用户输入一个模糊想法 → 后端调用扣子（Coze）工作流判断清晰度 → 不够清楚则返回追问、继续对话 → 清晰度足够则返回完整拆解报告（方案 + 行动清单）。
**判断与拆解逻辑全部由扣子工作流完成，本仓库只负责对话交互、多轮上下文维护与报告展示。**

## 技术栈

- **Framework**: Next.js 16 (App Router) + 自定义服务端入口 `src/server.ts`
- **Core**: React 19，**TypeScript 5**
- **UI/Styling**: Tailwind CSS 4 + 少量手写 CSS（工程蓝图风格，见 `DESIGN.md`）
- **包管理器**: `pnpm`（严禁 npm/yarn）
- **后端**: Next.js Route Handler（`src/app/api/chat/route.ts`），Node runtime 下调用 Coze 工作流 REST API

## 目录结构

```
├── scripts/                 # 构建/启动/预览脚本（模板自带）
│   ├── build.sh  start.sh   # 生产构建与启动（端口 5000）
│   ├── dev.sh  prepare.sh   # 开发/预览
│   └── ...
├── src/
│   ├── app/
│   │   ├── page.tsx         # 聊天主页面（'use client'）
│   │   ├── layout.tsx       # 根布局（metadata 中文标题）
│   │   ├── api/chat/route.ts# 后端：多轮上下文 + 调用扣子工作流 + 解析字段
│   │   └── globals.css      # 全局样式 + 蓝图网格 + 打印样式
│   ├── components/ReportView.tsx  # 报告渲染器（Markdown-lite / JSON，优先级标签，可打印）
│   ├── lib/
│   │   ├── coze-config.ts   # 工作流配置（WORKFLOW_ID / inputParam / apiBase）
│   │   └── coze.ts          # 工作流调用、解析、多轮上下文、换话题检测
│   └── server.ts            # Next 自定义 HTTP 入口（读 PORT，默认 5000）
├── .env.example             # 环境变量模板（COZE_PAT 等）
├── .coze                    # 项目/预览/部署配置
└── DESIGN.md                # 设计风格（工程蓝图意象）
```

## 关键入口 / 核心模块

- **前端对话入口**: `src/app/page.tsx` — 聊天气泡 UI、localStorage 会话持久化、`/api/chat` 调用、报告展示。
- **后端接口**: `POST /api/chat`，body `{ sessionId, message }`
  - 返回 `{ type: 'question', clarity, content, round }`（clarity ≤ 1，显示追问）或 `{ type: 'solution', clarity, content, round }`（clarity ≥ 2，渲染报告）。
  - 未配置时返回 `503 { error: 'COZE_NOT_CONFIGURED' }`，前端显示设置的琥珀色提示条。
- **工作流接入**: `src/lib/coze.ts`
  - 调 `POST https://api.coze.cn/v1/workflow/run`（`is_async: false`）。
  - `data` 字段是 JSON 字符串，需 `JSON.parse` 解析两层。
  - 从返回值稳妥提取 `clarity`(number)、`question_result`、`solution_result`（多层嵌套查找）。
  - 每个 sessionId 用内存 Map 保存多轮用户消息，拼成 `第1轮:[…] 第2轮:[…]` 传入参数；命中「新需求/换话题」触发词时清空历史。

## 运行与预览

- 可预览型（`project_type = web`，`preview_enable = enabled`），预览暴露端口 **5000**（读 `.preview` 的 `expose_port`）。
- 预览：`bash ./scripts/dev.sh`（[dev].run）；生产构建/启动：`bash ./scripts/build.sh` / `bash ./scripts/start.sh`（[deploy]，`src/server.ts` 读 `PORT`=5000）。
- 验收：web 项目统一用 `test_run` 做静态检查（lint/ts-check）+ 接口冒烟 + 服务探活。

## 配置清单（演示/部署前必填）

1. **COZE_PAT**（机密）：放环境变量（`.env.local` 或部署平台环境变量），严禁写进前端代码与配置文件。
2. **WORKFLOW_ID**：填 `src/lib/coze-config.ts` 的 `workflowId`（也可用环境变量 `WORKFLOW_ID` 覆盖）。
3. **输入参数名**：按工作流「开始」节点实际参数名填 `coze-config.ts` 的 `inputParam`（默认 `context`）。

## 用户偏好与长期约束

- 判断与拆解逻辑只由扣子工作流负责，前端不重复实现 AI 判断逻辑。
- COZE_PAT 只通过后端环境变量读取，绝不进前端。
- 多轮上下文由后端维护；前端 localStorage 仅缓存渲染消息，供刷新后恢复展示。

## 常见问题和预防

- **未配置导致对话报错**：初次使用需先填 COZE_PAT / WORKFLOW_ID / inputParam，否则 `/api/chat` 返回 `COZE_NOT_CONFIGURED`。
- **工作流返回解析**：`data` 需解析两层 JSON；字段缺失时走默认值，避免前端崩溃。
- **换话题误清空**：仅整段匹配「新需求 / 换话题 / 重新开始」等触发词，对话正文中出现这些词不会被清空。
- **Hydration**：聊天页为 `'use client'`，localStorage 读取在 `useEffect` 中完成并先置 `hydrated`，避免 SSR/CSR 不一致；报告组件内 `window.print` 仅在点击时调用。