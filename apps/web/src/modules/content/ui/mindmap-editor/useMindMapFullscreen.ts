import { useCallback, useEffect, useRef, useState } from 'react'
import { createActor } from 'xstate'
import {
  getMindMapPresentationMode,
  isMindMapFullscreenState,
  mindMapPresentationMachine,
  type MindMapPresentationMode,
  type PresentationPort,
} from '@/modules/mindmap/public'
import { browserPresentationPort } from '@/platform/browser/browserPresentationPort'

export type MindMapPresentationStrategy = 'native-preferred' | 'viewport-only'

interface MindMapFullscreenOptions {
  getFullscreenTarget: () => HTMLElement | null
  presentationStrategy: MindMapPresentationStrategy
  onFullscreenChange?: (active: boolean) => void
  presentationPort?: PresentationPort
}

export function useMindMapFullscreen({
  getFullscreenTarget,
  presentationStrategy,
  onFullscreenChange,
  presentationPort = browserPresentationPort,
}: MindMapFullscreenOptions) {
  const actorRef = useRef(createActor(mindMapPresentationMachine))
  const [active, setActive] = useState(false)
  const [mode, setMode] = useState<MindMapPresentationMode>('embedded')
  const activeRef = useRef(false)
  const modeRef = useRef<MindMapPresentationMode>('embedded')
  const onFullscreenChangeRef = useRef(onFullscreenChange)

  useEffect(() => {
    onFullscreenChangeRef.current = onFullscreenChange
  }, [onFullscreenChange])

  const exit = useCallback(async () => {
    const actor = actorRef.current
    actor.send({ type: 'EXIT_REQUESTED' })
    await presentationPort.exitFullscreen()
    actor.send({ type: 'PRESENTATION_EXITED' })
  }, [presentationPort])

  const enterNative = useCallback(async () => {
    if (activeRef.current && modeRef.current === 'native') return
    if (activeRef.current) await exit()
    const actor = actorRef.current
    actor.send({ type: 'ENTER_NATIVE_REQUESTED' })
    const nativeEntered = await presentationPort.enterFullscreen(getFullscreenTarget())
    actor.send({ type: nativeEntered ? 'NATIVE_PRESENTATION_ENTERED' : 'NATIVE_PRESENTATION_FAILED' })
  }, [exit, getFullscreenTarget, presentationPort])

  const enterViewport = useCallback(async () => {
    if (activeRef.current && modeRef.current === 'viewport') return
    if (activeRef.current) await exit()
    actorRef.current.send({ type: 'ENTER_VIEWPORT_REQUESTED' })
  }, [exit])

  const enter = useCallback(async () => {
    if (presentationStrategy === 'viewport-only') {
      await enterViewport()
      return
    }
    await enterNative()
  }, [enterNative, enterViewport, presentationStrategy])

  const toggle = useCallback(() => {
    if (activeRef.current) void exit()
    else void enter()
  }, [enter, exit])

  const toggleNative = useCallback(() => {
    if (activeRef.current && modeRef.current === 'native') void exit()
    else void enterNative()
  }, [enterNative, exit])

  const toggleViewport = useCallback(() => {
    if (activeRef.current && modeRef.current === 'viewport') void exit()
    else void enterViewport()
  }, [enterViewport, exit])

  useEffect(() => {
    const actor = actorRef.current
    actor.start()
    const subscription = actor.subscribe((snapshot) => {
      const nextActive = isMindMapFullscreenState(snapshot.value)
      const nextMode = getMindMapPresentationMode(snapshot.value)
      const previousActive = activeRef.current
      activeRef.current = nextActive
      modeRef.current = nextMode
      setActive(nextActive)
      setMode(nextMode)
      if (previousActive !== nextActive) onFullscreenChangeRef.current?.(nextActive)
    })
    return () => {
      subscription.unsubscribe()
      actor.stop()
    }
  }, [])

  useEffect(() => {
    if (!active) return
    const viewportSession = presentationPort.lockViewport(() => {})
    const escapeSession = presentationPort.onEscape(() => void exit())
    const fullscreenSession = mode === 'native'
      ? presentationPort.onFullscreenExit(() => {
        if (!activeRef.current) return
        actorRef.current.send({ type: 'HOST_FULLSCREEN_EXITED' })
        void exit()
      })
      : null
    return () => {
      fullscreenSession?.release()
      escapeSession.release()
      viewportSession.release()
    }
  }, [active, exit, mode, presentationPort])

  return {
    active,
    mode,
    enter,
    enterNative,
    enterViewport,
    exit,
    toggle,
    toggleNative,
    toggleViewport,
  }
}
