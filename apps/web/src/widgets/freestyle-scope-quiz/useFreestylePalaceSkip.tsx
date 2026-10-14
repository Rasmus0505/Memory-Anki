import { useCallback, useState, type RefObject } from 'react'
import { createOperationId } from '@/modules/practice/application/feedPersistence'
import { setFreestyleOverlaySkippedPalacesApi } from '@/modules/practice/ui/freestyle/api'
import type {
  FreestyleOverlayQuizState,
  FreestyleRoundStatePayload,
  PalaceQuizQuestion,
} from '@/shared/api/contracts'
import { ConfirmDialog } from '@/shared/components/ui/confirm-dialog'
import { toast } from '@/shared/feedback/toast'

export interface FreestylePalaceSkipOptions {
  roundId: string
  planVersionRef: RefObject<number>
  palaceId: number | null
  palaceTitle: string
  /** This palace's questions in the current 做题 pool, for the preview list. */
  palaceQuestions: PalaceQuizQuestion[]
  /** Syncs the round into the dialog; returns the new overlay state if any. */
  adoptRound: (round: FreestyleRoundStatePayload) => FreestyleOverlayQuizState | null
  loadQuestions: (session: FreestyleOverlayQuizState) => Promise<void>
}

/**
 * 「移除本宫殿本轮题目」: removes one palace's questions from this round's 随心
 * 做题 pool. Only the overlay pool changes. Review units, ratings and
 * `excluded_ids` are the round's own state and are not touched.
 */
export function useFreestylePalaceSkip({
  roundId,
  planVersionRef,
  palaceId,
  palaceTitle,
  palaceQuestions,
  adoptRound,
  loadQuestions,
}: FreestylePalaceSkipOptions) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const skip = useCallback(async () => {
    if (!roundId || palaceId == null || busy) return
    setBusy(true)
    const send = (expectedVersion: number) => setFreestyleOverlaySkippedPalacesApi(roundId, {
      operation_id: createOperationId(),
      expected_version: expectedVersion,
      palace_ids: [palaceId],
      skipped: true,
    })
    try {
      let round = await send(planVersionRef.current)
      if (round.conflict) round = await send(round.plan_version ?? round.version)
      if (round.conflict) throw new Error('本轮安排正在更新，请重试。')
      const next = adoptRound(round)
      if (next) await loadQuestions(next)
      toast.success(`已从本轮做题移除「${palaceTitle || '该宫殿'}」的 ${palaceQuestions.length} 题`)
      setOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '移除失败。')
    } finally {
      setBusy(false)
    }
  }, [adoptRound, busy, loadQuestions, palaceId, palaceQuestions.length, palaceTitle, planVersionRef, roundId])

  const confirmDialog = (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      title={`移除「${palaceTitle || '该宫殿'}」本轮题目？`}
      description={(
        <span className="block space-y-2">
          <span className="block">
            将从本轮随心做题移除 {palaceQuestions.length} 题。只影响这一轮做题，不改复习单元和评分，之后可在「出题范围」里重置。
          </span>
          <span className="block max-h-56 overflow-y-auto rounded-md border border-border/60 bg-muted/30 p-2 text-xs leading-5">
            {palaceQuestions.map((item) => (
              <span key={item.id} className="block truncate" title={item.stem}>
                · {item.stem}
              </span>
            ))}
          </span>
        </span>
      )}
      tone="danger"
      confirmText={busy ? '处理中…' : '确认移除'}
      onConfirm={() => void skip()}
    />
  )

  return {
    confirmDialog,
    openSkipConfirm: () => setOpen(true),
  }
}
