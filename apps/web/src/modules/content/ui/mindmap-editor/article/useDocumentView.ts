import { useState } from 'react'
import type { DocumentView } from './ArticleViewSwitch'
import type { ArticleReadingOwnerId } from '@/shared/api/contracts/articleReading'
import { readArticleViewPreference, resolveArticleOwner, writeArticleViewPreference } from './articleViewPreference'

export interface DocumentViewController {
  /** Resolved reading owner, also used to key the article surface. */
  articleOwnerId: ArticleReadingOwnerId | null
  /** Effective view actually rendered. */
  documentView: DocumentView
  /** Switch to another view and remember it for this owner. */
  switchDocumentView: (view: DocumentView) => void
  /** Whether the 思维导图/文章 switch should be rendered at all. */
  canSwitchDocumentView: boolean
}

/**
 * Owns the mindmap/article view choice for one reading owner.
 *
 * `hideSwitch` hosts (freestyle on PWA) keep the map view unconditionally: with
 * no switch on screen a persisted `article` preference — which is also the
 * default under 640px — would strand the user in a view they cannot leave.
 */
export function useDocumentView(
  viewMemoryScope: string | null,
  hideSwitch: boolean,
): DocumentViewController {
  const articleOwnerId = resolveArticleOwner(viewMemoryScope)
  const [viewState, setViewState] = useState(() => ({
    owner: articleOwnerId,
    view: readArticleViewPreference(articleOwnerId),
  }))
  const preferredView =
    viewState.owner === articleOwnerId ? viewState.view : readArticleViewPreference(articleOwnerId)
  const switchDocumentView = (view: DocumentView) => {
    setViewState({ owner: articleOwnerId, view })
    writeArticleViewPreference(articleOwnerId, view)
  }
  return {
    articleOwnerId,
    documentView: hideSwitch ? 'mindmap' : preferredView,
    switchDocumentView,
    canSwitchDocumentView: !hideSwitch,
  }
}
