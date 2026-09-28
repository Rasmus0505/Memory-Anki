/** Mid-round 「保存配置并重排」: keep overlapping progress, or mint a new round. */
export type FreestyleConfigSaveChoice = 'keep-overlap' | 'start-fresh'

export const OVERLAP_PROGRESS_PROMPT_TITLE = '保留重复的进度？'

export function overlapProgressPromptCopy() {
  return '和新配置重复的部分，已完成、已排除和重练会留在这一轮，做题已答也还在。保留则继续这一轮，只重排还没开始的卡片。不保留则按这份配置开启全新一轮，这些进度不再带入。'
}
