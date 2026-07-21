function withChapterId(path: string, chapterId: number | null) {
  if (chapterId == null) return path
  return `${path}?chapterId=${chapterId}`
}

export function buildReviewOverviewPath(chapterId: number | null = null) {
  return withChapterId('/review', chapterId)
}

export function buildReviewSessionPath(reviewId: string | number, chapterId: number | null = null) {
  return withChapterId(`/review/session/${reviewId}`, chapterId)
}
