import type { FreestyleFeedConfig, FreestyleQuizScope } from '@/shared/api/contracts'
import type { FreestyleRoundPlanState } from '@/modules/practice/domain/roundPlan'

export function overlayReviewPalaceIds(
  plan: FreestyleRoundPlanState | null | undefined,
  config?: FreestyleFeedConfig,
): number[] {
  if (!plan) return []
  const ids: number[] = []
  const seen = new Set<number>()
  for (const card of Object.values(plan.cardsById)) {
    if (card.occurrenceKind === 'retry') continue
    if (card.kind !== 'mindmap_branch') continue
    const palaceId = card.palaceId
    if (!palaceId || palaceId <= 0 || seen.has(palaceId)) continue
    const scope = config?.streams.memory_palace
    // Retained completed/retry sources do not widen an explicit picker subset.
    // Subject-only scopes are resolved authoritatively by the backend catalog.
    if (scope?.specific_palace_ids.length
      && (scope.subject_scope === 'all' || scope.subject_ids.length > 0)
      && !scope.specific_palace_ids.includes(palaceId)) continue
    seen.add(palaceId)
    ids.push(palaceId)
  }
  return ids
}

export function overlayQuizRangeLabel(palaceCount: number): string {
  if (palaceCount > 0) return `本轮纳入复习的 ${palaceCount} 个宫殿`
  return '本轮还没有纳入复习的宫殿'
}

export function overlayQuizScopeLabel(scope: FreestyleQuizScope): string {
  return scope === 'single_palace_random' ? '一个宫殿刷完再换' : '跨宫殿乱序'
}
