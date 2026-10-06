import type { DocumentView } from './ArticleViewSwitch'
import type { ArticleReadingOwnerId } from '@/shared/api/contracts/articleReading'
const PREFIX = 'memory-anki.document-view.'
/** Browser-local only; never stored in synced editor_local_config. */
export function readArticleViewPreference(ownerId: string | null): DocumentView {
  try {
    const value = ownerId ? localStorage.getItem(`${PREFIX}${ownerId}`) : null
    if (value === 'mindmap' || value === 'article') return value
  } catch { /* Private browsing may deny local storage. */ }
  return typeof window !== 'undefined' && window.matchMedia?.('(max-width: 640px)').matches ? 'article' : 'mindmap'
}
export function writeArticleViewPreference(ownerId: string | null, view: DocumentView) {
  if (!ownerId) return
  try { localStorage.setItem(`${PREFIX}${ownerId}`, view) } catch { /* View remains usable for this session. */ }
}
export function resolveArticleOwner(scope: string | null | undefined): ArticleReadingOwnerId | null {
  if (!scope) return null
  const subject = /^(?:knowledge-subject:|palace:\d+:subject:)(\d+)$/.exec(scope)
  if (subject) return `knowledge-subject:${Number(subject[1])}`
  const palace = /^(?:palace:|palace-edit:)(\d+)$/.exec(scope)
  return palace ? `palace:${Number(palace[1])}` : null
}
