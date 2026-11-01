import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { MindMapEditorState } from '@/shared/api/contracts'
import type { MindMapSelection } from '@/modules/content/domain/mindmap-document-entity'
import type { MindMapCanvasViewCommand } from '@/shared/ui/mindmap-canvas'
import { buildSelectionFromDoc } from './documentGraphProjection'
import {
  selectedInteraction,
  type MindMapInteractionState,
} from './mindMapEditorSurfaceKeyboard'

interface UseMindMapSurfaceViewCommandsOptions {
  focusRequestNodeUid: string | null
  focusRequestNonce: number
  /** Card the mount camera already centered; the first request for it is a no-op. */
  initialFocusNodeUid?: string | null
  revealFollowNodeIds: readonly string[]
  revealFollowNonce: number
  interactionRef: MutableRefObject<MindMapInteractionState>
  onNodeActiveRef: MutableRefObject<((nodes: MindMapSelection[]) => void) | undefined>
  commitEditingDraft: () => void
  replaceInteraction: (next: MindMapInteractionState) => void
  getCurrentEditorDoc: () => MindMapEditorState['editor_doc']
}

export function useMindMapSurfaceViewCommands({
  focusRequestNodeUid,
  focusRequestNonce,
  initialFocusNodeUid = null,
  revealFollowNodeIds,
  revealFollowNonce,
  interactionRef,
  onNodeActiveRef,
  commitEditingDraft,
  replaceInteraction,
  getCurrentEditorDoc,
}: UseMindMapSurfaceViewCommandsOptions) {
  const [viewCommand, setViewCommand] = useState<MindMapCanvasViewCommand | null>(null)
  const viewCommandNonceRef = useRef(0)
  const handledFocusRequestNonceRef = useRef(0)
  const handledRevealFollowNonceRef = useRef(0)
  /** The mount camera already centered this card; do not animate to it again. */
  const initialFocusHandledRef = useRef(initialFocusNodeUid)

  const requestFocusNode = useCallback(
    (nodeUid: string | null) => {
      const current = interactionRef.current
      if (current.mode === 'editing') commitEditingDraft()
      replaceInteraction(nodeUid ? selectedInteraction(nodeUid) : { mode: 'idle' })
      onNodeActiveRef.current?.(buildSelectionFromDoc(getCurrentEditorDoc(), nodeUid))
      if (!nodeUid) return
      if (initialFocusHandledRef.current === nodeUid) {
        // The first-size camera already landed on this card; a second center
        // would animate zero distance and keep the camera locked for 220ms.
        initialFocusHandledRef.current = null
        return
      }
      viewCommandNonceRef.current += 1
      setViewCommand({
        type: 'center',
        nodeId: nodeUid,
        nonce: viewCommandNonceRef.current,
      })
    },
    [commitEditingDraft, getCurrentEditorDoc, interactionRef, onNodeActiveRef, replaceInteraction],
  )

  const requestFitView = useCallback(() => {
    viewCommandNonceRef.current += 1
    setViewCommand({
      type: 'fit',
      nonce: viewCommandNonceRef.current,
    })
  }, [])

  // Each focusRequestNonce must run at most once. Including requestFocusNode in deps is
  // unsafe: hosts pass unstable onNodeActive, which used to recreate requestFocusNode and
  // re-enter this effect, nesting setViewCommand until React #185 (max update depth).
  useEffect(() => {
    if (!focusRequestNodeUid || focusRequestNonce <= 0) return
    if (handledFocusRequestNonceRef.current === focusRequestNonce) return
    handledFocusRequestNonceRef.current = focusRequestNonce
    requestFocusNode(focusRequestNodeUid)
  }, [focusRequestNodeUid, focusRequestNonce, requestFocusNode])

  // Enter reveal follow must not select the card or recenter it. A new nonce
  // replaces the previous command so a held Enter follows the latest step.
  useEffect(() => {
    if (revealFollowNonce <= 0 || revealFollowNodeIds.length === 0) return
    if (handledRevealFollowNonceRef.current === revealFollowNonce) return
    handledRevealFollowNonceRef.current = revealFollowNonce
    viewCommandNonceRef.current += 1
    setViewCommand({
      type: 'reveal',
      nodeIds: revealFollowNodeIds,
      nonce: viewCommandNonceRef.current,
    })
  }, [revealFollowNodeIds, revealFollowNonce])

  return { viewCommand, requestFocusNode, requestFitView }
}
