import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useAiRunConfigDialog } from '@/modules/settings/public'
import { getPalaceQuizQuestionsApi } from '@/modules/quiz/public'
import {
  QuizQuestionInteraction,
  useQuizAttemptOrchestration,
  type QuizRuntimeState,
} from '@/modules/quiz/public'
import type { PalaceQuizQuestion } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'
import { toast } from '@/shared/feedback/toast'

export function NodeBoundQuizDialog({
  open,
  onOpenChange,
  palaceId,
  nodeUid,
  questionIds,
  onQuestionCompleted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  palaceId: number | null
  nodeUid: string | null
  questionIds: number[]
  onQuestionCompleted: (questionId: number) => void
}) {
  const { promptForAiOptions, aiRunConfigDialog } = useAiRunConfigDialog()
  const [loading, setLoading] = useState(false)
  const [questions, setQuestions] = useState<PalaceQuizQuestion[]>([])
  const [index, setIndex] = useState(0)
  const [questionStates, setQuestionStates] = useState<Record<number, QuizRuntimeState>>({})

  const questionIdsKey = questionIds.join(',')

  useEffect(() => {
    if (!open || !palaceId || questionIds.length === 0) {
      setQuestions([])
      setIndex(0)
      setQuestionStates({})
      return
    }
    let cancelled = false
    setLoading(true)
    void getPalaceQuizQuestionsApi(palaceId)
      .then((response) => {
        if (cancelled) return
        const idSet = new Set(questionIds)
        const ordered = questionIds
          .map((id) => response.items.find((item) => item.id === id))
          .filter((item): item is PalaceQuizQuestion => Boolean(item))
        // Keep order from questionIds; drop missing
        const filtered = ordered.length
          ? ordered
          : response.items.filter((item) => idSet.has(item.id))
        setQuestions(filtered)
        setIndex(0)
        setQuestionStates({})
      })
      .catch((error) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : '加载题目失败。')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // questionIdsKey tracks content; questionIds is read for ordering within the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable key for id list
  }, [open, palaceId, questionIdsKey])

  const current = questions[index] ?? null

  const markCompleted = useCallback(
    (questionId: number) => {
      onQuestionCompleted(questionId)
    },
    [onQuestionCompleted],
  )

  const adapter = useMemo(
    () => ({
      readQuestionState: (questionId: number) => questionStates[questionId] ?? {},
      updateQuestionState: (
        questionId: number,
        updater: (current: QuizRuntimeState) => QuizRuntimeState,
      ) => {
        setQuestionStates((current) => {
          const prev = current[questionId] ?? {}
          const next = updater(prev)
          return { ...current, [questionId]: next }
        })
      },
      applyUpdatedQuestion: (question: PalaceQuizQuestion) => {
        setQuestions((current) =>
          current.map((item) => (item.id === question.id ? question : item)),
        )
      },
    }),
    [questionStates],
  )

  const orchestration = useQuizAttemptOrchestration({
    adapter,
    promptForAiOptions,
    shortAnswerEntrypointKey: 'palace.node-bound-quiz.short-answer',
    resultFeedbackMode: 'immediate',
    emitFeedback: dispatchGlobalFeedback,
    onChoiceStart: ({ question }) => {
      markCompleted(question.id)
    },
  })

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-hidden sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-2 pr-8">
              <span>知识点练习</span>
              <span className="text-xs font-normal text-muted-foreground">
                {nodeUid ? `节点 ${nodeUid.slice(0, 8)}…` : ''}
              </span>
            </DialogTitle>
            <DialogDescription>
              仅包含绑定到该卡片（含子树）且本会话尚未完成的题目。答过即从绿点计数中扣除。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 overflow-y-auto" style={{ maxHeight: '65vh' }}>
            {loading ? (
              <div className="py-10 text-center text-sm text-muted-foreground">加载题目…</div>
            ) : !current ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                当前没有可练习的题目。
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    第 {index + 1} / {questions.length} 题
                  </span>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={index <= 0}
                      onClick={() => setIndex((value) => Math.max(0, value - 1))}
                    >
                      <ChevronLeft className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={index >= questions.length - 1}
                      onClick={() => setIndex((value) => Math.min(questions.length - 1, value + 1))}
                    >
                      <ChevronRight className="size-4" />
                    </Button>
                  </div>
                </div>
                <QuizQuestionInteraction
                  question={current}
                  state={questionStates[current.id] ?? {}}
                  onStateChange={(updater) => adapter.updateQuestionState(current.id, updater)}
                  onChoiceResolve={(optionId, isCorrect) => {
                    orchestration.handleChoiceSelect(current, optionId, isCorrect)
                    markCompleted(current.id)
                  }}
                  onShortAnswerSubmit={() => {
                    orchestration.handleShortAnswerSubmit(current.id)
                    markCompleted(current.id)
                  }}
                  onRequestShortAnswerFeedback={() =>
                    void orchestration.handleShortAnswerFeedback(current)
                  }
                />
              </>
            )}
          </div>

          <div className="flex justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              <X className="mr-1 size-4" />
              关闭
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {aiRunConfigDialog}
    </>
  )
}
