import * as React from 'react'
import { useLocation } from 'react-router-dom'
import {
  useMindMapFeedbackAudio,
  useMindMapFeedbackSettings,
} from '@/shared/components/mindmap-host/useMindMapFeedback'
import {
  buildFeedbackStyle,
  createCommitDescriptor,
  createFocusDescriptor,
  createHoverDescriptor,
  createKeyboardDescriptor,
  createMindMapFeedbackDescriptor,
  createPointerDescriptor,
  createRouteDescriptor,
  GLOBAL_FEEDBACK_REQUEST_EVENT,
  resolveFeedbackPoint,
  type FeedbackBurst,
  type FeedbackDescriptor,
  type GlobalFeedbackRequestDetail,
} from '@/shared/feedback/globalFeedbackModel'

const PULSE_TTL_MS = 420
const HOVER_INTERVAL_MS = 220

function getBurstTtlMs(descriptor: FeedbackDescriptor) {
  if (descriptor.level === 'micro') return 420
  if (descriptor.level === 'milestone') return 780
  return 620
}

function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = React.useState(false)

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReducedMotion(mediaQuery.matches)
    sync()
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', sync)
      return () => mediaQuery.removeEventListener('change', sync)
    }
    mediaQuery.addListener(sync)
    return () => mediaQuery.removeListener(sync)
  }, [])

  return reducedMotion
}

function FeedbackRouteWatcher({
  onRouteFeedback,
}: {
  onRouteFeedback: (descriptor: FeedbackDescriptor) => void
}) {
  const location = useLocation()
  const isFirstRenderRef = React.useRef(true)
  const emitRouteFeedback = React.useEffectEvent(onRouteFeedback)

  React.useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false
      return
    }
    emitRouteFeedback(createRouteDescriptor())
  }, [location.pathname])

  return null
}

