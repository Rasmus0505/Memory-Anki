import type { FreestyleCard, FreestyleOverlayQuizState } from '@/shared/api/contracts'

/** Question ids that already have answered / rated overlay progress. */
export function overlayProgressedQuestionIds(
  overlay: FreestyleOverlayQuizState | null | undefined,
): Set<number> {
  const ids = new Set<number>()
  if (!overlay) return ids
  for (const questionId of overlay.completed_ids || []) {
    if (Number.isInteger(questionId) && questionId > 0) ids.add(questionId)
  }
  for (const key of Object.keys(overlay.states || {})) {
    const questionId = Number(key)
    const state = overlay.states?.[key]
    if (!Number.isInteger(questionId) || questionId <= 0 || !state || typeof state !== 'object') continue
    if ((state as { resolved?: unknown }).resolved || (state as { rating?: unknown }).rating) {
      ids.add(questionId)
    }
  }
  const parked = overlay.parked
  if (parked) {
    for (const questionId of parked.completed_ids || []) {
      if (Number.isInteger(questionId) && questionId > 0) ids.add(questionId)
    }
    for (const key of Object.keys(parked.states || {})) {
      const questionId = Number(key)
      const state = parked.states?.[key]
      if (!Number.isInteger(questionId) || questionId <= 0 || !state || typeof state !== 'object') continue
      if ((state as { resolved?: unknown }).resolved || (state as { rating?: unknown }).rating) {
        ids.add(questionId)
      }
    }
  }
  return ids
}

/**
 * Cleared review palaces that still hold answered overlay progress and need a
 * manual confirm before drop. Unanswered-only membership does not prompt.
 */
export function overlayPalacesNeedingClearConfirm(
  overlay: FreestyleOverlayQuizState | null | undefined,
  clearedPalaceIds: readonly number[],
  declinedPalaceIds?: ReadonlySet<number>,
): number[] {
  if (!overlay || clearedPalaceIds.length === 0) return []
  const progressed = overlayProgressedQuestionIds(overlay)
  if (progressed.size === 0) return []
  const palaceMap = overlay.question_palace_ids || {}
  const declined = declinedPalaceIds ?? new Set<number>()
  const result: number[] = []
  for (const palaceId of clearedPalaceIds) {
    if (!Number.isInteger(palaceId) || palaceId <= 0 || declined.has(palaceId)) continue
    const hasProgress = Object.entries(palaceMap).some(([questionKey, mappedPalaceId]) => {
      if (Number(mappedPalaceId) !== palaceId) return false
      return progressed.has(Number(questionKey))
    })
    if (hasProgress) result.push(palaceId)
  }
  return result
}

export function overlayClearConfirmLabel(
  palaceIds: readonly number[],
  cards: readonly FreestyleCard[],
): string {
  const titles = new Map<number, string>()
  for (const card of cards) {
    if (card.type !== 'mindmap_branch') continue
    if (!palaceIds.includes(card.palace_id)) continue
    if (!titles.has(card.palace_id)) {
      titles.set(card.palace_id, card.palace_title?.trim() || `宫殿 ${card.palace_id}`)
    }
  }
  const labels = palaceIds.map((palaceId) => {
    const title = titles.get(palaceId) || `宫殿 ${palaceId}`
    return `《${title}》`
  })
  if (labels.length === 1) {
    return `${labels[0]}本轮复习已评完。是否清除该宫殿在本轮做题里的已答记录？取消则保留，之后可继续查看。`
  }
  return `${labels.join('、')}本轮复习已评完。是否清除这些宫殿在本轮做题里的已答记录？取消则保留，之后可继续查看。`
}
