import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { consumeLiveStudyStream, publishLiveStudyCommand } from '@/modules/session/domain/session-entity/api/liveStudyApi'
import {
  emptyLiveStudyProjection,
  readLiveStudyClientId,
  shouldFollowLiveRoute,
  type LiveStudyProjection,
} from '@/modules/session/domain/session-entity/model/live-study/liveStudyModel'
import { setLiveForegroundClockSuppressed } from '@/modules/session/domain/session-entity/model/timed-session/liveClockOwnership'
import {
  LiveStudyPresenceContext,
  type LiveStudyPublishPatch,
} from '@/modules/session/ui/live-presence/liveStudyPresenceContext'

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
      setProjection((current) => (
        current.revision === response.projection.revision ? current : response.projection
      ))
    }).catch(() => {
      // Presence is best-effort; local study UI stays usable offline.
    })
  }, [clientId])

  useEffect(() => {
    let cancelled = false
    let retry = 0
    let timer: number | null = null
    let controller: AbortController | null = null
    const connect = () => {
      controller?.abort()
      controller = new AbortController()
      const signal = controller.signal
      void consumeLiveStudyStream(
        clientId,
        (envelope) => {
          if (cancelled) return
          retry = 0
          setConnected(true)
          applyingRemoteRef.current = envelope.publisherClientId !== clientId
          setProjection((current) => (
            current.revision === envelope.projection.revision
              && current.updatedAt === envelope.projection.updatedAt
              ? current
              : envelope.projection.revision < current.revision
                ? current
                : envelope.projection
          ))
          queueMicrotask(() => {
            applyingRemoteRef.current = false
          })
        },
        signal,
      )
        .catch(() => {
          if (!cancelled) setConnected(false)
        })
        .finally(() => {
          if (cancelled || signal.aborted) return
          setConnected(false)
          const delay = Math.min(8_000, 500 * 2 ** retry)
          retry += 1
          timer = window.setTimeout(connect, delay)
        })
    }
    connect()
    return () => {
      cancelled = true
      if (timer != null) window.clearTimeout(timer)
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
