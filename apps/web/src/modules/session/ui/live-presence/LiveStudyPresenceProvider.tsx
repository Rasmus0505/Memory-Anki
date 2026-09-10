import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { consumeLiveStudyStream, publishLiveStudyCommand } from '@/modules/session/domain/session-entity/api/liveStudyApi'
import {
  emptyLiveStudyProjection,
  preferNewerLiveStudyProjection,
  readLiveStudyClientId,
  shouldFollowLiveRoute,
  type LiveStudyProjection,
} from '@/modules/session/domain/session-entity/model/live-study/liveStudyModel'
import { setLiveForegroundClockSuppressed } from '@/modules/session/domain/session-entity/model/timed-session/liveClockOwnership'
import {
  LiveStudyPresenceContext,
  type LiveStudyPublishPatch,
} from '@/modules/session/ui/live-presence/liveStudyPresenceContext'

const HELLO_SILENCE_MS = 2_000
const HELLO_POLL_MS = 1_000

function createOperationId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `live-op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function LiveStudyPresenceProvider({ children }: PropsWithChildren) {
  const clientId = useMemo(() => readLiveStudyClientId(), [])
  const [projection, setProjection] = useState<LiveStudyProjection>(emptyLiveStudyProjection)
  const [connected, setConnected] = useState(false)
  const applyingRemoteRef = useRef(false)
  const projectionRef = useRef(projection)
  const navigate = useNavigate()
  const location = useLocation()
  projectionRef.current = projection
  const isController = projection.controllerClientId === clientId

  const publish = useCallback((patch: LiveStudyPublishPatch) => {
    if (applyingRemoteRef.current) return
    void publishLiveStudyCommand({
      type: 'publish',
      clientId,
      operationId: createOperationId(),
      takeControl: patch.takeControl,
      route: patch.route,
      surface: patch.surface,
      view: patch.view,
      timer: patch.timer,
    }).then((response) => {
      setProjection((current) => preferNewerLiveStudyProjection(current, response.projection))
    }).catch(() => {
      // Presence is best-effort; local study UI stays usable offline.
    })
  }, [clientId])

  useEffect(() => {
    let cancelled = false
    let retry = 0
    let sseTimer: number | null = null
    let pollTimer: number | null = null
    let controller: AbortController | null = null
    let sseInFlight = false
    let receivedStreamEnvelope = false
    let lastEnvelopeAt = 0

    const mergeProjection = (incoming: LiveStudyProjection) => {
      setProjection((current) => preferNewerLiveStudyProjection(current, incoming))
    }

    const hello = async () => {
      try {
        const response = await publishLiveStudyCommand({
          type: 'hello',
          clientId,
          operationId: createOperationId(),
        })
        if (cancelled) return
        lastEnvelopeAt = Date.now()
        setConnected(true)
        mergeProjection(response.projection)
      } catch {
        // Keep current hydration; SSE or the next hello poll can recover.
      }
    }

    const connect = () => {
      controller?.abort()
      controller = new AbortController()
      const signal = controller.signal
      sseInFlight = true
      void consumeLiveStudyStream(
        clientId,
        (envelope) => {
          if (cancelled) return
          retry = 0
          receivedStreamEnvelope = true
          lastEnvelopeAt = Date.now()
          setConnected(true)
          applyingRemoteRef.current = envelope.publisherClientId !== clientId
          mergeProjection(envelope.projection)
          queueMicrotask(() => {
            applyingRemoteRef.current = false
          })
        },
        signal,
      )
        .catch(() => {
          receivedStreamEnvelope = false
        })
        .finally(() => {
          sseInFlight = false
          if (cancelled || signal.aborted) return
          const delay = Math.min(8_000, 500 * 2 ** retry)
          retry += 1
          sseTimer = window.setTimeout(connect, delay)
        })
    }

    void hello()
    connect()
    const watch = () => {
      if (cancelled) return
      const healthySse = sseInFlight && receivedStreamEnvelope
      if (!healthySse && Date.now() - lastEnvelopeAt >= HELLO_SILENCE_MS) {
        void hello()
      }
      pollTimer = window.setTimeout(watch, HELLO_POLL_MS)
    }
    pollTimer = window.setTimeout(watch, HELLO_SILENCE_MS)

    return () => {
      cancelled = true
      if (sseTimer != null) window.clearTimeout(sseTimer)
      if (pollTimer != null) window.clearTimeout(pollTimer)
      controller?.abort()
    }
  }, [clientId])

  useEffect(() => {
    setLiveForegroundClockSuppressed(Boolean(projection.controllerClientId) && projection.controllerClientId !== clientId)
  }, [clientId, projection.controllerClientId])

  useEffect(() => {
    const localPath = `${location.pathname}${location.search}`
    if (
      !shouldFollowLiveRoute({
        localPath,
        isController,
        surface: projection.surface,
        route: projection.route,
      })
    ) return
    navigate(projection.route, { replace: true })
  }, [isController, location.pathname, location.search, navigate, projection.route, projection.surface])

  const value = useMemo(
    () => ({
      clientId,
      projection,
      isController,
      connected,
      publish,
    }),
    [clientId, connected, isController, projection, publish],
  )

  return (
    <LiveStudyPresenceContext.Provider value={value}>
      {children}
    </LiveStudyPresenceContext.Provider>
  )
}
