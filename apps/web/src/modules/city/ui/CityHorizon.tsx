import { useCallback, useEffect, useRef, useState } from 'react'
import { request } from '@/shared/api/http'
import { APP_EVENT_NAMES, isRemoteWindowEvent, onAppEvent } from '@/shared/events/appEvents'
import {
  GLOBAL_FEEDBACK_REQUEST_EVENT,
  type GlobalFeedbackRequestDetail,
} from '@/shared/feedback/globalFeedbackModel'
import { MINDMAP_CARD_LANDED_EVENT } from '@/shared/ui/mindmap-canvas/useMindMapRevealMotion'
import { cn } from '@/shared/lib/utils'
import {
  focusPalaceIdFromPath,
  palaceOfUnit,
  planIsland,
  type CityTodayDto,
} from '../model/horizonModel'

export const CITY_DISABLED_KEY = 'memory-anki:city-disabled'
const HOST = 'memory-anki-host'
const SELF = 'memory-anki-city-horizon'
const REFRESH_DEBOUNCE_MS = 1200
const QUIET_AFTER_TYPING_MS = 1500

function cityDisabled() {
  if (import.meta.env.MODE === 'test') return true
  try {
    return window.localStorage.getItem(CITY_DISABLED_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * The learning city as a strip at the bottom of study scenes. It takes its own
 * height in the layout, so it never covers content, and it ignores pointer input.
 */
export function CityHorizon({ visible, pathname }: { visible: boolean; pathname: string }) {
  const [disabled] = useState(cityDisabled)
  const [mounted, setMounted] = useState(false)
  const [quiet, setQuiet] = useState(false)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const readyRef = useRef(false)
  const todayRef = useRef<CityTodayDto | null>(null)
  const focusId = focusPalaceIdFromPath(pathname)
  const focusRef = useRef(focusId)
  focusRef.current = focusId

  // Load three.js only once a study scene first shows the strip, then keep the scene alive.
  useEffect(() => {
    if (visible && !disabled) setMounted(true)
  }, [visible, disabled])

  const post = useCallback((type: string, payload?: unknown) => {
    if (!readyRef.current) return
    frameRef.current?.contentWindow?.postMessage({ source: HOST, type, payload }, window.location.origin)
  }, [])

  const pushSnapshot = useCallback(() => {
    post('snapshot', { houses: planIsland(todayRef.current, focusRef.current), focusId: focusRef.current })
  }, [post])

  const refresh = useCallback(() => {
    void request<CityTodayDto>('/dashboard/city-today', { persistence: false })
      .then((today) => {
        if (!Array.isArray(today?.palaces)) return
        todayRef.current = today
        pushSnapshot()
      })
      .catch(() => undefined)
  }, [pushSnapshot])

  useEffect(() => {
    if (!mounted) return
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return
      const data = event.data as { source?: string; type?: string } | null
      if (data?.source !== SELF || data.type !== 'ready') return
      readyRef.current = true
      pushSnapshot()
      refresh()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [mounted, pushSnapshot, refresh])

  useEffect(() => {
    if (!mounted) return
    post('active', { on: visible })
    if (visible) refresh()
  }, [mounted, visible, post, refresh])

  useEffect(() => {
    if (mounted) pushSnapshot()
  }, [mounted, focusId, pushSnapshot])

  useEffect(() => {
    if (!mounted) return
    let timer = 0
    const later = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(refresh, REFRESH_DEBOUNCE_MS)
    }
    const stopRated = onAppEvent(APP_EVENT_NAMES.unitRated, (detail, event) => {
      if (isRemoteWindowEvent(event)) return
      const palaceId = detail.palaceId ?? palaceOfUnit(todayRef.current, detail.unitId)
      post('rated', { palaceId, rating: detail.rating })
      later()
    })
    const stopReview = onAppEvent(APP_EVENT_NAMES.reviewStateChanged, later)
    const stopRound = onAppEvent(APP_EVENT_NAMES.roundCompleted, (_detail, event) => {
      if (!isRemoteWindowEvent(event)) post('celebrate')
    })
    const onFlip = () => post('flip')
    const onFeedback = (event: Event) => {
      const name = (event as CustomEvent<GlobalFeedbackRequestDetail>).detail?.event
      if (name === 'quiz_result_correct' || name === 'quiz_result_incorrect') {
        post('quiz', { correct: name === 'quiz_result_correct' })
      } else if (name === 'node_create') {
        post('node')
      }
    }
    document.addEventListener(MINDMAP_CARD_LANDED_EVENT, onFlip)
    window.addEventListener(GLOBAL_FEEDBACK_REQUEST_EVENT, onFeedback)
    return () => {
      window.clearTimeout(timer)
      stopRated()
      stopReview()
      stopRound()
      document.removeEventListener(MINDMAP_CARD_LANDED_EVENT, onFlip)
      window.removeEventListener(GLOBAL_FEEDBACK_REQUEST_EVENT, onFeedback)
    }
  }, [mounted, post, refresh])

  // Typing fades the strip so it does not pull the eye while the learner writes.
  useEffect(() => {
    if (!mounted) return
    let timer = 0
    const onInput = () => {
      setQuiet(true)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setQuiet(false), QUIET_AFTER_TYPING_MS)
    }
    document.addEventListener('input', onInput, true)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('input', onInput, true)
    }
  }, [mounted])

  if (!mounted) return null
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none relative h-14 shrink-0 select-none transition-opacity duration-500 md:h-20',
        !visible && 'hidden',
        quiet && 'opacity-15',
      )}
    >
      <iframe
        ref={frameRef}
        title="学习城市"
        src={`${import.meta.env.BASE_URL}city/horizon.html`}
        tabIndex={-1}
        className="absolute inset-0 size-full border-0"
      />
    </div>
  )
}
