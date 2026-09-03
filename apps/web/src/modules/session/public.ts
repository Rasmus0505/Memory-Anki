/**
 * Public surface for module `session`.
 * Other modules may import only from this file.
 */
export * from './domain/session-entity/api'
export * from './domain/session-entity/model'
export * from './domain/study-session-entity/api'
export {
  adoptLiveTimerSnapshot,
  useTimedSession,
} from './domain/session-entity/model/timed-session/timedSessionStateMachine'
export {
  interpolateTimerSeconds,
  isFollowableStudyPath,
  liveStudySurfaceFromPath,
  shouldFollowLiveRoute,
  type LiveStudyProjection,
  type LiveStudySurface,
} from './domain/session-entity/model/live-study/liveStudyModel'
export {
  setLiveForegroundClockSuppressed,
} from './domain/session-entity/model/timed-session/liveClockOwnership'
export { LiveStudyPresenceProvider } from './ui/live-presence/LiveStudyPresenceProvider'
export { useLiveStudyPresence } from './ui/live-presence/liveStudyPresenceContext'
export { useLiveStudySurfaceMirror } from './ui/live-presence/useLiveStudySurfaceMirror'
export {
  isPendingLiveStudyApply,
  shouldApplyLiveStudyView,
  shouldPublishLiveStudyView,
} from './ui/live-presence/shouldPublishLiveStudyView'
export * from './ui/time-records/components/TimeRecordDialog'
export * from './ui/time-records/components/TimeRecordQuickAddDialog'
export * from './ui/time-records/components/TimeRecordsBreakdownChart'
export * from './ui/time-records/components/TimeRecordsTable'
export * from './ui/time-records/components/TimeRecordsTrendChart'
export * from './ui/time-records/hooks/useTimeRecordsDashboard'
export * from './ui/time-records/model/time-record-filter'
