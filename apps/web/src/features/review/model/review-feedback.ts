import type { RevealState } from '@/entities/session/model'
import type {
  RevealFlowMode,
  ReviewMindMapNode,
} from '@/entities/review/model/review-flow-tree'

export type ReviewFeedbackEvent =
  | 'category_expand'
  | 'next_level_expand'
  | 'card_reveal'
  | 'branch_clear'
  | 'all_clear_ready'
  | 'session_complete'
  | 'session_reset'

export type ReviewFeedbackFlashState =
  | 'idle'
  | 'category_expand'
  | 'next_level_expand'
  | 'card_reveal'
  | 'branch_clear'
  | 'all_clear_ready'
  | 'session_complete'
  | 'session_reset'

export interface ReviewFeedbackTransitionInput {
  previousRevealMap: Record<string, RevealState>
  nextRevealMap: Record<string, RevealState>
  root: ReviewMindMapNode
  revealMode?: RevealFlowMode
}

export interface ReviewFeedbackTransitionResult {
  events: ReviewFeedbackEvent[]
  expandedNodeIds: string[]
  revealedNodeIds: string[]
  branchClearNodeIds: string[]
  primaryNodeId: string | null
  primaryEvent: Exclude<ReviewFeedbackEvent, 'session_complete' | 'session_reset'> | null
  depthHint: 0 | 1 | 2
  allClearReady: boolean
}

export interface ReviewRewardSnapshot {
  comboCount: number
  maxComboCount: number
  nextMilestone: number | null
  allClearReady: boolean
  feedbackFlashState: ReviewFeedbackFlashState
  celebratedNodeIds: string[]
}

export interface ReviewRewardProgressionOptions {
  current: ReviewRewardSnapshot
  transition: ReviewFeedbackTransitionResult
}

export const REVIEW_COMBO_MILESTONES = [3, 5, 8, 13]

function collectNodes(root: ReviewMindMapNode) {
  const ids: string[] = []
  const parents: ReviewMindMapNode[] = []
  const walk = (node: ReviewMindMapNode) => {
    ids.push(node.id)
    if (node.children.length > 0) {
      parents.push(node)
      node.children.forEach(walk)
    }
  }
  walk(root)
  return { ids, parents }
}

function isVisible(state: RevealState | undefined) {
  return state === 'placeholder' || state === 'revealed'
}

function transitionedToRevealed(
  previousRevealMap: Record<string, RevealState>,
  nextRevealMap: Record<string, RevealState>,
  nodeId: string,
) {
  const previousState = previousRevealMap[nodeId] ?? 'hidden'
  const nextState = nextRevealMap[nodeId] ?? 'hidden'
  return previousState === 'placeholder' && nextState === 'revealed'
}

export function deriveReviewFeedbackTransition({
  previousRevealMap,
  nextRevealMap,
  root,
  revealMode = 'standard',
}: ReviewFeedbackTransitionInput): ReviewFeedbackTransitionResult {
  const { ids, parents } = collectNodes(root)
  const nonRootIds = ids.filter((id) => id !== root.id)
  const events: ReviewFeedbackEvent[] = []
  const expandedNodeIds = nonRootIds.filter((id) => {
    const previousState = previousRevealMap[id] ?? 'hidden'
    const nextState = nextRevealMap[id] ?? 'hidden'
    return previousState === 'hidden' && nextState === 'placeholder'
  })
  const revealedNodeIds = nonRootIds.filter((id) =>
    transitionedToRevealed(previousRevealMap, nextRevealMap, id) ||
    (
      revealMode === 'mini-checkpoint' &&
      (previousRevealMap[id] ?? 'hidden') === 'hidden' &&
      (nextRevealMap[id] ?? 'hidden') === 'revealed'
    ),
  )

  const branchClearNodeIds = parents
    .filter((node) => node.id !== root.id)
    .filter((node) => {
      if (node.children.length === 0) return false
      const previousAllVisible = node.children.every((child) =>
        isVisible(previousRevealMap[child.id] ?? 'hidden'),
      )
      const nextAllVisible = node.children.every((child) =>
        isVisible(nextRevealMap[child.id] ?? 'hidden'),
      )
      return !previousAllVisible && nextAllVisible
    })
    .map((node) => node.id)

  if (expandedNodeIds.length > 0) {
    const expandedNode = root.children.some((child) => expandedNodeIds.includes(child.id))
      ? 'category_expand'
      : 'next_level_expand'
    events.push(expandedNode)
  }

  if (revealedNodeIds.length > 0) {
    events.push('card_reveal')
  }

  if (branchClearNodeIds.length > 0) {
    events.push('branch_clear')
  }

  const allClearReady =
    nonRootIds.length > 0 &&
    nonRootIds.every((id) => (nextRevealMap[id] ?? 'hidden') === 'revealed')

  const previousAllClearReady =
    nonRootIds.length > 0 &&
    nonRootIds.every((id) => (previousRevealMap[id] ?? 'hidden') === 'revealed')

  if (allClearReady && !previousAllClearReady) {
    events.push('all_clear_ready')
  }

  const primaryEvent =
    events.find((event) =>
      event === 'branch_clear' ||
      event === 'card_reveal' ||
      event === 'next_level_expand' ||
      event === 'category_expand',
    ) ?? null
  const primaryNodeId =
    branchClearNodeIds.at(-1) ??
    revealedNodeIds.at(-1) ??
    expandedNodeIds.at(-1) ??
    null
  const primaryNode = primaryNodeId
    ? parents.find((node) => node.id === primaryNodeId) ??
      root.children.find((node) => node.id === primaryNodeId) ??
      null
    : null

  return {
    events,
    expandedNodeIds,
    revealedNodeIds,
    branchClearNodeIds,
    primaryNodeId,
    primaryEvent,
    depthHint:
      primaryEvent === 'category_expand'
        ? 0
        : primaryEvent === 'next_level_expand'
          ? 1
          : primaryEvent === 'card_reveal'
            ? 2
            : primaryNode?.children?.length
              ? 1
              : 2,
    allClearReady,
  }
}

