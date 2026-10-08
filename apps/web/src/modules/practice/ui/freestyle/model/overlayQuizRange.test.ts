import { describe, expect, it } from 'vitest'
import type { FreestyleRoundPlanState } from '@/modules/practice/domain/roundPlan'
import {
  emptyOverlayScopePalaces,
  overlayQuestionRating,
  overlayQuestionRatingLabel,
  overlayRoundReviewPalaceIds,
  overlayScopeActivePalaces,
  overlayScopeBlockedPalaces,
  overlayScopeLeftPool,
  overlayScopeLeftPoolNotice,
  overlayScopeReasonLabel,
  overlayScopeSummary,
} from './overlayQuizRange'
import type { FreestyleOverlayScopePalaces } from '@/shared/api/contracts'

function planCard(
  cardId: string,
  palaceId: number,
  kind = 'mindmap_branch',
  occurrenceKind: 'source' | 'retry' = 'source',
): FreestyleRoundPlanState['cardsById'][string] {
  return {
    cardId,
    sourceCardId: cardId,
    occurrenceKind,
    retryAttempt: occurrenceKind === 'retry' ? 1 : 0,
    palaceId,
    palaceTitle: `宫殿 ${palaceId}`,
    label: cardId,
    kind,
    status: 'pending',
    lastRating: null,
    retryAfterCards: 0,
    attemptCount: 0,
    updatedAt: 0,
  }
}

function scope(
  rows: Array<Partial<FreestyleOverlayScopePalaces['palaces'][number]>>,
): FreestyleOverlayScopePalaces {
  const palaces = rows.map((row, index) => ({
    palace_id: row.palace_id ?? index + 1,
    title: row.title ?? `宫殿 ${row.palace_id ?? index + 1}`,
    question_count: row.question_count ?? 0,
    objective: row.objective ?? row.question_count ?? 0,
    subjective: row.subjective ?? 0,
    in_pool: row.in_pool ?? true,
    reason: row.reason ?? ('' as const),
  }))
  return {
    scheduled_count: rows.length,
    in_pool_count: palaces.filter((row) => row.in_pool).length,
    question_count: palaces.reduce((sum, row) => sum + row.question_count, 0),
    palaces,
  }
}

