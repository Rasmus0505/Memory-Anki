import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { APP_EVENT_NAMES, onAppEvent } from '@/shared/events/appEvents'
import {
  GLOBAL_FEEDBACK_REQUEST_EVENT,
  type GlobalFeedbackRequestDetail,
} from '@/shared/feedback/globalFeedbackModel'
import {
  MINDMAP_CARD_FOLDED_EVENT,
  MINDMAP_CARD_LANDED_EVENT,
} from '@/shared/ui/mindmap-canvas/useMindMapRevealMotion'
import {
  CITY_EDIT_COMMANDS,
  cityCommandForFeedback,
  type CityCommand,
} from '../model/cityEvents'

export interface CityStats {
  flips: number
  units: number
  highlights: number
  prosperity: number
  combo: number
  correct: number
  buildings: number
  balloons: number
  cars: number
}

export interface CityAudioState {
  state: string
  muted: boolean
}

interface CityBridgeCallbacks {
  onStats: (stats: CityStats) => void
  onNotice: (text: string, tone: string) => void
  onAudio: (state: CityAudioState) => void
  onReady: () => void
}

interface HostMessage {
  type: string
  payload?: unknown
}

type CityOutgoingMessage =
  | { type: Exclude<CityCommand['type'], 'rating' | 'quiz'>; payload?: undefined }
  | { type: 'rating'; payload: { level: number } }
  | { type: 'quiz'; payload: { correct: boolean } }
  | { type: 'celebrate'; payload?: undefined }
  | { type: 'mute'; payload: { muted: boolean } }
  | { type: 'orbit'; payload: { on: boolean } }
  | { type: 'reset'; payload?: undefined }
  | { type: 'demo'; payload?: undefined }
  | { type: 'retract'; payload: { count: number } }
  | { type: 'active'; payload: { on: boolean } }
  | { type: 'reset-city'; payload?: undefined }

const CITY_SOURCE = 'memory-anki-city'
const HOST_SOURCE = 'memory-anki-host'
const MAX_QUEUE = 30
const EDIT_THROTTLE_MS = 700
const HIGHLIGHT_THROTTLE_MS = 500

export function useCityBridge(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  callbacks: CityBridgeCallbacks,
) {
  const readyRef = useRef(false)
  const queueRef = useRef<CityOutgoingMessage[]>([])
  const queueTimersRef = useRef<number[]>([])
  const callbacksRef = useRef(callbacks)
  callbacksRef.current = callbacks

  const post = useCallback(
    (message: CityOutgoingMessage) => {
      const target = iframeRef.current?.contentWindow
      if (!target || !readyRef.current) {
        if (queueRef.current.length < MAX_QUEUE) queueRef.current.push(message)
        return
      }
      target.postMessage({ source: HOST_SOURCE, ...message }, '*')
    },
    [iframeRef],
  )

  const flush = useCallback(() => {
    const pending = queueRef.current
    queueRef.current = []
    pending.forEach((message, index) => {
      const timer = window.setTimeout(() => {
        iframeRef.current?.contentWindow?.postMessage({ source: HOST_SOURCE, ...message }, '*')
      }, index * 90)
      queueTimersRef.current.push(timer)
    })
  }, [iframeRef])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as (HostMessage & { source?: string }) | null
      if (!data || data.source !== CITY_SOURCE) return
      if (event.source !== iframeRef.current?.contentWindow) return
      if (data.type === 'ready') {
        readyRef.current = true
        callbacksRef.current.onReady()
        flush()
        return
      }
      if (data.type === 'stats') {
        callbacksRef.current.onStats(data.payload as CityStats)
        return
      }
      if (data.type === 'notice') {
        const payload = data.payload as { text?: string; tone?: string } | undefined
        if (payload?.text) callbacksRef.current.onNotice(payload.text, payload.tone || 'soft')
        return
      }
      if (data.type === 'audio') {
        callbacksRef.current.onAudio(data.payload as CityAudioState)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [flush, iframeRef])

  useEffect(() => {
    let lastEditAt = 0
    let lastHighlightAt = 0

    const sendCommand = (command: CityCommand) => {
      if (CITY_EDIT_COMMANDS.has(command.type)) {
        const now = performance.now()
        if (now - lastEditAt < EDIT_THROTTLE_MS) return
        lastEditAt = now
      }
      if (command.type === 'rating') post({ type: 'rating', payload: { level: command.level } })
      else if (command.type === 'quiz') post({ type: 'quiz', payload: { correct: command.correct } })
      else post({ type: command.type })
    }

    const onFlip = () => post({ type: 'flip' })
    const onFold = (event: Event) => {
      const detail = (event as CustomEvent<{ count?: number }>).detail
      const count = Math.max(1, Math.min(24, Math.round(Number(detail?.count) || 1)))
      post({ type: 'retract', payload: { count } })
    }
    const onFeedback = (event: Event) => {
      const detail = (event as CustomEvent<GlobalFeedbackRequestDetail>).detail
      if (!detail?.event) return
      const command = cityCommandForFeedback(detail.event)
      if (command) sendCommand(command)
    }

    document.addEventListener(MINDMAP_CARD_LANDED_EVENT, onFlip)
    document.addEventListener(MINDMAP_CARD_FOLDED_EVENT, onFold)
    window.addEventListener(GLOBAL_FEEDBACK_REQUEST_EVENT, onFeedback)

    const stopFavorite = onAppEvent(APP_EVENT_NAMES.reviewUnitFavoriteChanged, (detail) => {
      if (!detail.isFavorite) return
      const now = performance.now()
      if (now - lastHighlightAt < HIGHLIGHT_THROTTLE_MS) return
      lastHighlightAt = now
      post({ type: 'highlight' })
    })
    const stopRound = onAppEvent(APP_EVENT_NAMES.roundCompleted, () => {
      post({ type: 'celebrate' })
    })

    return () => {
      document.removeEventListener(MINDMAP_CARD_LANDED_EVENT, onFlip)
      document.removeEventListener(MINDMAP_CARD_FOLDED_EVENT, onFold)
      window.removeEventListener(GLOBAL_FEEDBACK_REQUEST_EVENT, onFeedback)
      stopFavorite()
      stopRound()
    }
  }, [post])

  useEffect(() => {
    return () => {
      queueTimersRef.current.forEach((timer) => window.clearTimeout(timer))
      queueTimersRef.current = []
    }
  }, [])

  return { send: post }
}
