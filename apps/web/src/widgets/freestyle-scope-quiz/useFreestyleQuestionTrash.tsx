import { useCallback, useState, type Dispatch, type SetStateAction, type RefObject } from 'react'
import { createOperationId } from '@/modules/practice/application/feedPersistence'
import {
  ensureFreestyleOverlayQuizApi,
} from '@/modules/practice/ui/freestyle/api'
import { overlayFromRound } from './overlayQuizHydrate'
import { deletePalaceQuizQuestionApi } from '@/modules/quiz/domain/quiz-entity/api'
import { writeQuizSessionState, type QuizRuntimeState } from '@/modules/quiz/public'
import type {
  FreestyleFeedConfig,
  FreestyleOverlayQuizState,
  FreestyleRoundStatePayload,
  PalaceQuizQuestion,
} from '@/shared/api/contracts'
import { ConfirmDialog } from '@/shared/components/ui/confirm-dialog'
import { toast } from '@/shared/feedback/toast'

function isAlreadyDeletedQuizQuestionError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  return message.includes('题目不存在')
}

export interface FreestyleQuestionTrashOptions {
  current: PalaceQuizQuestion | null
  questions: PalaceQuizQuestion[]
  setQuestions: Dispatch<SetStateAction<PalaceQuizQuestion[]>>
  questionStates: Record<number, QuizRuntimeState>
  setQuestionStates: Dispatch<SetStateAction<Record<number, QuizRuntimeState>>>
  questionStatesRef: RefObject<Record<number, QuizRuntimeState>>
  index: number
  setIndex: Dispatch<SetStateAction<number>>
  indexRef: RefObject<number>
  persistProgress: (
    nextIndex: number,
    nextStates: Record<number, QuizRuntimeState>,
  ) => void
  roundIdRef: RefObject<string>
  planVersionRef: RefObject<number>
  storedConfigRef: RefObject<FreestyleFeedConfig>
  onRoundSync: (round: FreestyleRoundStatePayload) => void
  setOverlay: Dispatch<SetStateAction<FreestyleOverlayQuizState | null>>
  removedQuestionIdsRef: RefObject<Set<number>>
}

export function useFreestyleQuestionTrash({
  current,
  questions,
  setQuestions,
  questionStates,
  setQuestionStates,
  questionStatesRef,
  index,
  setIndex,
  indexRef,
  persistProgress,
  roundIdRef,
  planVersionRef,
  storedConfigRef,
  onRoundSync,
  setOverlay,
  removedQuestionIdsRef,
}: FreestyleQuestionTrashOptions) {
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)

  // progress_overlay_quiz never rewrites question_ids, so after a local delete the
  // round still carries the dead id until ensure rebuilds the pack from the DB.
  const syncOverlayQuestionIds = useCallback(async () => {
    if (!roundIdRef.current) return
    const send = (expectedVersion: number) =>
      ensureFreestyleOverlayQuizApi(roundIdRef.current, {
        operation_id: createOperationId(),
        expected_version: expectedVersion,
        config: storedConfigRef.current,
      })
    const applyVersion = (round: FreestyleRoundStatePayload) => {
      if (typeof round.plan_version === 'number' && round.plan_version > 0) {
        planVersionRef.current = round.plan_version
      } else if (typeof round.version === 'number' && round.version > 0) {
        planVersionRef.current = round.version
      }
      onRoundSync(round)
    }
    try {
      let round = await send(planVersionRef.current)
      if (round.conflict) {
        applyVersion(round)
        round = await send(planVersionRef.current)
      }
      applyVersion(round)
      const next = overlayFromRound(round)
      if (next) setOverlay(next)
    } catch (error) {
      // Local list is already correct; next open re-ensures and self-heals.
      // A missing-question error is the delete itself, not a failed sync.
      if (isAlreadyDeletedQuizQuestionError(error)) return
      toast.error(error instanceof Error ? error.message : '同步做题会话失败。')
    }
  }, [onRoundSync, planVersionRef, roundIdRef, setOverlay, storedConfigRef])

  const handleDeleteCurrent = useCallback(async () => {
    if (!current) return
    const removedId = current.id
    if (removedQuestionIdsRef.current?.has(removedId)) return
    const snapshotQuestions = questions
    const snapshotStates = questionStates
    const snapshotIndex = index
    removedQuestionIdsRef.current?.add(removedId)
    const nextQuestions = snapshotQuestions.filter((item) => item.id !== removedId)
    const nextStates = { ...snapshotStates }
    delete nextStates[removedId]
    const nextIndex = nextQuestions.length > 0
      ? Math.min(snapshotIndex, nextQuestions.length - 1)
      : 0
    setQuestions(nextQuestions)
    setQuestionStates(nextStates)
    questionStatesRef.current = nextStates
    setIndex(nextIndex)
    indexRef.current = nextIndex
    try {
      await deletePalaceQuizQuestionApi(removedId)
    } catch (error) {
      if (!isAlreadyDeletedQuizQuestionError(error)) {
        removedQuestionIdsRef.current?.delete(removedId)
        setQuestions(snapshotQuestions)
        setQuestionStates(snapshotStates)
        questionStatesRef.current = snapshotStates
        setIndex(snapshotIndex)
        indexRef.current = snapshotIndex
        toast.error(error instanceof Error ? error.message : '删除失败。')
        return
      }
    }
    writeQuizSessionState(removedId, {})
    persistProgress(nextIndex, nextStates)
    toast.success('题目已移入回收站。')
    void syncOverlayQuestionIds()
  }, [
    current,
    index,
    indexRef,
    persistProgress,
    questionStates,
    questionStatesRef,
    questions,
    removedQuestionIdsRef,
    setIndex,
    setQuestionStates,
    setQuestions,
    syncOverlayQuestionIds,
  ])

  const confirmDialog = (
    <ConfirmDialog
      open={deleteConfirmOpen}
      onOpenChange={setDeleteConfirmOpen}
      title="移入回收站"
      description="题目将从做题队列和统计中移除，作答记录保留，可在设置页回收站恢复。"
      tone="danger"
      confirmText="移入回收站"
      onConfirm={() => void handleDeleteCurrent()}
    />
  )

  return {
    confirmDialog,
    openDeleteConfirm: () => setDeleteConfirmOpen(true),
  }
}
