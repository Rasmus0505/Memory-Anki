import * as React from 'react'
import { CheckCircle2, LoaderCircle, Shuffle, Sparkles, Star, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type {
  MindMapEditorState,
  PalaceGroupedItem,
  PalaceGroupedListResponse,
  PalaceQuizAnswerPayload,
  PalaceQuizGenerationPreview,
  PalaceQuizQuestionDraft,
  PalaceQuizQuestionType,
  PalaceShortAnswerFeedback,
} from '@/shared/api/contracts'
import { getPalacesGroupedApi } from '@/shared/api/modules/palaces'
import {
  createPalaceQuizQuestionApi,
  previewPalaceQuizGenerationFromReviewMindmapApi,
  requestPalaceShortAnswerFeedbackApi,
} from '@/shared/api/modules/quizzes'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Textarea } from '@/shared/components/ui/textarea'
import { cn } from '@/shared/lib/utils'

type QuizBreakMode = 'chapter' | 'cross_palace'
type QuizBreakStep = 'config' | 'practice' | 'summary'

interface RelatedPalaceOption {
  id: number
  title: string
  subjectName: string
}

interface QuestionRuntimeState {
  resolved?: boolean
  correct?: boolean
  selectedOptionId?: string
  trueFalseAnswer?: boolean
  blankInputs?: Record<string, string>
  submittedBlankIds?: string[]
  matchingPairs?: Record<string, string>
  selectedLeftId?: string | null
  orderingIds?: string[]
  categorizationAssignments?: Record<string, string>
  selectedCategorizationItemId?: string | null
  shortAnswerText?: string
  shortAnswerFeedback?: PalaceShortAnswerFeedback | null
  shortAnswerFeedbackLoading?: boolean
  skipped?: boolean
}

interface ReviewMindmapQuizBreakDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  palaceId: number | null
  reviewEditorDoc: MindMapEditorState['editor_doc']
}

const QUESTION_TYPE_OPTIONS: Array<{ type: PalaceQuizQuestionType; label: string }> = [
  { type: 'multiple_choice', label: '选择题' },
  { type: 'true_false', label: '判断题' },
  { type: 'fill_blank', label: '填空题' },
  { type: 'matching', label: '连线题' },
  { type: 'ordering', label: '排序题' },
  { type: 'categorization', label: '归类题' },
  { type: 'short_answer', label: '简答题' },
]

function flattenRelatedPalaces(payload: PalaceGroupedListResponse | null, currentPalaceId: number | null): RelatedPalaceOption[] {
  if (!payload) return []
  const byId = new Map<number, RelatedPalaceOption>()
  const addPalace = (palace: PalaceGroupedItem, fallbackSubjectName: string) => {
    if (!palace?.id || palace.id === currentPalaceId || byId.has(palace.id)) return
    byId.set(palace.id, {
      id: palace.id,
      title: palace.resolved_title || palace.title || `宫殿 ${palace.id}`,
      subjectName: palace.resolved_subject?.name || fallbackSubjectName || '未分学科',
    })
  }
  for (const subjectGroup of payload.subjects || []) {
    const subjectName = subjectGroup.subject?.name || '未分学科'
    for (const chapterGroup of subjectGroup.chapter_groups || []) {
      for (const palace of chapterGroup.palaces || []) addPalace(palace, subjectName)
    }
    for (const palace of subjectGroup.ungrouped_palaces || []) addPalace(palace, subjectName)
  }
  for (const group of payload.groups || []) {
    for (const palace of group.palaces || []) addPalace(palace, palace.resolved_subject?.name || '未分学科')
  }
  for (const palace of payload.ungrouped || []) addPalace(palace, palace.resolved_subject?.name || '未分学科')
  return Array.from(byId.values()).sort((a, b) => a.subjectName.localeCompare(b.subjectName, 'zh-CN') || a.title.localeCompare(b.title, 'zh-CN'))
}

function getQuestionTypeLabel(type: PalaceQuizQuestionType) {
  return QUESTION_TYPE_OPTIONS.find((item) => item.type === type)?.label || type
}

function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

function answerMatches(input: string, answer: string, aliases: string[] = []) {
  const normalizedInput = normalizeText(input)
  return [answer, ...aliases].some((candidate) => normalizeText(candidate) === normalizedInput)
}

