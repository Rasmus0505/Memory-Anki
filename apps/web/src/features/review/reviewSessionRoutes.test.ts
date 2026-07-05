import { describe, expect, it } from 'vitest'
import {
  buildReviewOverviewPath,
  buildReviewSessionPath,
} from '@/features/review/reviewSessionRoutes'

describe('reviewSessionRoutes', () => {
  it('builds review overview and session paths with optional chapter id', () => {
    expect(buildReviewOverviewPath()).toBe('/review')
    expect(buildReviewOverviewPath(12)).toBe('/review?chapterId=12')
    expect(buildReviewSessionPath(309)).toBe('/review/session/309')
    expect(buildReviewSessionPath(309, 12)).toBe('/review/session/309?chapterId=12')
  })
})
