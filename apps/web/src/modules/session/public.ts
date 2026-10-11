/**
 * Public surface for module `session`.
 * Other modules may import only from this file.
 */
export * from './domain/session-entity/api'
export {
  isFollowableStudyPath,
  liveStudySurfaceFromPath,
  preferNewerLiveStudyProjection,
  shouldFollowLiveRoute,
  type LiveStudyProjection,
  type LiveStudySurface,
} from './domain/session-entity/model/live-study/liveStudyModel'
export { LiveStudyPresenceProvider } from './ui/live-presence/LiveStudyPresenceProvider'
export { useLiveStudyPresence } from './ui/live-presence/liveStudyPresenceContext'
export { useLiveStudySurfaceMirror } from './ui/live-presence/useLiveStudySurfaceMirror'
export {
  countRevealedNodes,
  isPassiveLiveStudyFollower,
  isPendingLiveStudyApply,
  isWeakerRevealMap,
  resolveFreestyleLiveFollowAction,
  shouldApplyLiveStudyView,
  shouldPublishLiveStudyView,
} from './ui/live-presence/shouldPublishLiveStudyView'
