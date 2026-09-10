export function isPendingLiveStudyApply(input: {
  applyCommitted: boolean
  serialized: string
  lastSent: string
  interactionUnchanged: boolean
}): boolean {
  if (!input.applyCommitted) return false
  if (input.serialized === input.lastSent) return false
  if (input.interactionUnchanged) return false
  return true
}

export function shouldApplyLiveStudyView(input: {
  revision: number
  lastAppliedRevision: number
  viewJson: string
  lastAppliedViewJson: string
}): 'skip' | 'consume-revision' | 'apply' {
  if (input.revision === input.lastAppliedRevision) return 'skip'
  if (input.viewJson === input.lastAppliedViewJson) return 'consume-revision'
  return 'apply'
}

export function countRevealedNodes(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 0
  return Object.values(raw as Record<string, unknown>).filter((value) => value === 'revealed').length
}

export function isWeakerRevealMap(local: unknown, remote: unknown) {
  const remoteCount = countRevealedNodes(remote)
  if (remoteCount === 0) return false
  return countRevealedNodes(local) < remoteCount
}

export function isPassiveLiveStudyFollower(input: {
  isController: boolean
  controllerClientId: string | null
  remoteSurface: string
  localSurface?: string
}) {
  if (input.isController) return false
  if (input.controllerClientId) return true
  if (!input.remoteSurface || input.remoteSurface === 'idle') return false
  if (input.localSurface) return input.remoteSurface === input.localSurface
  return true
}

export type FreestyleLiveFollowAction =
  | 'skip'
  | 'wait-queue'
  | 'seek'
  | 'apply'
  | 'consume-revision'
  | 'abandon'

export function resolveFreestyleLiveFollowAction(input: {
  applyDecision: 'skip' | 'consume-revision' | 'apply'
  remoteCardId: string | null
  localCardId: string | null
  queueCardIds: string[]
}): FreestyleLiveFollowAction {
  if (input.applyDecision === 'skip') return 'skip'
  if (input.applyDecision === 'consume-revision') return 'consume-revision'
  if (!input.remoteCardId) return 'apply'
  if (input.localCardId === input.remoteCardId) return 'apply'
  if (input.queueCardIds.includes(input.remoteCardId)) return 'seek'
  if (input.queueCardIds.length === 0) return 'wait-queue'
  return 'abandon'
}

export function shouldPublishLiveStudyView(input: {
  isActive: boolean
  publishWhen: boolean
  serialized: string
  lastSent: string
  isFollower: boolean
  interactionUnchanged: boolean
  pendingApply?: boolean
  hydrated?: boolean
  weakerThanRemote?: boolean
}): boolean {
  if (input.hydrated === false) return false
  if (!input.isActive || !input.publishWhen) return false
  if (input.pendingApply) return false
  if (input.weakerThanRemote) return false
  if (!input.serialized || input.serialized === input.lastSent) return false
  if (input.isFollower && !input.lastSent) return false
  if (input.isFollower && input.interactionUnchanged) return false
  return true
}