function isQuestionResolved(question: PalaceQuizQuestionDraft, state: QuestionRuntimeState | undefined) {
  return Boolean(state?.resolved || (question.question_type === 'multiple_choice' && state?.selectedOptionId) || (question.question_type === 'true_false' && state?.trueFalseAnswer !== undefined))
}

function moveItem(ids: string[], index: number, direction: -1 | 1) {
  const next = [...ids]
  const targetIndex = index + direction
  if (targetIndex < 0 || targetIndex >= next.length) return next
  const [item] = next.splice(index, 1)
  next.splice(targetIndex, 0, item)
  return next
}

function buildInitialOrderingIds(answerPayload: PalaceQuizAnswerPayload) {
  const ids = (answerPayload.items || []).map((item) => item.id)
  if (ids.length <= 2) return [...ids].reverse()
  return [ids[1], ids[0], ...ids.slice(2)]
}

export function ReviewMindmapQuizBreakDialog({
  open,
  onOpenChange,
  palaceId,
  reviewEditorDoc,
}: ReviewMindmapQuizBreakDialogProps) {
  const [step, setStep] = React.useState<QuizBreakStep>('config')
  const [mode, setMode] = React.useState<QuizBreakMode>('chapter')
  const [questionCount, setQuestionCount] = React.useState(5)
  const [questionTypes, setQuestionTypes] = React.useState<PalaceQuizQuestionType[]>(
    QUESTION_TYPE_OPTIONS.map((item) => item.type),
  )
  const [relatedPayload, setRelatedPayload] = React.useState<PalaceGroupedListResponse | null>(null)
  const [relatedLoading, setRelatedLoading] = React.useState(false)
  const [selectedRelatedIds, setSelectedRelatedIds] = React.useState<number[]>([])
  const [scopePanelOpen, setScopePanelOpen] = React.useState(false)
  const [generationLoading, setGenerationLoading] = React.useState(false)
  const [generationError, setGenerationError] = React.useState('')
  const [preview, setPreview] = React.useState<PalaceQuizGenerationPreview | null>(null)
  const [currentIndex, setCurrentIndex] = React.useState(0)
  const [states, setStates] = React.useState<Record<number, QuestionRuntimeState>>({})
  const [savedQuestionIds, setSavedQuestionIds] = React.useState<Record<number, number>>({})
  const [savingIndex, setSavingIndex] = React.useState<number | null>(null)

  const relatedOptions = React.useMemo(
    () => flattenRelatedPalaces(relatedPayload, palaceId),
    [palaceId, relatedPayload],
  )

  React.useEffect(() => {
    if (!open) return
    setStep('config')
    setGenerationError('')
  }, [open])

  React.useEffect(() => {
    if (!open || mode !== 'cross_palace' || relatedPayload || relatedLoading) return
    setRelatedLoading(true)
    getPalacesGroupedApi()
      .then((payload) => {
        setRelatedPayload(payload)
        const defaults = flattenRelatedPalaces(payload, palaceId).map((item) => item.id)
        setSelectedRelatedIds(defaults)
      })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : '加载关联宫殿失败')
      })
      .finally(() => setRelatedLoading(false))
  }, [mode, open, palaceId, relatedLoading, relatedPayload])

  const questions = preview?.questions || []
  const currentQuestion = questions[currentIndex] ?? null
  const currentState = states[currentIndex] || {}
  const savedCount = Object.keys(savedQuestionIds).length
  const completedCount = Object.values(states).filter((state) => state.resolved || state.skipped).length
  const correctCount = Object.values(states).filter((state) => state.correct).length
  const skippedCount = Object.values(states).filter((state) => state.skipped).length

  const updateCurrentState = React.useCallback((patch: Partial<QuestionRuntimeState>) => {
    setStates((current) => ({
      ...current,
      [currentIndex]: {
        ...(current[currentIndex] || {}),
        ...patch,
      },
    }))
  }, [currentIndex])

  const handleGenerate = async () => {
    if (!palaceId) return
    if (questionTypes.length === 0) {
      setGenerationError('请至少选择一种题型。')
      return
    }
    if (mode === 'cross_palace' && selectedRelatedIds.length === 0) {
      setGenerationError('跨宫殿联系至少需要选择一个关联宫殿。')
      return
    }
    setGenerationLoading(true)
    setGenerationError('')
    try {
      const result = await previewPalaceQuizGenerationFromReviewMindmapApi(palaceId, {
        mode,
        question_types: questionTypes,
        question_count: questionCount,
        review_editor_doc: reviewEditorDoc,
        related_palace_ids: mode === 'cross_palace' ? selectedRelatedIds : [],
      })
      setPreview(result)
      setCurrentIndex(0)
      setStates({})
      setSavedQuestionIds({})
      setStep('practice')
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : '生成题目失败。')
    } finally {
      setGenerationLoading(false)
    }
  }

  const handleSaveQuestion = async (index: number) => {
    if (!palaceId || !questions[index] || savedQuestionIds[index]) return savedQuestionIds[index] || null
    setSavingIndex(index)
    try {
      const response = await createPalaceQuizQuestionApi(palaceId, questions[index])
      setSavedQuestionIds((current) => ({ ...current, [index]: response.item.id }))
      toast.success('已加入题库')
      return response.item.id
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存题目失败')
      return null
    } finally {
      setSavingIndex(null)
    }
  }

  const handleShortAnswerFeedback = async () => {
    if (!currentQuestion || currentQuestion.question_type !== 'short_answer') return
    const userAnswer = currentState.shortAnswerText?.trim() || ''
    if (!userAnswer) {
      toast.error('请先填写你的答案。')
      return
    }
    updateCurrentState({ shortAnswerFeedbackLoading: true })
    try {
      const questionId = savedQuestionIds[currentIndex] || await handleSaveQuestion(currentIndex)
      if (!questionId) return
      const feedback = await requestPalaceShortAnswerFeedbackApi(questionId, userAnswer)
      updateCurrentState({ shortAnswerFeedback: feedback })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'AI 点评失败')
    } finally {
      updateCurrentState({ shortAnswerFeedbackLoading: false })
    }
  }

  const goNext = () => {
    if (currentIndex >= questions.length - 1) {
      setStep('summary')
      return
    }
    setCurrentIndex((index) => index + 1)
  }

  const toggleQuestionType = (type: PalaceQuizQuestionType) => {
    setQuestionTypes((current) =>
      current.includes(type)
        ? current.filter((item) => item !== type)
        : [...current, type],
    )
  }

  const toggleRelatedId = (id: number) => {
    setSelectedRelatedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }

  const renderConfig = () => (
    <div className="space-y-5 px-6 py-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setMode('chapter')}
          className={cn('rounded-2xl border px-4 py-4 text-left', mode === 'chapter' ? 'border-emerald-300 bg-emerald-50' : 'border-border/70')}
        >
          <div className="font-semibold">本章强化</div>
          <div className="mt-1 text-sm text-muted-foreground">只基于当前复习脑图生成题。</div>
        </button>
        <button
          type="button"
          onClick={() => setMode('cross_palace')}
          className={cn('rounded-2xl border px-4 py-4 text-left', mode === 'cross_palace' ? 'border-sky-300 bg-sky-50' : 'border-border/70')}
        >
          <div className="font-semibold">跨宫殿联系</div>
          <div className="mt-1 text-sm text-muted-foreground">结合其他宫殿摘要，强化知识关联。</div>
        </button>
      </div>

      <div className="space-y-2">
        <Label>题型</Label>
        <div className="flex flex-wrap gap-2">
          {QUESTION_TYPE_OPTIONS.map((item) => (
            <button
              key={item.type}
              type="button"
              onClick={() => toggleQuestionType(item.type)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm transition-colors',
                questionTypes.includes(item.type)
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-border/70 bg-background',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-end">
        <div className="space-y-2">
          <Label htmlFor="quiz-break-count">题目数量</Label>
          <Input
            id="quiz-break-count"
            type="number"
            min={1}
            max={12}
            value={questionCount}
            onChange={(event) => setQuestionCount(Number(event.currentTarget.value))}
          />
        </div>
        {mode === 'cross_palace' ? (
          <div className="rounded-2xl border border-border/70 bg-muted/30 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium">关联范围</div>
                <div className="text-sm text-muted-foreground">
                  {relatedLoading ? '正在加载宫殿...' : `已选择 ${selectedRelatedIds.length} / ${relatedOptions.length} 个宫殿`}
                </div>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => setScopePanelOpen((value) => !value)}>
                调整范围
              </Button>
            </div>
            {scopePanelOpen ? (
              <div className="mt-3 max-h-52 overflow-auto rounded-xl border bg-background p-3">
                <div className="mb-2 flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setSelectedRelatedIds(relatedOptions.map((item) => item.id))}>
                    全选
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setSelectedRelatedIds([])}>
                    清空
                  </Button>
                </div>
                <div className="space-y-2">
                  {relatedOptions.map((option) => (
                    <label key={option.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted">
                      <input
                        type="checkbox"
                        checked={selectedRelatedIds.includes(option.id)}
                        onChange={() => toggleRelatedId(option.id)}
                      />
                      <span className="text-xs text-muted-foreground">{option.subjectName}</span>
                      <span className="text-sm">{option.title}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {generationError ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {generationError}
        </div>
      ) : null}
    </div>
  )

  const renderFeedback = (correct: boolean | undefined, analysis: string) => {
    if (correct === undefined) return null
    return (
      <div className={cn('mt-4 rounded-2xl border px-4 py-3', correct ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50')}>
        <div className={cn('font-semibold', correct ? 'text-emerald-700' : 'text-rose-700')}>
          {correct ? '回答正确' : '再调整一下'}
        </div>
        <div className="mt-2 text-sm text-slate-700">解析：{analysis || '暂无解析'}</div>
      </div>
    )
  }

  const renderQuestionBody = (question: PalaceQuizQuestionDraft) => {
    const answerPayload = question.answer_payload || {}
    if (question.question_type === 'multiple_choice') {
      const correctOptionId = answerPayload.correct_option_id || ''
      return (
        <div className="space-y-3">
          {question.options.map((option) => {
            const selected = currentState.selectedOptionId === option.id
            const resolved = Boolean(currentState.selectedOptionId)
            const correct = option.id === correctOptionId
            return (
              <button
                key={option.id}
                type="button"
                disabled={resolved}
                onClick={() => updateCurrentState({ selectedOptionId: option.id, resolved: true, correct: correct })}
                className={cn(
                  'w-full rounded-2xl border px-4 py-3 text-left transition-colors',
                  resolved && correct && 'border-emerald-300 bg-emerald-50',
                  resolved && selected && !correct && 'border-rose-300 bg-rose-50',
                  !resolved && 'hover:bg-muted',
                )}
              >
                <span className="mr-2 font-semibold">{option.id}.</span>{option.text}
              </button>
            )
          })}
          {renderFeedback(currentState.selectedOptionId ? currentState.correct : undefined, question.analysis)}
        </div>
      )
    }

    if (question.question_type === 'true_false') {
      const correctAnswer = Boolean(answerPayload.correct_answer)
      const resolved = currentState.trueFalseAnswer !== undefined
      return (
        <div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[true, false].map((value) => (
              <button
                key={String(value)}
                type="button"
                disabled={resolved}
                onClick={() => updateCurrentState({ trueFalseAnswer: value, resolved: true, correct: value === correctAnswer })}
                className={cn(
                  'rounded-2xl border px-4 py-5 text-lg font-semibold',
                  resolved && value === correctAnswer && 'border-emerald-300 bg-emerald-50 text-emerald-700',
                  resolved && currentState.trueFalseAnswer === value && value !== correctAnswer && 'border-rose-300 bg-rose-50 text-rose-700',
                  !resolved && 'hover:bg-muted',
                )}
              >
                {value ? '对' : '错'}
              </button>
            ))}
          </div>
          {resolved && !currentState.correct && answerPayload.false_explanation ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              错误点：{answerPayload.false_explanation}
            </div>
          ) : null}
          {renderFeedback(resolved ? currentState.correct : undefined, question.analysis)}
        </div>
      )
    }

    if (question.question_type === 'fill_blank') {
      const blankInputs = currentState.blankInputs || {}
      const submittedBlankIds = currentState.submittedBlankIds || []
      const blanks = answerPayload.blanks || []
      const submitBlank = (blankId: string) => {
        updateCurrentState({ submittedBlankIds: Array.from(new Set([...submittedBlankIds, blankId])) })
      }
      const submitAll = () => {
        const allCorrect = blanks.every((blank) => answerMatches(blankInputs[blank.id] || '', blank.answer, blank.aliases))
        updateCurrentState({ submittedBlankIds: blanks.map((blank) => blank.id), resolved: true, correct: allCorrect })
      }
      return (
        <div className="space-y-3">
          {blanks.map((blank) => {
            const submitted = submittedBlankIds.includes(blank.id)
            const correct = answerMatches(blankInputs[blank.id] || '', blank.answer, blank.aliases)
            return (
              <div key={blank.id} className="rounded-2xl border border-border/70 px-4 py-3">
                <Label>{blank.id}</Label>
                <div className="mt-2 flex gap-2">
                  <Input
                    value={blankInputs[blank.id] || ''}
                    onChange={(event) => updateCurrentState({ blankInputs: { ...blankInputs, [blank.id]: event.currentTarget.value } })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        submitBlank(blank.id)
                      }
                    }}
                    placeholder="输入后按 Enter 提交此空"
                  />
                  {submitted ? <Badge variant={correct ? 'secondary' : 'destructive'}>{correct ? '正确' : `答案：${blank.answer}`}</Badge> : null}
                </div>
              </div>
            )
          })}
          <Button type="button" onClick={submitAll}>提交全部</Button>
          {renderFeedback(currentState.resolved ? currentState.correct : undefined, question.analysis)}
        </div>
      )
    }

    if (question.question_type === 'matching') {
      const pairs = answerPayload.pairs || []
      const selectedLeftId = currentState.selectedLeftId || null
      const matchingPairs = currentState.matchingPairs || {}
      const rightItems = [...pairs].reverse()
      const submit = () => {
        const correct = pairs.every((pair) => matchingPairs[pair.left_id] === pair.right_id)
        updateCurrentState({ resolved: true, correct })
      }
      return (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              {pairs.map((pair) => (
                <button
                  key={pair.left_id}
                  type="button"
                  onClick={() => updateCurrentState({ selectedLeftId: pair.left_id })}
                  className={cn(
                    'w-full rounded-2xl border px-3 py-3 text-left',
                    selectedLeftId === pair.left_id && 'border-sky-400 bg-sky-50',
                    matchingPairs[pair.left_id] && 'bg-slate-50',
                    currentState.resolved && matchingPairs[pair.left_id] === pair.right_id && 'border-emerald-300 bg-emerald-50',
                    currentState.resolved && matchingPairs[pair.left_id] !== pair.right_id && 'border-rose-300 bg-rose-50',
                  )}
                >
                  {pair.left}
                  {matchingPairs[pair.left_id] ? <span className="ml-2 text-xs text-muted-foreground">已连接</span> : null}
                </button>
              ))}
            </div>
            <div className="space-y-2">
              {rightItems.map((pair) => (
                <button
                  key={pair.right_id}
                  type="button"
                  onClick={() => {
                    if (!selectedLeftId || currentState.resolved) return
                    updateCurrentState({
                      matchingPairs: { ...matchingPairs, [selectedLeftId]: pair.right_id },
                      selectedLeftId: null,
                    })
                  }}
                  className={cn(
                    'w-full rounded-2xl border px-3 py-3 text-left hover:bg-muted',
                    Object.values(matchingPairs).includes(pair.right_id) && 'border-sky-200 bg-sky-50/60',
                  )}
                >
                  {pair.right}
                </button>
              ))}
            </div>
          </div>
          <Button type="button" onClick={submit}>提交连线</Button>
          {renderFeedback(currentState.resolved ? currentState.correct : undefined, question.analysis)}
        </div>
      )
    }

    if (question.question_type === 'ordering') {
      const items = answerPayload.items || []
      const orderIds = currentState.orderingIds || buildInitialOrderingIds(answerPayload)
      const itemById = Object.fromEntries(items.map((item) => [item.id, item]))
      const submit = () => {
        const correct = JSON.stringify(orderIds) === JSON.stringify(answerPayload.correct_order_ids || [])
        updateCurrentState({ resolved: true, correct })
      }
      return (
        <div className="space-y-3">
          {orderIds.map((id, index) => (
            <div
              key={id}
              draggable={!currentState.resolved}
              onDragStart={(event) => event.dataTransfer.setData('text/plain', id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                const draggedId = event.dataTransfer.getData('text/plain')
                const fromIndex = orderIds.indexOf(draggedId)
                if (fromIndex < 0 || currentState.resolved) return
                const next = [...orderIds]
                next.splice(fromIndex, 1)
                next.splice(index, 0, draggedId)
                updateCurrentState({ orderingIds: next })
              }}
              className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 px-4 py-3"
            >
              <span><span className="mr-2 text-muted-foreground">{index + 1}.</span>{itemById[id]?.text || id}</span>
              <span className="flex gap-1">
                <Button type="button" variant="outline" size="sm" disabled={currentState.resolved} onClick={() => updateCurrentState({ orderingIds: moveItem(orderIds, index, -1) })}>上移</Button>
                <Button type="button" variant="outline" size="sm" disabled={currentState.resolved} onClick={() => updateCurrentState({ orderingIds: moveItem(orderIds, index, 1) })}>下移</Button>
              </span>
            </div>
          ))}
          <Button type="button" onClick={submit}>提交排序</Button>
          {currentState.resolved ? (
            <div className="rounded-2xl border border-border/70 bg-muted/40 px-4 py-3 text-sm">
              正确顺序：{(answerPayload.correct_order_ids || []).map((id) => itemById[id]?.text || id).join(' → ')}
            </div>
          ) : null}
          {renderFeedback(currentState.resolved ? currentState.correct : undefined, question.analysis)}
        </div>
      )
    }

    if (question.question_type === 'categorization') {
      const categories = answerPayload.categories || []
      const items = answerPayload.items || []
      const assignments = currentState.categorizationAssignments || {}
      const selectedItemId = currentState.selectedCategorizationItemId || null
      const submit = () => {
        const correct = items.every((item) => assignments[item.id] === item.category_id)
        updateCurrentState({ resolved: true, correct })
      }
      return (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 rounded-2xl border border-border/70 bg-muted/30 p-3">
            {items.map((item) => {
              const assigned = assignments[item.id]
              const wrong = currentState.resolved && assigned !== item.category_id
              return (
                <button
                  key={item.id}
                  type="button"
                  draggable={!currentState.resolved}
                  onDragStart={(event) => event.dataTransfer.setData('text/plain', item.id)}
                  onClick={() => updateCurrentState({ selectedCategorizationItemId: item.id })}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-sm',
                    selectedItemId === item.id && 'border-sky-400 bg-sky-50',
                    assigned && 'bg-slate-100',
                    wrong && 'border-rose-300 bg-rose-50 text-rose-700',
                  )}
                >
                  {item.text}
                </button>
              )
            })}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {categories.map((category) => (
              <div
                key={category.id}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  const itemId = event.dataTransfer.getData('text/plain')
                  if (!itemId || currentState.resolved) return
                  updateCurrentState({ categorizationAssignments: { ...assignments, [itemId]: category.id } })
                }}
                className="min-h-28 rounded-2xl border border-border/70 p-3"
              >
                <button
                  type="button"
                  className="mb-2 w-full rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
                  onClick={() => {
                    if (!selectedItemId || currentState.resolved) return
                    updateCurrentState({
                      categorizationAssignments: { ...assignments, [selectedItemId]: category.id },
                      selectedCategorizationItemId: null,
                    })
                  }}
                >
                  {category.name}
                </button>
                <div className="flex flex-wrap gap-2">
                  {items.filter((item) => assignments[item.id] === category.id).map((item) => (
                    <Badge key={item.id} variant={currentState.resolved && item.category_id !== category.id ? 'destructive' : 'outline'}>
                      {item.text}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <Button type="button" onClick={submit}>提交归类</Button>
          {currentState.resolved ? (
            <div className="rounded-2xl border border-border/70 bg-muted/40 px-4 py-3 text-sm">
              正确归类：{items.map((item) => `${item.text} → ${categories.find((category) => category.id === item.category_id)?.name || item.category_id}`).join('；')}
            </div>
          ) : null}
          {renderFeedback(currentState.resolved ? currentState.correct : undefined, question.analysis)}
        </div>
      )
    }

    return (
      <div className="space-y-3">
        <Textarea
          value={currentState.shortAnswerText || ''}
          onChange={(event) => updateCurrentState({ shortAnswerText: event.currentTarget.value })}
          placeholder="写下你的答案..."
          rows={5}
        />
        <Button type="button" onClick={() => updateCurrentState({ resolved: true, correct: true })}>提交答案</Button>
        {currentState.resolved ? (
          <div className="space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm">
            <div><span className="font-semibold">参考答案：</span>{answerPayload.reference_answer || '暂无参考答案'}</div>
            <div><span className="font-semibold">解析：</span>{question.analysis || '暂无解析'}</div>
            <Button type="button" variant="outline" size="sm" disabled={currentState.shortAnswerFeedbackLoading} onClick={() => void handleShortAnswerFeedback()}>
              {currentState.shortAnswerFeedbackLoading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              AI点评我的答案
            </Button>
            {currentState.shortAnswerFeedback ? (
              <div className="rounded-xl border bg-background px-3 py-2">
                {currentState.shortAnswerFeedback.feedback_text}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  const renderPractice = () => {
    if (!currentQuestion) return null
    return (
      <div className="space-y-4 px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{currentIndex + 1} / {questions.length}</Badge>
            <Badge variant="outline">{getQuestionTypeLabel(currentQuestion.question_type)}</Badge>
            {savedQuestionIds[currentIndex] ? <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">已加入题库</Badge> : null}
          </div>
          <div className="text-sm text-muted-foreground">已完成 {completedCount} 题</div>
        </div>
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="text-base">{currentQuestion.stem}</CardTitle>
          </CardHeader>
          <CardContent>{renderQuestionBody(currentQuestion)}</CardContent>
        </Card>
      </div>
    )
  }

  const renderSummary = () => (
    <div className="space-y-4 px-6 py-8 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
        <CheckCircle2 className="h-8 w-8" />
      </div>
      <div>
        <div className="text-lg font-semibold">这组做题休息完成了</div>
        <div className="mt-1 text-sm text-muted-foreground">正确 {correctCount} 题，跳过 {skippedCount} 题，收藏 {savedCount} 题。</div>
      </div>
      {preview?.related_palace_summaries?.length ? (
        <div className="rounded-2xl border border-border/70 bg-muted/30 px-4 py-3 text-left text-sm">
          本次关联了 {preview.related_palace_summaries.length} 个宫殿。
        </div>
      ) : null}
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-hidden">
        <DialogHeader>
          <div>
            <DialogTitle>做题休息</DialogTitle>
            <DialogDescription>把主动回忆切成轻量小游戏，好题可以顺手加入题库。</DialogDescription>
          </div>
          <DialogClose onClick={() => onOpenChange(false)} />
        </DialogHeader>

        <div className="min-h-0 overflow-auto">
          {step === 'config' ? renderConfig() : null}
          {step === 'practice' ? renderPractice() : null}
          {step === 'summary' ? renderSummary() : null}
        </div>

        <DialogFooter className="flex-wrap justify-between">
          {step === 'config' ? (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
              <Button type="button" disabled={generationLoading || !palaceId} onClick={() => void handleGenerate()}>
                {generationLoading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Shuffle className="mr-2 h-4 w-4" />}
                生成题目
              </Button>
            </>
          ) : null}
          {step === 'practice' ? (
            <>
              <Button type="button" variant="outline" onClick={() => setStep('config')}>重新配置</Button>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    updateCurrentState({ skipped: true, resolved: true, correct: false })
                    goNext()
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  丢弃/跳过
                </Button>
                <Button type="button" variant="outline" disabled={savingIndex === currentIndex || Boolean(savedQuestionIds[currentIndex])} onClick={() => void handleSaveQuestion(currentIndex)}>
                  {savingIndex === currentIndex ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Star className="mr-2 h-4 w-4" />}
                  {savedQuestionIds[currentIndex] ? '已收藏' : '收藏到题库'}
                </Button>
                <Button type="button" disabled={!isQuestionResolved(currentQuestion as PalaceQuizQuestionDraft, currentState)} onClick={goNext}>
                  {currentIndex >= questions.length - 1 ? '看小结' : '下一题'}
                </Button>
              </div>
            </>
          ) : null}
          {step === 'summary' ? (
            <>
              <Button type="button" variant="outline" onClick={() => setStep('config')}>再来一组</Button>
              <Button type="button" onClick={() => onOpenChange(false)}>回到复习</Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