export function getNextComboMilestone(comboCount: number) {
  return REVIEW_COMBO_MILESTONES.find((value) => value > comboCount) ?? null
}

export function createInitialReviewRewardSnapshot(): ReviewRewardSnapshot {
  return {
    comboCount: 0,
    maxComboCount: 0,
    nextMilestone: REVIEW_COMBO_MILESTONES[0] ?? null,
    allClearReady: false,
    feedbackFlashState: 'idle',
    celebratedNodeIds: [],
  }
}

export function progressReviewRewardState({
  current,
  transition,
}: ReviewRewardProgressionOptions): ReviewRewardSnapshot {
  const nextCelebratedNodeIds = [...current.celebratedNodeIds]
  let comboCount = current.comboCount

  for (const nodeId of transition.revealedNodeIds) {
    if (nextCelebratedNodeIds.includes(nodeId)) continue
    nextCelebratedNodeIds.push(nodeId)
    comboCount += 1
  }

  const maxComboCount = Math.max(current.maxComboCount, comboCount)
  const lastEvent = transition.events.at(-1)
  const feedbackFlashState: ReviewFeedbackFlashState =
    lastEvent === 'category_expand' ||
    lastEvent === 'next_level_expand' ||
    lastEvent === 'card_reveal' ||
    lastEvent === 'branch_clear' ||
    lastEvent === 'all_clear_ready'
      ? lastEvent
      : current.feedbackFlashState

  return {
    comboCount,
    maxComboCount,
    nextMilestone: getNextComboMilestone(comboCount),
    allClearReady: transition.allClearReady,
    feedbackFlashState,
    celebratedNodeIds: nextCelebratedNodeIds,
  }
}

export function resetReviewRewardState() {
  return createInitialReviewRewardSnapshot()
}

export function getReviewProgressPercent(allClearReady: boolean, revealedCount: number, totalCount: number) {
  if (totalCount <= 0) return 0
  if (allClearReady) return 100
  return Math.max(0, Math.min(100, Math.round((revealedCount / totalCount) * 100)))
}

export function getReviewProgressTone(progressPercent: number) {
  if (progressPercent >= 100) return 'all-clear'
  if (progressPercent >= 70) return 'surge'
  if (progressPercent >= 35) return 'warmup'
  return 'calm'
}

export function getReviewSurpriseCopy(comboCount: number) {
  if (comboCount >= 13) return '宫殿通感已连上线。'
  if (comboCount >= 8) return '记忆通路开始发亮。'
  if (comboCount >= 5) return '节奏起来了，继续推进。'
  return '手感到了，继续揭晓。'
}

export function shouldEmitSurprise(args: {
  comboCount: number
  surpriseEnabled: boolean
  nowMs: number
  lastSurpriseAtMs: number | null
}) {
  const { comboCount, surpriseEnabled, nowMs, lastSurpriseAtMs } = args
  if (!surpriseEnabled) return false
  if (!REVIEW_COMBO_MILESTONES.includes(comboCount)) return false
  if (lastSurpriseAtMs == null) return true
  return nowMs - lastSurpriseAtMs >= 90_000
}
