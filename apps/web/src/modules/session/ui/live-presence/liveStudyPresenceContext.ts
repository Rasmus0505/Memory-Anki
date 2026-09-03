import { createContext, useContext } from 'react'
import type { UnifiedTimerSnapshot } from '@/shared/components/session/desktopTimerBridge'
import type {
  LiveStudyProjection,
  LiveStudySurface,
} from '@/modules/session/domain/session-entity/model/live-study/liveStudyModel'

export interface LiveStudyPublishPatch {
  takeControl?: boolean
  route?: string | null
  surface?: LiveStudySurface
  view?: unknown
  timer?: UnifiedTimerSnapshot | null
}

export interface LiveStudyPresenceValue {
  clientId: string
  projection: LiveStudyProjection
  isController: boolean
  connected: boolean
  publish: (patch: LiveStudyPublishPatch) => void
}

export const LiveStudyPresenceContext = createContext<LiveStudyPresenceValue | null>(null)

export function useLiveStudyPresence() {
  return useContext(LiveStudyPresenceContext)
}

export function useOptionalLiveStudyPresence() {
  return useContext(LiveStudyPresenceContext)
}
