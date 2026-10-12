export function examStarsOf(card: object): number | null {
  const value = (card as { exam_stars?: number }).exam_stars
  return typeof value === 'number' && value >= 1 ? Math.min(3, Math.round(value)) : null
}

export function palaceReviewReturnPath(subjectId: string | null) {
  return subjectId && /^\d+$/.test(subjectId) ? `/palaces/list?subjectId=${subjectId}` : '/palaces'
}
