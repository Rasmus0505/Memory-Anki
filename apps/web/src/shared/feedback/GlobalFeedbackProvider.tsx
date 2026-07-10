import * as React from 'react'
import {
  useMindMapFeedbackAudio,
  useMindMapFeedbackSettings,
} from '@/shared/components/mindmap-host/useMindMapFeedback'
import { getReviewFeedbackEffectiveVolume } from '@/shared/feedback/reviewFeedbackSettings'
import {
  buildFeedbackStyle,
  createMindMapFeedbackDescriptor,
  GLOBAL_FEEDBACK_REQUEST_EVENT,
  type FeedbackBurst,
  type FeedbackDescriptor,
  type GlobalFeedbackRequestDetail,
} from '@/shared/feedback/globalFeedbackModel'

const PULSE_TTL_MS = 420

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
    mediaQuery.addEventListener?.('change', sync)
    return () => mediaQuery.removeEventListener?.('change', sync)
  }, [])

  return reducedMotion
}

/**
 * Renders feedback only for explicit semantic requests.
 *
 * Ordinary pointer, keyboard, focus and route interactions deliberately stay
 * inside their owning controls. This keeps global effects meaningful and
 * prevents duplicate feedback from bubbling DOM events.
 */
export function GlobalFeedbackProvider({ children }: React.PropsWithChildren) {
  const [bursts, setBursts] = React.useState<FeedbackBurst[]>([])
  const [screenPulse, setScreenPulse] = React.useState<{
    id: number
    kind: 'soft' | 'navigation' | 'celebration'
  } | null>(null)
  const burstIdRef = React.useRef(0)
  const pulseIdRef = React.useRef(0)
  const settings = useMindMapFeedbackSettings()
  const reducedMotion = usePrefersReducedMotion()
  const { playEvent } = useMindMapFeedbackAudio(
    settings.soundEnabled && settings.mode === 'immersive',
    getReviewFeedbackEffectiveVolume(settings),
  )

  const emitDescriptor = React.useCallback(
    (descriptor: FeedbackDescriptor, point: { x: number; y: number }) => {
      if (settings.soundEnabled && settings.mode === 'immersive') {
        playEvent(descriptor.audioEvent, {
          origin: descriptor.origin,
          audioScope: descriptor.audioScope,
        })
      }

      const showVisual = settings.animationEnabled && !reducedMotion
      if (!showVisual) return

      burstIdRef.current += 1
      const burstId = burstIdRef.current
      setBursts((current) => [...current, { id: burstId, x: point.x, y: point.y, descriptor }])
      window.setTimeout(() => {
        setBursts((current) => current.filter((item) => item.id !== burstId))
      }, getBurstTtlMs(descriptor))

      if (!descriptor.screenPulse) return
      pulseIdRef.current += 1
      const pulseId = pulseIdRef.current
      setScreenPulse({ id: pulseId, kind: descriptor.screenPulse })
      window.setTimeout(() => {
        setScreenPulse((current) => (current?.id === pulseId ? null : current))
      }, PULSE_TTL_MS)
    },
    [playEvent, reducedMotion, settings.animationEnabled, settings.mode, settings.soundEnabled],
  )

  const handleGlobalFeedbackRequest = React.useEffectEvent((event: Event) => {
    if (!(event instanceof CustomEvent)) return
    const detail = event.detail as GlobalFeedbackRequestDetail | undefined
    if (!detail?.event) return
    const descriptor = createMindMapFeedbackDescriptor(detail.event, detail)
    emitDescriptor(
      descriptor,
      detail.point ?? {
        x: window.innerWidth / 2,
        y: Math.max(86, Math.round(window.innerHeight * 0.2)),
      },
    )
  })

  React.useEffect(() => {
    window.addEventListener(GLOBAL_FEEDBACK_REQUEST_EVENT, handleGlobalFeedbackRequest)
    return () => window.removeEventListener(GLOBAL_FEEDBACK_REQUEST_EVENT, handleGlobalFeedbackRequest)
  }, [])

  return (
    <>
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
          </div>
        ))}
      </div>
    </>
  )
}
