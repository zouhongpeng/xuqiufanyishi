/**
 * 扣子工作流接入配置。
 *
 * 部署/演示前请把以下两项按你的扣子工作流实际值填好：
 *  - workflowId：工作流 ID（在工作流发布页复制）
 *  - inputParam：工作流「开始」节点输入参数的参数名（以实际配置为准）
 *
 * COZE_PAT（访问令牌）属于机密，必须放在环境变量（.env.local 或部署平台的环境变量），
 * 严禁写进前端代码或本配置文件。
 */
export const COZE_CONFIG = {
  /** 你的扣子工作流 ID，例如 "7472xxxxxxxxxxxx" */
  workflowId: process.env.WORKFLOW_ID || 'YOUR_WORKFLOW_ID',

  /** 工作流「开始」节点里拼接好的上下文所用的输入参数名 */
  inputParam: process.env.COZE_INPUT_PARAM || 'context',

  /** 扣子工作流运行 API（国内版）。如需国际版可改为 https://api.coze.com/v1/workflow/run */
  apiBase: process.env.COZE_API_BASE || 'https://api.coze.cn/v1/workflow/run',
} as const;

/** 访问令牌来自环境变量，防止误提交 */
export const COZE_PAT = process.env.COZE_PAT || '';

/** 配置是否就绪（PAT 与工作流 ID 都已填写） */
export function isCozeConfigured(): boolean {
  return Boolean(COZE_PAT) && COZE_CONFIG.workflowId !== 'YOUR_WORKFLOW_ID';
}