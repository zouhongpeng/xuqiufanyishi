import { buildContextInput, isNewTopic } from './decomposer';

/**
 * 会话上下文存储（内存）：/api/chat 与 /api/deep-analysis 共享，
 * 多轮用户消息按 sessionId 累积，命中换话题触发词即清空。
 */
const sessions = new Map<string, string[]>();

export function appendTurn(sessionId: string, message: string): { context: string; turns: string[] } {
  let turns = sessions.get(sessionId) ?? [];
  if (isNewTopic(message)) turns = [];
  turns.push(message);
  sessions.set(sessionId, turns);
  return { context: buildContextInput(turns), turns };
}

export function turnCount(sessionId: string): number {
  return (sessions.get(sessionId) ?? []).length;
}
