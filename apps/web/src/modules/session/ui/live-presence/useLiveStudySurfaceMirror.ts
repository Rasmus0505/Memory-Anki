import { useEffect, useRef } from 'react'
import type { LiveStudySurface } from '@/modules/session/domain/session-entity/model/live-study/liveStudyModel'
import { useLiveStudyPresence } from '@/modules/session/ui/live-presence/liveStudyPresenceContext'
import {
  isPendingLiveStudyApply,
  shouldApplyLiveStudyView,
  shouldPublishLiveStudyView,
} from '@/modules/session/ui/live-presence/shouldPublishLiveStudyView'

export function useLiveStudySurfaceMirror<TView>({
  surface,
  route,
  view,
  decode,
  apply,
  sameInteraction,
  publishWhen = true,
  isActive = true,
}: {
  surface: LiveStudySurface
  route: string
  view: TView
  decode: (raw: unknown) => TView | null
  apply: (decoded: TView) => boolean | void
  sameInteraction?: (previous: TView, next: TView) => boolean
  publishWhen?: boolean
  isActive?: boolean
}) {
  const presence = useLiveStudyPresence()
  const lastSentRef = useRef('')
  const lastAppliedRevisionRef = useRef(-1)
  const pendingApplyRef = useRef(false)
  const serialized = JSON.stringify(view)

  useEffect(() => {
    if (!presence || presence.isController) return
    if (presence.projection.surface !== surface) return
    if (presence.projection.revision === lastAppliedRevisionRef.current) return
    const decoded = decode(presence.projection.view)
    if (!decoded) return
    const viewJson = JSON.stringify(decoded)
    const applyDecision = shouldApplyLiveStudyView({
      revision: presence.projection.revision,
      lastAppliedRevision: lastAppliedRevisionRef.current,
      viewJson,
      lastAppliedViewJson: lastSentRef.current,
    })
    if (applyDecision === 'skip') return
    lastAppliedRevisionRef.current = presence.projection.revision
    if (applyDecision === 'consume-revision') return
    if (apply(decoded) === false) return
    lastSentRef.current = viewJson
    pendingApplyRef.current = true
  }, [apply, decode, presence, surface])

  useEffect(() => {
    if (!presence) return
    const isFollower = Boolean(presence.projection.controllerClientId && !presence.isController)
    let interactionUnchanged = false
    if (sameInteraction && lastSentRef.current) {
      try {
        const previous = decode(JSON.parse(lastSentRef.current) as unknown)
        const next = decode(JSON.parse(serialized) as unknown)
        interactionUnchanged = Boolean(previous && next && sameInteraction(previous, next))
      } catch {
        interactionUnchanged = false
      }
    }
    const pendingApply = isPendingLiveStudyApply({
      applyCommitted: pendingApplyRef.current,
      serialized,
      lastSent: lastSentRef.current,
      interactionUnchanged,
    })
    if (!pendingApply) pendingApplyRef.current = false
    if (!shouldPublishLiveStudyView({
      isActive,
      publishWhen,
      serialized,
      lastSent: lastSentRef.current,
      isFollower,
      interactionUnchanged,
      pendingApply,
    })) return
    lastSentRef.current = serialized
    presence.publish({
      takeControl: true,
      surface,
      route,
      view,
    })
  }, [decode, isActive, presence, publishWhen, route, sameInteraction, serialized, surface, view])
}
