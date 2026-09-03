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

export function shouldPublishLiveStudyView(input: {
  isActive: boolean
  publishWhen: boolean
  serialized: string
  lastSent: string
  isFollower: boolean
  interactionUnchanged: boolean
  pendingApply?: boolean
}): boolean {
  if (!input.isActive || !input.publishWhen) return false
  if (input.pendingApply) return false
  if (!input.serialized || input.serialized === input.lastSent) return false
  if (input.isFollower && !input.lastSent) return false
  if (input.isFollower && input.interactionUnchanged) return false
  return true
}
