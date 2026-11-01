import { getActiveFreestyleOverlayWrongQuestionsApi } from '@/modules/practice/ui/freestyle/api/freestyleApi'
import { palaceReviewWorkspaceId } from '@/modules/practice/domain/freestyleWorkspace'
import {
  clearFreestyleOverlayWrongState,
  replaceFreestyleOverlayWrongState,
} from '@/shared/freestyle-round/freestyleOverlayWrongState'
import { FREESTYLE_PEER_ROUND_EVENT } from './feedPersistence'
import { onAppEvent } from '@/shared/events/appEvents'

const WORKSPACE_POLL_MS = 20_000
const PALACE_REVIEW_PATH_RE = /^\/palaces\/(\d+)\/review(?:\/|$)/

function isNotFound(error: unknown) {
  return typeof error === 'object' && error !== null && Number((error as { status?: unknown }).status) === 404
}

/**
 * The badge follows whichever round this page is studying: `/freestyle` reads
 * the primary slot, `/palaces/<id>/review` reads that palace's own slot. Both
 * can be active at once, and the wrong markers live on the round, not globally.
 */
function currentWorkspace(): string {
  const match = PALACE_REVIEW_PATH_RE.exec(window.location.pathname)
  const palaceId = match ? Number(match[1]) : 0
  return Number.isSafeInteger(palaceId) && palaceId > 0
    ? palaceReviewWorkspaceId(palaceId)
    : 'primary'
}

export function startFreestyleOverlayWrongStateSync(): () => void {
  let generation = 0
  let controller: AbortController | null = null
  let workspace = currentWorkspace()

  const refresh = () => {
    const requestGeneration = ++generation
    const nextWorkspace = currentWorkspace()
    if (nextWorkspace !== workspace) {
      workspace = nextWorkspace
      // The previous slot's answers do not describe this round.
      clearFreestyleOverlayWrongState()
    }
    controller?.abort()
    controller = new AbortController()
    void getActiveFreestyleOverlayWrongQuestionsApi(workspace, { signal: controller.signal })
      .then((response) => {
        if (requestGeneration !== generation) return
        replaceFreestyleOverlayWrongState({
          workspace: response.workspace,
          roundId: response.round_id,
          planVersion: response.plan_version,
          wrongQuestionIds: response.wrong_question_ids,
        })
      })
      .catch((error: unknown) => {
        if (requestGeneration !== generation || controller?.signal.aborted) return
        if (isNotFound(error)) clearFreestyleOverlayWrongState()
      })
  }

  const stopPeer = onAppEvent(FREESTYLE_PEER_ROUND_EVENT, refresh)
  const onFocus = () => refresh()
  const onVisible = () => {
    if (document.visibilityState === 'visible') refresh()
  }
  const onPageShow = () => refresh()
  const onPopState = () => refresh()
  window.addEventListener('focus', onFocus)
  window.addEventListener('popstate', onPopState)
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('pageshow', onPageShow)
  const poll = window.setInterval(() => {
    if (document.visibilityState === 'visible') refresh()
  }, WORKSPACE_POLL_MS)
  refresh()

  return () => {
    generation += 1
    controller?.abort()
    controller = null
    window.clearInterval(poll)
    stopPeer()
    window.removeEventListener('focus', onFocus)
    window.removeEventListener('popstate', onPopState)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('pageshow', onPageShow)
  }
}