describe('overlayQuizRange', () => {
  it('counts only review palaces already in this round, ignoring the feed config', () => {
    // This is the round-scoped set used for settlement clearing. It must NOT
    // apply the config filter: the pool scope comes from the backend report.
    const plan: FreestyleRoundPlanState = {
      roundId: 'round-1',
      configSignature: 'sig',
      createdAt: 0,
      candidateCount: 3,
      scheduledCount: 3,
      queueLimit: 20,
      limitReached: false,
      orderIds: ['a', 'b', 'q'],
      cardsById: {
        a: planCard('a', 10),
        b: planCard('b', 10),
        retry: planCard('retry', 99, 'mindmap_branch', 'retry'),
        q: planCard('q', 61, 'quiz_question'),
      },
    }
    expect(overlayRoundReviewPalaceIds(plan)).toEqual([10])
  })

  it('renders the backend scope report verbatim and splits active from blocked', () => {
    const report = scope([
      { palace_id: 23, title: '西欧中世纪的教育', question_count: 18, in_pool: true },
      { palace_id: 49, title: 'Governing Mental Health AI', question_count: 0, reason: 'no_questions', in_pool: false },
      { palace_id: 27, title: '第一节英国近代教育', question_count: 23, in_pool: true },
    ])
    expect(overlayScopeActivePalaces(report).map((row) => row.palace_id)).toEqual([23, 27])
    expect(overlayScopeBlockedPalaces(report).map((row) => row.palace_id)).toEqual([49])
    expect(overlayScopeSummary(report)).toBe('本轮纳入复习的 3 座宫殿 · 其中 2 座可做 · 41 题可做')
  })

  it('names the palaces when nothing in the round is playable', () => {
    const report = scope([
      { palace_id: 23, title: '西欧中世纪的教育', question_count: 0, reason: 'no_questions', in_pool: false },
      { palace_id: 49, title: 'Governing Mental Health AI', question_count: 0, reason: 'no_questions', in_pool: false },
    ])
    const summary = overlayScopeSummary(report)
    expect(summary).toContain('西欧中世纪的教育')
    expect(summary).toContain('当前都没有可做的题')
    expect(summary).not.toBe('本轮纳入复习的 2 个宫殿')
  })

  it('summarizes the all-in-pool case without the partial wording', () => {
    const report = scope([
      { palace_id: 1, title: 'A', question_count: 2 },
      { palace_id: 2, title: 'B', question_count: 3 },
    ])
    expect(overlayScopeSummary(report)).toBe('本轮纳入复习的 2 座宫殿 · 5 题可做')
  })

  it('has copy for every reason code and an empty default report', () => {
    expect(overlayScopeReasonLabel('no_questions')).toBe('还没有题目')
    expect(overlayScopeReasonLabel('kinds_filtered')).toBe('题型未勾选')
    expect(overlayScopeReasonLabel('')).toBe('')
    expect(overlayScopeSummary(emptyOverlayScopePalaces())).toBe('本轮还没有纳入复习的宫殿')
    expect(overlayScopeSummary(null)).toBe('本轮还没有纳入复习的宫殿')
  })

  it('names only the palaces a round change took out of the pool', () => {
    const before = scope([
      { palace_id: 1, title: '夸美纽斯', question_count: 4 },
      { palace_id: 2, title: '福禄培尔', question_count: 3 },
      { palace_id: 3, title: '本来就没题', question_count: 0, in_pool: false, reason: 'no_questions' },
    ])
    const after = scope([
      { palace_id: 1, title: '夸美纽斯', question_count: 4 },
      { palace_id: 2, title: '福禄培尔', question_count: 3, in_pool: false, reason: 'kinds_filtered' },
      { palace_id: 3, title: '本来就没题', question_count: 0, in_pool: false, reason: 'no_questions' },
    ])
    const left = overlayScopeLeftPool(before, after)
    // Palace 3 was never playable, so this change did not remove it.
    expect(left.map((row) => row.palace_id)).toEqual([2])
    expect(overlayScopeLeftPoolNotice(left)).toBe('随心范围已更新：福禄培尔 的题已移出本次做题。')
  })

  it('stays silent when a round change removed nothing playable', () => {
    const report = scope([{ palace_id: 1, title: 'A', question_count: 2 }])
    expect(overlayScopeLeftPoolNotice(overlayScopeLeftPool(report, report))).toBe('')
    expect(overlayScopeLeftPoolNotice([])).toBe('')
    expect(overlayScopeLeftPool(null, report)).toEqual([])
  })

  it('counts multiple removals in one notice', () => {
    const before = scope([
      { palace_id: 1, title: 'A', question_count: 1 },
      { palace_id: 2, title: 'B', question_count: 1 },
    ])
    const after = scope([
      { palace_id: 1, title: 'A', question_count: 1, in_pool: false, reason: 'kinds_filtered' },
      { palace_id: 2, title: 'B', question_count: 1, in_pool: false, reason: 'kinds_filtered' },
    ])
    const notice = overlayScopeLeftPoolNotice(overlayScopeLeftPool(before, after))
    expect(notice).toContain('A、B')
    expect(notice).toContain('2 座宫殿')
  })

  it('shows the score word for a rated question and words for an unrated one', () => {
    expect(overlayQuestionRatingLabel(2)).toBe('本轮最低 2 · 困难')
    expect(overlayQuestionRatingLabel(4)).toBe('本轮最低 4 · 轻松')
    // Never a zero: "not reviewed yet" must not look like "reviewed badly".
    expect(overlayQuestionRatingLabel(null)).toBe('本轮尚未复习')
  })

  it('reads a question rating only for real 1–4 scores', () => {
    const map = { 11: 2, 12: 4 }
    expect(overlayQuestionRating(map, 11)).toBe(2)
    expect(overlayQuestionRating(map, 12)).toBe(4)
    // Absent, malformed and out-of-range all mean "no score this round".
    expect(overlayQuestionRating(map, 13)).toBeNull()
    expect(overlayQuestionRating({ 13: 0 }, 13)).toBeNull()
    expect(overlayQuestionRating({ 13: 9 }, 13)).toBeNull()
    expect(overlayQuestionRating(undefined, 11)).toBeNull()
    expect(overlayQuestionRating(map, null)).toBeNull()
  })
})