export function GlobalFeedbackProvider({
  children,
}: React.PropsWithChildren) {
  const [bursts, setBursts] = React.useState<FeedbackBurst[]>([])
  const [screenPulse, setScreenPulse] = React.useState<{
    id: number
    kind: 'soft' | 'navigation' | 'celebration'
  } | null>(null)
  const burstIdRef = React.useRef(0)
  const pulseIdRef = React.useRef(0)
  const hoverSignatureRef = React.useRef('')
  const hoverAtRef = React.useRef(0)
  const settings = useMindMapFeedbackSettings()
  const reducedMotion = usePrefersReducedMotion()
  const { playEvent } = useMindMapFeedbackAudio(
    settings.soundEnabled && settings.mode === 'immersive',
    settings.volume,
  )

  const emitDescriptor = React.useCallback(
    (
      descriptor: FeedbackDescriptor,
      point: { x: number; y: number } | null,
    ) => {
      if (!point) return

      if (settings.soundEnabled && settings.mode === 'immersive') {
        playEvent(descriptor.audioEvent)
      }

      if (settings.animationEnabled && !reducedMotion) {
        burstIdRef.current += 1
        const burstId = burstIdRef.current
        setBursts((current) => [
          ...current,
          {
            id: burstId,
            x: point.x,
            y: point.y,
            descriptor,
          },
        ])
        window.setTimeout(() => {
          setBursts((current) => current.filter((item) => item.id !== burstId))
        }, getBurstTtlMs(descriptor))
      }

      if (descriptor.screenPulse && settings.animationEnabled && !reducedMotion) {
        pulseIdRef.current += 1
        const pulseId = pulseIdRef.current
        setScreenPulse({
          id: pulseId,
          kind: descriptor.screenPulse,
        })
        window.setTimeout(() => {
          setScreenPulse((current) => (current?.id === pulseId ? null : current))
        }, PULSE_TTL_MS)
      }
    },
    [playEvent, reducedMotion, settings.animationEnabled, settings.mode, settings.soundEnabled],
  )

  const emitFromEvent = React.useCallback(
    (
      descriptor: FeedbackDescriptor | null,
      target: EventTarget | null,
      fallback?: { x: number; y: number },
    ) => {
      if (!descriptor) return
      emitDescriptor(descriptor, resolveFeedbackPoint(target, fallback))
    },
    [emitDescriptor],
  )

  const handlePointerDown = React.useEffectEvent((event: PointerEvent) => {
    emitFromEvent(
      createPointerDescriptor(event.target, 'down'),
      event.target,
      { x: event.clientX, y: event.clientY },
    )
  })

  const handleClick = React.useEffectEvent((event: MouseEvent) => {
    emitFromEvent(
      createPointerDescriptor(event.target, 'click'),
      event.target,
      { x: event.clientX, y: event.clientY },
    )
  })

  const handleFocus = React.useEffectEvent((event: FocusEvent) => {
    emitFromEvent(createFocusDescriptor(event.target), event.target)
  })

  const handleChange = React.useEffectEvent((event: Event) => {
    emitFromEvent(createCommitDescriptor(event.target), event.target)
  })

  const handleHover = React.useEffectEvent((event: PointerEvent) => {
    const descriptor = createHoverDescriptor(event.target)
    if (!descriptor) return
    const signature = `${descriptor.audioEvent}:${descriptor.visualKind}:${descriptor.hue}:${descriptor.size}`
    const now = Date.now()
    if (signature === hoverSignatureRef.current && now - hoverAtRef.current < HOVER_INTERVAL_MS) {
      return
    }
    hoverSignatureRef.current = signature
    hoverAtRef.current = now
    emitFromEvent(
      descriptor,
      event.target,
      { x: event.clientX, y: event.clientY },
    )
  })

  const handleKeyDown = React.useEffectEvent((event: KeyboardEvent) => {
    const descriptor = createKeyboardDescriptor(event)
    if (!descriptor) return
    const activeElement = document.activeElement
    const point = resolveFeedbackPoint(activeElement) ?? {
      x: window.innerWidth / 2,
      y: Math.max(86, Math.round(window.innerHeight * 0.2)),
    }
    emitDescriptor(descriptor, point)
  })

  const handleGlobalFeedbackRequest = React.useEffectEvent((event: Event) => {
    if (!(event instanceof CustomEvent)) return
    const detail = event.detail as GlobalFeedbackRequestDetail | undefined
    if (!detail?.event) return
    const descriptor = createMindMapFeedbackDescriptor(detail.event, detail)
    emitDescriptor(descriptor, detail.point ?? {
      x: window.innerWidth / 2,
      y: Math.max(86, Math.round(window.innerHeight * 0.2)),
    })
  })

  React.useEffect(() => {
    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('click', handleClick, true)
    document.addEventListener('focusin', handleFocus, true)
    document.addEventListener('change', handleChange, true)
    document.addEventListener('pointerover', handleHover, true)
    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener(GLOBAL_FEEDBACK_REQUEST_EVENT, handleGlobalFeedbackRequest)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('click', handleClick, true)
      document.removeEventListener('focusin', handleFocus, true)
      document.removeEventListener('change', handleChange, true)
      document.removeEventListener('pointerover', handleHover, true)
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener(GLOBAL_FEEDBACK_REQUEST_EVENT, handleGlobalFeedbackRequest)
    }
  }, [
    handleChange,
    handleClick,
    handleFocus,
    handleGlobalFeedbackRequest,
    handleHover,
    handleKeyDown,
    handlePointerDown,
  ])

  const handleRouteFeedback = React.useCallback((descriptor: FeedbackDescriptor) => {
    emitDescriptor(descriptor, {
      x: window.innerWidth / 2,
      y: Math.max(112, Math.round(window.innerHeight * 0.16)),
    })
  }, [emitDescriptor])

  return (
    <>
      <FeedbackRouteWatcher onRouteFeedback={handleRouteFeedback} />
      {children}
      <div className="memory-anki-feedback-layer" aria-hidden="true">
        {screenPulse ? (
          <div
            key={screenPulse.id}
            className={`memory-anki-feedback-screen memory-anki-feedback-screen-${screenPulse.kind}`}
          />
        ) : null}
        {bursts.map((burst) => (
          <div
            key={burst.id}
            className={`memory-anki-feedback-burst memory-anki-feedback-burst-${burst.descriptor.visualKind} memory-anki-feedback-level-${burst.descriptor.level}`}
            style={buildFeedbackStyle(burst)}
          >
            <span className="memory-anki-feedback-ring" />
            <span className="memory-anki-feedback-core" />
            <span className="memory-anki-feedback-sparks" />
            {burst.descriptor.label ? (
              <span className="memory-anki-feedback-label">{burst.descriptor.label}</span>
            ) : null}
          </div>
        ))}
      </div>
    </>
  )
}
