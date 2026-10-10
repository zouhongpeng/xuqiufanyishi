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

  /**
   * DeepSeek 直连配置（可选）：配置 DEEPSEEK_API_KEY 后，快速预诊与深度论证链
   * 优先直连 DeepSeek API（用户自有额度）；未配置时回退 coze-coding-dev-sdk。
   * 密钥只放 .env.local / 部署环境变量，严禁写入代码或本配置文件。
   */
  deepseek: {
    baseUrl: (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, ''),
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    /** 快速模式两次调用 / 报告整合 / 检查清单 */
    chatModel: process.env.DEEPSEEK_CHAT_MODEL || 'deepseek-chat',
    /** 深度论证多视角与评委质询（reasoning_content 为思维链） */
    reasoningModel: process.env.DEEPSEEK_REASONING_MODEL || 'deepseek-reasoner',
    /** 单次推理模型尝试的超时：超时或失败 → 降级 chat 模型 + 逐步推理提示 */
    reasoningTimeoutMs: 60_000,
    timeoutMs: 180_000,
  },
} as const;

/**
 * 深度模式（扣子工作流）配置。
 * 明文令牌 COZE_PAT 一律只从环境变量读取（.env.local / 部署平台注入），
 * 严禁写入代码或本配置文件。
 */
export const DEEP_CONFIG = {
  /** 扣子工作流 API 地址（国内版） */
  apiBase: process.env.COZE_API_BASE || 'https://api.coze.cn/v1/workflow/run',

  /** 扣子工作流流式接口 */
  streamRunUrl:
    process.env.COZE_STREAM_BASE || 'https://api.coze.cn/v1/workflow/stream_run',

  /** 深度模式使用的工作流 ID（放配置文件；可用环境变量 WORKFLOW_ID 覆盖） */
  workflowId:
    process.env.WORKFLOW_ID || '7691974364770648064',

  /** 工作流「开始」节点的输入参数名 */
  inputParam: process.env.COZE_INPUT_PARAM || 'context',

  /** 工作流调用超时（毫秒）。深度模式可能耗时较长 */
  timeoutMs: 320_000,
} as const;