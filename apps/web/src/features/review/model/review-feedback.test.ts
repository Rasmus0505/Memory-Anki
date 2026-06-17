import { describe, expect, it } from 'vitest'
import {
  createInitialReviewRewardSnapshot,
  getReviewMilestoneLabel,
  progressReviewRewardState,
  shouldEmitSurprise,
} from '@/features/review/model/review-feedback'

describe('review-feedback model', () => {
  it('uses custom milestone steps for reward progression', () => {
    const next = progressReviewRewardState({
      current: createInitialReviewRewardSnapshot([4, 8, 12, 20]),
      transition: {
        events: ['card_reveal'],
        expandedNodeIds: [],
        revealedNodeIds: ['node-a'],
        branchClearNodeIds: [],
        primaryNodeId: 'node-a',
        primaryEvent: 'card_reveal',
        milestoneStep: null,
        fxAnchor: null,
        depthHint: 2,
        allClearReady: false,
      },
      milestoneSteps: [4, 8, 12, 20],
    })

    expect(next.comboCount).toBe(1)
    expect(next.nextMilestone).toBe(4)
  })

  it('derives labels from the configured milestone list', () => {
    expect(getReviewMilestoneLabel([4, 8, 12, 20], 8)).toBe('热起来')
    expect(getReviewMilestoneLabel([4, 8, 12, 20], 20)).toBe('攻区')
  })

  it('only emits surprise text when the combo count hits configured milestones', () => {
    expect(
      shouldEmitSurprise({
        comboCount: 2,
        surpriseEnabled: true,
        nowMs: 1000,
        lastSurpriseAtMs: null,
        milestoneSteps: [4, 8, 12, 20],
      }),
    ).toBe(false)
    expect(
      shouldEmitSurprise({
        comboCount: 4,
        surpriseEnabled: true,
        nowMs: 1000,
        lastSurpriseAtMs: null,
        milestoneSteps: [4, 8, 12, 20],
      }),
    ).toBe(true)
  })
})
