import {
  getFocusPracticeSessionProgressApi,
  getPalaceFocusSessionApi,
  getPalaceEditorApi,
  getPracticeSessionProgressApi,
  getSegmentPracticeSessionProgressApi,
  getMiniPracticeSessionProgressApi,
} from '@/entities/palace/api'
import { getPalaceMiniPalaceApi } from '@/entities/mini-palace/api'
import { getPalaceSegmentApi } from '@/entities/palace-segment/api'
import {
  getMiniReviewSessionApi,
  getMiniReviewSessionProgressApi,
  getReviewSessionApi,
  getReviewSessionProgressApi,
  getSegmentReviewSessionApi,
  getSegmentReviewSessionProgressApi,
} from '@/features/review/api'
import {
  consumePrefetchedPromise,
  prefetchPromise,
} from '@/shared/api/promiseWarmupCache'

export type StudyWarmupKind =
  | 'review-session'
  | 'segment-review-session'
  | 'mini-review-session'
  | 'palace-practice'
  | 'focus-practice'
  | 'segment-practice'
  | 'mini-practice'

function studyWarmupKey(kind: StudyWarmupKind, id: number) {
  return `study:${kind}:${id}`
}

function loadStudySession(kind: StudyWarmupKind, id: number): Promise<unknown> {
  if (kind === 'review-session') {
    return Promise.all([getReviewSessionApi(id), getReviewSessionProgressApi(id)]).then(
      ([session, progress]) => ({ session, progress }),
    )
  }
  if (kind === 'segment-review-session') {
    return Promise.all([
      getSegmentReviewSessionApi(id),
      getSegmentReviewSessionProgressApi(id),
    ]).then(([session, progress]) => ({ session, progress }))
  }
  if (kind === 'mini-review-session') {
    return Promise.all([getMiniReviewSessionApi(id), getMiniReviewSessionProgressApi(id)]).then(
      ([session, progress]) => ({ session, progress }),
    )
  }
  if (kind === 'palace-practice') {
    return Promise.all([getPalaceEditorApi(id), getPracticeSessionProgressApi(id)]).then(
      ([session, progress]) => ({ session, progress }),
    )
  }
  if (kind === 'focus-practice') {
    return Promise.all([getPalaceFocusSessionApi(id), getFocusPracticeSessionProgressApi(id)]).then(
      ([session, progress]) => ({ session, progress }),
    )
  }
  if (kind === 'segment-practice') {
    return Promise.all([
      getPalaceSegmentApi(id),
      getSegmentPracticeSessionProgressApi(id),
    ]).then(([session, progress]) => ({ session, progress }))
  }
  return Promise.all([getPalaceMiniPalaceApi(id), getMiniPracticeSessionProgressApi(id)]).then(
    ([session, progress]) => ({ session, progress }),
  )
}

export function prefetchStudySession(kind: StudyWarmupKind, id: number) {
  if (!Number.isFinite(id) || id <= 0) return
  prefetchPromise(studyWarmupKey(kind, id), () => loadStudySession(kind, id))
}

export function consumePrefetchedStudySession<T>(
  kind: StudyWarmupKind,
  id: number,
  loader: () => Promise<T>,
) {
  return consumePrefetchedPromise(studyWarmupKey(kind, id), loader)
}
