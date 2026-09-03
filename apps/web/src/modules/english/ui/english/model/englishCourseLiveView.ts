export interface EnglishCourseLiveView {
  courseId: number
  typingSentenceIndex: number
  translationSentenceIndex: number | null
  sentencePhase: string
}

export function decodeEnglishCourseLiveView(raw: unknown): EnglishCourseLiveView | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  if (typeof record.courseId !== 'number' || !Number.isFinite(record.courseId)) return null
  return {
    courseId: record.courseId,
    typingSentenceIndex: typeof record.typingSentenceIndex === 'number' && Number.isFinite(record.typingSentenceIndex)
      ? record.typingSentenceIndex
      : 0,
    translationSentenceIndex: typeof record.translationSentenceIndex === 'number'
      ? record.translationSentenceIndex
      : null,
    sentencePhase: typeof record.sentencePhase === 'string' ? record.sentencePhase : 'listening_wait_input',
  }
}

export function applyEnglishCourseLiveView(
  current: EnglishCourseLiveView,
  remote: EnglishCourseLiveView,
): EnglishCourseLiveView {
  if (remote.courseId !== current.courseId) return current
  return {
    courseId: current.courseId,
    typingSentenceIndex: remote.typingSentenceIndex,
    translationSentenceIndex: remote.translationSentenceIndex,
    sentencePhase: remote.sentencePhase,
  }
}

export function resolveEnglishCourseProgressAfterLoad(
  courseId: number,
  loaded: Pick<EnglishCourseLiveView, 'typingSentenceIndex' | 'translationSentenceIndex' | 'sentencePhase'>,
  live: EnglishCourseLiveView | null,
) {
  if (live && live.courseId === courseId) {
    return {
      typingSentenceIndex: live.typingSentenceIndex,
      translationSentenceIndex: live.translationSentenceIndex,
      sentencePhase: live.sentencePhase,
    }
  }
  return loaded
}

export function englishCourseSameInteraction(previous: EnglishCourseLiveView, next: EnglishCourseLiveView) {
  return previous.typingSentenceIndex === next.typingSentenceIndex
    && previous.translationSentenceIndex === next.translationSentenceIndex
    && previous.sentencePhase === next.sentencePhase
}
