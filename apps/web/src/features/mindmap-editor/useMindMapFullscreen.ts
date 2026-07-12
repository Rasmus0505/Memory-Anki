import { useCallback, useEffect, useRef, useState } from 'react'
import { createActor } from 'xstate'
import {
  isMindMapFullscreenState,
  mindMapPresentationMachine,
  type PresentationPort,
} from '@/modules/mindmap/public'
import { browserPresentationPort } from '@/platform/browser/browserPresentationPort'

interface MindMapFullscreenOptions {
  getFullscreenTarget: () => HTMLElement | null
  browserFullscreenEnabled: boolean
  onFullscreenChange?: (active: boolean) => void
  requestFitView: () => void
  presentationPort?: PresentationPort
}

export function useMindMapFullscreen({
  getFullscreenTarget,
  browserFullscreenEnabled,
  onFullscreenChange,
  requestFitView,
  presentationPort = browserPresentationPort,
}: MindMapFullscreenOptions) {
  const actorRef = useRef(createActor(mindMapPresentationMachine))
  const [active, setActive] = useState(false)
  const activeRef = useRef(false)

  const requestFitViewOnNextFrame = useCallback(() => {
    presentationPort.scheduleLayout(requestFitView)
  }, [presentationPort, requestFitView])

  const publishActive = useCallback((nextActive: boolean) => {
    if (activeRef.current === nextActive) return
    activeRef.current = nextActive
    setActive(nextActive)
    onFullscreenChange?.(nextActive)
    requestFitViewOnNextFrame()
  }, [onFullscreenChange, requestFitViewOnNextFrame])

  const exit = useCallback(async () => {
    const actor = actorRef.current
    actor.send({ type: 'EXIT_REQUESTED' })
    publishActive(false)
    await presentationPort.exitFullscreen()
    actor.send({ type: 'PRESENTATION_EXITED' })
  }, [presentationPort, publishActive])

  const enter = useCallback(async () => {
    const actor = actorRef.current
    actor.send({ type: 'ENTER_REQUESTED' })
    publishActive(true)
    const nativeEntered = browserFullscreenEnabled
      ? await presentationPort.enterFullscreen(getFullscreenTarget())
      : false
    actor.send({ type: nativeEntered ? 'PRESENTATION_ENTERED' : 'PRESENTATION_FAILED' })
  }, [browserFullscreenEnabled, getFullscreenTarget, presentationPort, publishActive])

  const toggle = useCallback(() => {
    if (activeRef.current) void exit()
    else void enter()
  }, [enter, exit])

  useEffect(() => {
    const actor = actorRef.current
    actor.start()
    const subscription = actor.subscribe((snapshot) => {
      publishActive(isMindMapFullscreenState(snapshot.value))
    })
    return () => {
      subscription.unsubscribe()
      actor.stop()
    }
  }, [publishActive])

  useEffect(() => {
    if (!active) return
    const viewportSession = presentationPort.lockViewport(requestFitViewOnNextFrame)
    const escapeSession = presentationPort.onEscape(() => void exit())
    const fullscreenSession = presentationPort.onFullscreenExit(() => {
      if (!activeRef.current) return
      actorRef.current.send({ type: 'HOST_FULLSCREEN_EXITED' })
      void exit()
    })
    return () => {
      fullscreenSession.release()
      escapeSession.release()
      viewportSession.release()
    }
  }, [active, exit, presentationPort, requestFitViewOnNextFrame])

  return { active, enter, exit, toggle }
}
