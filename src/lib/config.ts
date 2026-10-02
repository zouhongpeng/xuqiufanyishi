/**
 * LLM 需求拆解引擎配置。
 *
 * 认证说明：coze-coding-dev-sdk 的 `Config()` 会自动从环境变量加载 API 凭据
 * （Coze Coding 运行环境已注入），无需也不应在代码中硬编码密钥。
 * 如需在外部环境部署，按运行环境注入对应的 API 密钥环境变量即可。
 */
export const LLM_CONFIG = {
  /** 需求判断：要求快，用低时延的 mini 模型 */
  judgeModel: process.env.MODEL_JUDGE || 'doubao-seed-2-0-mini-260215',

  /** 完整拆解：要求强推理，用 pro 模型 */
  reportModel: process.env.MODEL_REPORT || 'doubao-seed-2-0-pro-260215',

  /** 每次 LLM 调用的超时（毫秒） */
  timeoutMs: 90_000,

  /** JSON 解析失败后的重试次数（除首次外的补充次数） */
  retries: 2,
} as const;