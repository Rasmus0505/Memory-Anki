import type { FreestyleFeedConfig, FreestyleQuizScope } from '@/shared/api/contracts'

export function overlayQuizPalaceIds(config: FreestyleFeedConfig): number[] {
  const quizIds = config.streams.quiz.specific_palace_ids
  if (quizIds.length) return [...quizIds]
  const memoryIds = config.streams.memory_palace.specific_palace_ids
  if (memoryIds.length) return [...memoryIds]
  return []
}

export function overlayQuizRangeLabel(config: FreestyleFeedConfig): string {
  const ids = overlayQuizPalaceIds(config)
  if (ids.length) return `当前配置已选 ${ids.length} 个宫殿`
  return '当前配置下的全部宫殿'
}

export function overlayQuizScopeLabel(scope: FreestyleQuizScope): string {
  return scope === 'single_palace_random' ? '一个宫殿刷完再换' : '跨宫殿乱序'
}
