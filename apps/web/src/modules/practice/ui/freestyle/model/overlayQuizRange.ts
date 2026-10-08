import type {
  FreestyleOverlayScopePalaces,
  FreestyleOverlayScopeReason,
  FreestyleQuizScope,
} from '@/shared/api/contracts'
import type { FreestyleRoundPlanState } from '@/modules/practice/domain/roundPlan'

/**
 * Presentation for the backend's authoritative 做题 scope report.
 *
 * The scope itself is **not** computed here. `build_overlay_question_pack`
 * (apps/api/.../practice/application/overlay_quiz_service.py) is the single
 * owner and returns `scope_palaces`; this module only turns stable reason codes
 * into Chinese copy and formats the summary line.
 *
 * The scope is the round's own review set. The saved 随心 config is **not**
 * applied a second time: if the config selects 20 palaces but this round
 * scheduled 10, 做题 draws from those 10. An earlier version filtered by config
 * here and reported 「不在当前随心范围」 for palaces the round had scheduled —
 * and when the config was narrowed afterwards the pool silently emptied.
 */

export const OVERLAY_SCOPE_REASON_LABELS: Record<Exclude<FreestyleOverlayScopeReason, ''>, string> = {
  no_questions: '还没有题目',
  kinds_filtered: '题型未勾选',
  palace_removed: '已移除队列',
}

export function overlayScopeReasonLabel(reason: FreestyleOverlayScopeReason): string {
  if (!reason) return ''
  return OVERLAY_SCOPE_REASON_LABELS[reason] ?? ''
}

/** This-round rating for a question's bound knowledge points, if any. */
export function overlayQuestionRating(
  questionNodeRatings: Record<string, number> | undefined,
  questionId: number | null | undefined,
): number | null {
  if (questionId == null) return null
  const value = Number(questionNodeRatings?.[String(questionId)])
  return value === 1 || value === 2 || value === 3 || value === 4 ? value : null
}

/**
 * Badge copy for one question.
 *
 * A rated question shows the score plus its 忘记/困难/记得/轻松 word, so the
 * learner reads meaning rather than mapping a digit. An unrated question says
 * 「本轮尚未复习」 — never a zero, because "not reviewed yet" and "reviewed and
 * forgotten" are different states and must not look alike.
 */
export function overlayQuestionRatingLabel(rating: number | null): string {
  if (rating == null) return '本轮尚未复习'
  const words: Record<number, string> = { 1: '忘记', 2: '困难', 3: '记得', 4: '轻松' }
  return `本轮最低 ${rating} · ${words[rating] ?? ''}`.trim()
}

/**
 * Palaces this round scheduled as review units, whatever the feed config says.
 *
 * This answers a *different* question from the scope report: "which palaces may
 * this round clear 做题 progress for at settlement". It deliberately does not
 * apply the config filter — settlement clears this round's own history, and it
 * must still name a palace whose config entry was removed mid-round. Do not use
 * it to decide what the 做题 pool contains; read `scope_palaces` for that.
 */
export function overlayRoundReviewPalaceIds(
  plan: FreestyleRoundPlanState | null | undefined,
): number[] {
  if (!plan) return []
  const ids: number[] = []
  const seen = new Set<number>()
  for (const card of Object.values(plan.cardsById)) {
    if (card.occurrenceKind === 'retry') continue
    if (card.kind !== 'mindmap_branch') continue
    const palaceId = card.palaceId
    if (!palaceId || palaceId <= 0 || seen.has(palaceId)) continue
    seen.add(palaceId)
    ids.push(palaceId)
  }
  return ids
}

/** Empty report for a round with no scope yet (no round, or first open). */
export function emptyOverlayScopePalaces(): FreestyleOverlayScopePalaces {
  return { scheduled_count: 0, in_pool_count: 0, question_count: 0, palaces: [] }
}

/** The scope rows contributing questions right now. */
export function overlayScopeActivePalaces(scope: FreestyleOverlayScopePalaces | null | undefined) {
  return (scope?.palaces ?? []).filter((row) => row.in_pool)
}

/** Scheduled palaces that contribute nothing, with the reason to show. */
export function overlayScopeBlockedPalaces(scope: FreestyleOverlayScopePalaces | null | undefined) {
  return (scope?.palaces ?? []).filter((row) => !row.in_pool)
}

/**
 * Summary line for the 做题 dialog header.
 *
 * Names the palaces rather than only counting them: a bare count is what made
 * the original mismatch ("8 palaces" over an empty pool) invisible.
 */
export function overlayScopeSummary(scope: FreestyleOverlayScopePalaces | null | undefined): string {
  if (!scope || scope.scheduled_count === 0) return '本轮还没有纳入复习的宫殿'
  const inPool = scope.in_pool_count
  if (inPool === 0) {
    const names = scope.palaces.slice(0, 3).map((row) => row.title).join('、')
    const more = scope.palaces.length > 3 ? ` 等 ${scope.palaces.length} 座` : ''
    return `本轮纳入复习的 ${scope.scheduled_count} 座宫殿（${names}${more}）当前都没有可做的题`
  }
  const questionWord = scope.question_count > 0 ? ` · ${scope.question_count} 题可做` : ''
  if (inPool === scope.scheduled_count) {
    return `本轮纳入复习的 ${scope.scheduled_count} 座宫殿${questionWord}`
  }
  return `本轮纳入复习的 ${scope.scheduled_count} 座宫殿 · 其中 ${inPool} 座可做${questionWord}`
}

export function overlayQuizScopeLabel(scope: FreestyleQuizScope): string {
  return scope === 'single_palace_random' ? '一个宫殿刷完再换' : '跨宫殿乱序'
}

/**
 * Palaces that stopped contributing questions between two scope reports.
 *
 * Drives the notice after a 随心 config change. Only palaces that *were*
 * playable and are not any more count: a palace that had no questions before
 * and after did not "leave" because of this edit, and naming it would train the
 * learner to ignore the notice.
 */
export function overlayScopeLeftPool(
  before: FreestyleOverlayScopePalaces | null | undefined,
  after: FreestyleOverlayScopePalaces | null | undefined,
) {
  if (!before || !after) return []
  const nowPlayable = new Set(overlayScopeActivePalaces(after).map((row) => row.palace_id))
  return overlayScopeActivePalaces(before).filter((row) => !nowPlayable.has(row.palace_id))
}

/** Copy for the config-change notice; empty when nothing left the pool. */
export function overlayScopeLeftPoolNotice(
  left: FreestyleOverlayScopePalaces['palaces'],
): string {
  if (!left.length) return ''
  const names = left.map((row) => row.title).join('、')
  if (left.length === 1) return `随心范围已更新：${names} 的题已移出本次做题。`
  return `随心范围已更新：${names} 共 ${left.length} 座宫殿的题已移出本次做题。`
}
