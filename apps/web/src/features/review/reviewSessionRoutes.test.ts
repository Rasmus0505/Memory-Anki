import { describe, expect, it } from 'vitest'
import {
  buildBatchSegmentReviewPath,
  buildReviewOverviewPath,
  buildReviewSessionPath,
  buildSegmentReviewSessionPath,
} from '@/features/review/reviewSessionRoutes'

describe('reviewSessionRoutes', () => {
  it('builds review overview and session paths with optional chapter id', () => {
    expect(buildReviewOverviewPath()).toBe('/review')
    expect(buildReviewOverviewPath(12)).toBe('/review?chapterId=12')
    expect(buildReviewSessionPath(309)).toBe('/review/session/309')
    expect(buildReviewSessionPath(309, 12)).toBe('/review/session/309?chapterId=12')
  })

  it('builds segment review session and batch paths', () => {
    expect(buildSegmentReviewSessionPath(1407)).toBe('/segment-review/session/1407')
    expect(buildSegmentReviewSessionPath(1407, 12)).toBe('/segment-review/session/1407?chapterId=12')
    expect(buildBatchSegmentReviewPath([3, 2, 3, -1, 0])).toBe('/segment-review/batch?segmentIds=3,2')
    expect(buildBatchSegmentReviewPath([])).toBe('/segment-review/batch')
  })
})
