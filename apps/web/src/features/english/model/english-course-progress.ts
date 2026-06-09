import type { EnglishCourseDetail } from '@/shared/api/contracts'

export function resolveDisplaySentenceIndex(course: EnglishCourseDetail) {
  const sentenceCount = course.sentences.length
  if (sentenceCount <= 0) return 0

  const rawIndex = Number.isFinite(course.progress.currentSentenceIndex)
    ? Math.round(course.progress.currentSentenceIndex)
    : 0
  const clampedIndex = Math.max(0, Math.min(sentenceCount, rawIndex))

  if (course.progress.completed && clampedIndex >= sentenceCount) {
    return sentenceCount
  }

  if (clampedIndex < sentenceCount && course.sentences[clampedIndex]) {
    return clampedIndex
  }

  const completedSentenceSet = new Set(course.progress.completedSentenceIndexes)
  const firstUnfinishedIndex = course.sentences.findIndex((sentence) => !completedSentenceSet.has(sentence.index))
  if (firstUnfinishedIndex >= 0) {
    return firstUnfinishedIndex
  }

  return course.progress.completed ? sentenceCount : Math.max(0, sentenceCount - 1)
}
