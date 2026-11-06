import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { addExtraPalace } from '@/modules/practice/domain/feedConfig'
import type { FreestyleFeedConfig } from '@/shared/api/contracts'
import {
  cardPalaceId,
  getFreestyleRatedCardIds,
  type FreestyleUnitEncounterState,
} from '@/modules/practice/domain/queueState'
import type { FreestyleRoundPlanState } from '@/modules/practice/domain/roundPlan'
import {
  getPalaceReviewUnitsApi,
  markPalaceRootApi,
} from '@/modules/practice/ui/review/api/unitReviewApi'
import {
  findPalaceJumpTarget,
  resolvePalaceDirectoryClick,
  type FreestylePalaceJoinState,
} from '@/modules/practice/ui/freestyle/model/freestyle-palace-directory'
import type { FreestyleCard } from '@/shared/api/contracts'

/** How long a just-added palace may take to appear before we explain the wait. */
const PENDING_JUMP_TIMEOUT_MS = 8_000

export interface FreestylePalaceDirectoryActionsOptions {
  /** Palace of the card on screen; clicking it again is a no-op. */
  currentPalaceId: number | null
  /** Set on `/palaces/:id/review`; directory clicks stay inside that route. */
  reviewPalaceId: number | null
  cards: readonly FreestyleCard[]
  completedIds: readonly string[]
  encounters: Record<string, FreestyleUnitEncounterState>
  roundPlan: FreestyleRoundPlanState | null
  currentCardId: string | null
  jumpFromProgressRail: (cardId: string) => void
  setConfigAndPersist: (
    updater: (current: FreestyleFeedConfig) => FreestyleFeedConfig,
    options?: { silent?: boolean; preferCardId?: string | null },
  ) => void
}

/**
 * 随心左侧目录的点击行为：只读导航，绝不重写本轮范围。
 *
 * 已在场上 → 不动；宫殿复习路由 → 换宫殿；本轮已有它的卡 → 跳到最早一张
 * 未评分卡；否则先读复习投影，再决定「加入本轮 / 标记并加入 / 只解释」。
 * The round is only ever widened (`extra_palace_ids`), never narrowed.
 */
