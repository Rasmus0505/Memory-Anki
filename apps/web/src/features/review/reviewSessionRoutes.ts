function withChapterId(path: string, chapterId: number | null) {
  if (chapterId == null) return path
  return `${path}?chapterId=${chapterId}`
}

export function buildReviewOverviewPath(chapterId: number | null = null) {
  return withChapterId('/review', chapterId)
}

export function buildReviewSessionPath(reviewId: number, chapterId: number | null = null) {
  return withChapterId(`/review/session/${reviewId}`, chapterId)
}

export function buildSegmentReviewSessionPath(reviewId: number, chapterId: number | null = null) {
  return withChapterId(`/segment-review/session/${reviewId}`, chapterId)
}

export function buildBatchSegmentReviewPath(segmentIds: number[]) {
  const normalizedSegmentIds = Array.from(
    new Set(
      segmentIds.filter((segmentId) => Number.isInteger(segmentId) && segmentId > 0),
    ),
  )
  if (normalizedSegmentIds.length === 0) {
    return '/segment-review/batch'
  }
  return `/segment-review/batch?segmentIds=${normalizedSegmentIds.join(',')}`
}
