import scenesData from '../../prompts/scenes.json';

interface SceneDef {
  icon?: string;
  supplement?: string;
}

const SCENES = scenesData as Record<string, SceneDef>;

/** 场景补充提示词：注入判断/拆解系统提示，让追问侧重与报告结构随场景微调 */
export function sceneSupplement(scene?: string): string {
  if (!scene) return '';
  const def = SCENES[scene];
  return def?.supplement ? `\n【场景补充指令 · ${scene}】${def.supplement}` : '';
}
