import { lazy } from 'react'

export { canCompleteRound, clampTrainingIndex } from './domain/trainingRound'
export { freestyleTrainingMachine } from './application/workflows/freestyleTrainingMachine'
export {
  DEFAULT_FREESTYLE_FEED_CONFIG,
  freestylePalaceScopeSignature,
  FREESTYLE_FEED_CONFIG_STORAGE_KEY,
  createOperationId as createDeterministicOperationId,
  sanitizeFreestyleFeedConfig,
} from './domain/feedConfig'
export {
  FREESTYLE_WORKSPACE_PRIMARY,
  freestyleWorkspaceLabel,
  freestyleWorkspacePath,
  isPalaceReviewWorkspace,
  normalizeFreestyleWorkspaceId,
  palaceReviewPath,
  palaceReviewWorkspaceId,
  parsePalaceReviewWorkspaceId,
  type FreestyleWorkspaceId,
  type PalaceReviewWorkspaceId,
} from './domain/freestyleWorkspace'
export {
  createOperationId,
  emitFreestylePeerRound,
  FREESTYLE_FEED_CONFIG_UPDATED_EVENT,
  FREESTYLE_PEER_ROUND_EVENT,
  isQueueStateFromPreviousDay,
  readFreestyleFeedConfig,
  readQueueState,
  resetFreestyleFeedConfig,
  saveFreestyleFeedConfig,
  saveQueueState,
  type FreestylePeerRoundDetail,
} from './application/feedPersistence'
export {
  FREESTYLE_DISPLAY_SETTINGS_UPDATED_EVENT,
  readFreestyleDisplaySettings,
  saveFreestyleDisplaySettings,
  sanitizeFreestyleDisplaySettings,
  type FreestyleFlipMode,
  type FreestyleRatingScope,
  type FreestyleDisplaySettings,
} from './application/freestyleDisplaySettings'
export {
  DEFAULT_QUEUE_STATE,
  FREESTYLE_QUEUE_STATE_STORAGE_KEY,
  UNDO_SKIP_WINDOW_MS,
  applyDeferredPalaceOrder,
  applySkip,
  cardPalaceId,
  cardUnitId,
  reviewUnitIdFromCardId,
  rebindCompletedIdsByUnit,
  rebindUnitEncountersByUnitId,
  sourceCardId,
  getFreestyleRatedCardIds,
  findEarliestUnratedIndex,
  getFreestylePassedCardIds,
  isRetryOccurrence,
  createRetryOccurrence,
  insertRetryOccurrenceAfterGap,
  bookedRetryAfterCards,
  nextRetryAttempt,
  resolveLeaveConfirmViewportId,
  restudyInterveningGap,
  isImmediateRestudyGap,
  removeRetryOccurrencesForSource,
  deferPalace,
  filterMutedPalaces,
  findNextPalaceIndex,
  findPreviousPalaceIndex,
  markCompleted,
  markIncomplete,
  hideCards,
  restoreCards,
  mergeQueuePreservingHistory,
  mergeRefreshQueue,
  moveCardToTail,
  moveRemainingPalaceToTail,
  mutePalace,
  needsRestudyAfterRatings,
  placeRestudyCardAtTail,
  placeRestudyCardWithMaxGap,
  RESTUDY_MAX_INTERVENING,
  resolveRebuildIndex,
  resolveRestudyPreferCardId,
  sanitizeQueueState,
  shouldRenewFreestyleEncounter,
  setUnitEncounterState,
  clearUnitEncounterState,
  startNewRound,
  undoSkip,
  visibleMountIndices,
  VIEW_HISTORY_MAX,
  pushViewHistory,
  popViewHistory,
  canPopViewHistory,
  clearMutedPalaces,
  restoreExplicitlySelectedCards,
  type FreestyleSkipState,
  type FreestyleUnitEncounterState,
} from './domain/queueState'
export {
  areAllOccurrencesPassed,
  findEarliestUnscoredIndex,
  isOccurrencePassed,
  isOccurrenceScored,
  isShadowOfQueueRemoval,
  occurrenceScore,
  passedOccurrenceIds,
  scoredOccurrenceIds,
  unscoredOccurrenceIds,
  unscoredOccurrenceIndices,
  type UnitProgressInput,
} from './domain/unitProgressState'
export {
  applyCompletedIdsToRoundPlan,
  syncCompletedIdsToRoundPlan,
  applyRoundPlanOrder,
  countIncompletePalaceUnits,
  createRoundPlan,
  excludeRoundPlanCards,
  isSequentialPalaceBlocked,
  mergeRetainedHiddenIds,
  planCardStatus,
  planEntryForLiveCard,
  reorderRoundPlan,
  roundPlanConfigSignature,
  sanitizeRoundPlan,
  stampRestudyPlan,
  updateRoundPlanCard,
  type FreestyleRoundPlanCard,
  type FreestyleRoundPlanCardStatus,
  type FreestyleRoundPlanState,
} from './domain/roundPlan'
export {
  cardSettledOut,
  compressRoundPlanCards,
  compressibleRoundPlanIds,
  expandSettledIds,
  settledIdSet,
} from './domain/roundPlanCompress'
// Immersive feed page is lazy so shell-level imports of this barrel do not load the whole freestyle graph.
export const ImmersiveFreestylePage = lazy(() => import('./ui/freestyle/ImmersiveFreestylePage'))
export * from './ui/review/api'
export * from './ui/review/components/PracticeCompletionDialog'
export * from './ui/review/components/PalaceReviewUnitsPanel'
export * from './ui/review/components/PalaceLadderProgress'
export { SubjectMemoryLadder, subjectKeyFromProgressId } from './ui/review/components/subject-memory-ladder'
export * from './ui/review/hooks/useReviewCompletionCoordinator'
export * from './ui/review/hooks/useReviewFlowSession'
export * from './ui/review/model/mind-map-review-flow'
export * from './ui/review/ReviewSessionSkeleton'
