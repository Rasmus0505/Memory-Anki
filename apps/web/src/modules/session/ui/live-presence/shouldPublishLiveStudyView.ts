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
