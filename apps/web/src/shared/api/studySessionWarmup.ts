import { consumePrefetchedPromise, prefetchPromise } from './promiseWarmupCache'

export type StudyWarmupKind =
  | 'review-session'
  | 'palace-practice'
  | 'segment-practice'
  | 'mini-practice'

function studyWarmupKey(kind: StudyWarmupKind, id: number) {
  return `study:${kind}:${id}`
}

export function prefetchStudySession(
  kind: StudyWarmupKind,
  id: number,
  loader: () => Promise<unknown>,
) {
  if (!Number.isFinite(id) || id <= 0) return
  prefetchPromise(studyWarmupKey(kind, id), loader)
}

export function consumePrefetchedStudySession<T>(
  kind: StudyWarmupKind,
  id: number,
  loader: () => Promise<T>,
) {
  return consumePrefetchedPromise(studyWarmupKey(kind, id), loader)
}