export function useFreestylePalaceDirectoryActions({
  currentPalaceId,
  reviewPalaceId,
  cards,
  completedIds,
  encounters,
  roundPlan,
  currentCardId,
  jumpFromProgressRail,
  setConfigAndPersist,
}: FreestylePalaceDirectoryActionsOptions) {
  const navigate = useNavigate()
  const [palaceJoin, setPalaceJoin] = useState<FreestylePalaceJoinState | null>(null)
  const [palaceJoinBusy, setPalaceJoinBusy] = useState(false)
  const pendingPalaceJumpRef = useRef<number | null>(null)
  const palaceJumpTimerRef = useRef<number | null>(null)

  const clearPendingPalaceJump = useCallback(() => {
    if (palaceJumpTimerRef.current != null) {
      window.clearTimeout(palaceJumpTimerRef.current)
      palaceJumpTimerRef.current = null
    }
  }, [])

  // A route change or unmount must not leave an 8s timer pointing at a round
  // the learner has already left.
  useEffect(() => clearPendingPalaceJump, [clearPendingPalaceJump])

  const jumpToPalaceIfScheduled = useCallback((palaceId: number): boolean => {
    const scored = new Set(
      getFreestyleRatedCardIds(cards, completedIds, encounters, roundPlan),
    )
    const target = findPalaceJumpTarget(cards, palaceId, scored)
    if (!target) return false
    if (target.complete) toast.info('这座宫殿本轮已评完')
    jumpFromProgressRail(target.cardId)
    return true
  }, [cards, completedIds, encounters, jumpFromProgressRail, roundPlan])

  const addPalaceToRound = useCallback((palaceId: number) => {
    clearPendingPalaceJump()
    pendingPalaceJumpRef.current = palaceId
    palaceJumpTimerRef.current = window.setTimeout(() => {
      palaceJumpTimerRef.current = null
      if (pendingPalaceJumpRef.current !== palaceId) return
      pendingPalaceJumpRef.current = null
      toast.info('还没排进来：可能不在「新学 / 复习」范围，或队列仍在更新')
    }, PENDING_JUMP_TIMEOUT_MS)
    // Silent: the learner is mid-review, so the queue rebuild must not blank
    // the card they are reading. The jump lands once the new card exists.
    setConfigAndPersist((current) => addExtraPalace(current, palaceId), {
      silent: true,
      preferCardId: currentCardId,
    })
  }, [clearPendingPalaceJump, currentCardId, setConfigAndPersist])

  /**
   * A directory click never rewrites the round's scope. It either moves to the
   * palace's place in the current queue, or asks before adding the palace.
   */
  const openPalaceFromDirectory = useCallback((palaceId: number) => {
    const click = resolvePalaceDirectoryClick({
      palaceId,
      currentPalaceId,
      reviewPalaceId,
    })
    if (click.kind === 'ignore') return
    if (click.kind === 'review') {
      navigate(`/palaces/${click.palaceId}/review`)
      return
    }
    if (jumpToPalaceIfScheduled(palaceId)) return
    setPalaceJoinBusy(true)
    getPalaceReviewUnitsApi(palaceId)
      .then((projection) => {
        const title = projection.title || '这座宫殿'
        if (projection.mark_required) {
          setPalaceJoin({ kind: 'unmarked', palaceId, title })
        } else if (projection.unit_count === 0) {
          setPalaceJoin({ kind: 'no_units', title })
        } else if (projection.due_unit_count === 0) {
          setPalaceJoin({
            kind: 'not_due',
            title,
            nextReviewDate: projection.next_review_date,
          })
        } else {
          setPalaceJoin({ kind: 'join', palaceId, title })
        }
      })
      .catch((cause) => toast.error(
        cause instanceof Error && cause.message
          ? cause.message
          : '读不到这座宫殿的复习进度，请稍后再试。',
      ))
      .finally(() => setPalaceJoinBusy(false))
  }, [currentPalaceId, jumpToPalaceIfScheduled, navigate, reviewPalaceId])

  const cancelPalaceJoin = useCallback(() => setPalaceJoin(null), [])

  const confirmPalaceJoin = useCallback(() => {
    if (!palaceJoin || (palaceJoin.kind !== 'join' && palaceJoin.kind !== 'unmarked')) return
    const state = palaceJoin
    setPalaceJoinBusy(true)
    const proceed = state.kind === 'unmarked'
      ? markPalaceRootApi(state.palaceId).then((projection) => {
        if (projection.unit_count === 0) {
          toast.error('这座宫殿还没有可复习的内容')
          return false
        }
        return true
      })
      : Promise.resolve(true)
    void proceed
      .then((allowed) => {
        if (!allowed) return
        setPalaceJoin(null)
        addPalaceToRound(state.palaceId)
      })
      .catch((cause) => toast.error(
        cause instanceof Error && cause.message
          ? cause.message
          : '加入本轮失败，请稍后再试。',
      ))
      .finally(() => setPalaceJoinBusy(false))
  }, [addPalaceToRound, palaceJoin])

  useEffect(() => {
    const palaceId = pendingPalaceJumpRef.current
    if (palaceId == null) return
    if (!cards.some((card) => cardPalaceId(card) === palaceId)) return
    pendingPalaceJumpRef.current = null
    clearPendingPalaceJump()
    jumpToPalaceIfScheduled(palaceId)
  }, [cards, clearPendingPalaceJump, jumpToPalaceIfScheduled])

  return {
    palaceJoin,
    palaceJoinBusy,
    openPalaceFromDirectory,
    confirmPalaceJoin,
    cancelPalaceJoin,
  }
}
