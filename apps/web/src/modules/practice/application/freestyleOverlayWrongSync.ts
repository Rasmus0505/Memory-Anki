import { getActiveFreestyleOverlayWrongQuestionsApi } from '@/modules/practice/ui/freestyle/api/freestyleApi'
import {
  clearFreestyleOverlayWrongState,
  replaceFreestyleOverlayWrongState,
} from '@/shared/freestyle-round/freestyleOverlayWrongState'
import { FREESTYLE_PEER_ROUND_EVENT } from './feedPersistence'
import { onAppEvent } from '@/shared/events/appEvents'

function isNotFound(error: unknown) {
  return typeof error === 'object' && error !== null && Number((error as { status?: unknown }).status) === 404
}

export function startFreestyleOverlayWrongStateSync(): () => void {
  let generation = 0
  let controller: AbortController | null = null

  const refresh = () => {
    const requestGeneration = ++generation
    controller?.abort()
    controller = new AbortController()
    void getActiveFreestyleOverlayWrongQuestionsApi('primary', { signal: controller.signal })
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
  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('pageshow', onPageShow)
  refresh()

  return () => {
    generation += 1
    controller?.abort()
    controller = null
    stopPeer()
    window.removeEventListener('focus', onFocus)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('pageshow', onPageShow)
  }
}
