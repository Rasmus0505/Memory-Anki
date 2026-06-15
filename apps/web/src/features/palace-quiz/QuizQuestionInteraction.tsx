import { LoaderCircle, Sparkles } from 'lucide-react'
import type { PalaceQuizQuestion, PalaceQuizQuestionDraft, PalaceShortAnswerFeedback } from '@/shared/api/contracts'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Textarea } from '@/shared/components/ui/textarea'
import { cn } from '@/shared/lib/utils'

export interface QuizRuntimeState {
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
  shortAnswerSubmitted?: boolean
  shortAnswerFeedback?: PalaceShortAnswerFeedback | null
  shortAnswerFeedbackLoading?: boolean
  skipped?: boolean
}

function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

function answerMatches(input: string, answer: string, aliases: string[] = []) {
  const normalizedInput = normalizeText(input)
  return [answer, ...aliases].some((candidate) => normalizeText(candidate) === normalizedInput)
}

function moveItem(ids: string[], index: number, direction: -1 | 1) {
  const next = [...ids]
  const targetIndex = index + direction
  if (targetIndex < 0 || targetIndex >= next.length) return next
  const [item] = next.splice(index, 1)
  next.splice(targetIndex, 0, item)
  return next
}

function buildInitialOrderingIds(question: PalaceQuizQuestion | PalaceQuizQuestionDraft) {
  const ids = (question.answer_payload.items || []).map((item) => item.id)
  if (ids.length <= 2) return [...ids].reverse()
  return [ids[1], ids[0], ...ids.slice(2)]
}

function renderResolvedFeedback(correct: boolean | undefined, analysis: string, compact: boolean) {
  if (correct === undefined) return null
  return (
    <div
      className={cn(
        'border px-4 py-3 text-sm',
        compact ? 'rounded-xl' : 'rounded-2xl',
        correct ? 'border-success/20 bg-success/5' : 'border-destructive/20 bg-destructive/5',
      )}
    >
      <div className={cn('font-medium', correct ? 'text-success' : 'text-destructive')}>
        {correct ? '回答正确' : '再调整一下'}
      </div>
      <div className="mt-2 text-muted-foreground">解析：{analysis || '暂无解析'}</div>
    </div>
  )
}

export function QuizQuestionInteraction({
  question,
  state,
  compact = false,
  onStateChange,
  onChoiceResolve,
  onShortAnswerSubmit,
  onRequestShortAnswerFeedback,
}: {
  question: PalaceQuizQuestion | PalaceQuizQuestionDraft
  state: QuizRuntimeState | undefined
  compact?: boolean
  onStateChange: (updater: (current: QuizRuntimeState) => QuizRuntimeState) => void
  onChoiceResolve?: (optionId: string, isCorrect: boolean) => void
  onShortAnswerSubmit?: () => void
  onRequestShortAnswerFeedback?: () => void
}) {
  const currentState = state || {}

  if (question.question_type === 'multiple_choice') {
    const correctOptionId = question.answer_payload.correct_option_id || ''
    return (
      <div className={cn('grid', compact ? 'gap-2' : 'gap-3')}>
        {(question.options || []).map((option) => {
          const selected = currentState.selectedOptionId === option.id
          const resolved = Boolean(currentState.resolved)
          const correct = option.id === correctOptionId
          return (
            <button
              key={option.id}
              type="button"
              disabled={resolved}
              onClick={() => {
                if (resolved) return
                onStateChange((current) => ({
                  ...current,
                  selectedOptionId: option.id,
                  resolved: true,
                  correct,
                }))
                onChoiceResolve?.(option.id, correct)
              }}
              className={cn(
                'border text-left text-sm transition-colors',
                compact ? 'rounded-xl px-3 py-2' : 'rounded-2xl px-4 py-3',
                resolved && correct && 'border-success/30 bg-success/5 text-success',
                resolved && selected && !correct && 'border-destructive/30 bg-destructive/5 text-destructive',
                resolved && !selected && !correct && 'border-border/70 bg-background/60 text-muted-foreground',
                !resolved && 'border-border/70 bg-background/80 hover:border-primary/40 hover:bg-primary/5',
              )}
            >
              <span className="font-medium">{option.id}.</span> {option.text}
            </button>
          )
        })}
        {currentState.resolved ? (
          <div
            className={cn(
              'border border-border/70 bg-background/70',
              compact ? 'rounded-xl px-3 py-3' : 'rounded-2xl px-4 py-4',
            )}
          >
            <div className="text-sm font-medium">
              {currentState.correct ? '回答正确' : '回答错误'}
            </div>
            <div className={cn('text-sm text-muted-foreground', compact ? 'mt-1.5' : 'mt-2')}>
              正确答案：{correctOptionId || '暂无'}
            </div>
            <div className={cn('text-sm', compact ? 'mt-2' : 'mt-3')}>
              解析：{question.analysis || '暂无解析'}
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  if (question.question_type === 'true_false') {
    const correctAnswer = Boolean(question.answer_payload.correct_answer)
    const resolved = currentState.trueFalseAnswer !== undefined
    return (
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {[true, false].map((value) => (
            <button
              key={String(value)}
              type="button"
              disabled={resolved}
              onClick={() =>
                onStateChange((current) => ({
                  ...current,
                  trueFalseAnswer: value,
                  resolved: true,
                  correct: value === correctAnswer,
                }))
              }
              className={cn(
                'rounded-2xl border px-4 py-4 text-base font-semibold',
                resolved && value === correctAnswer && 'border-success/30 bg-success/5 text-success',
                resolved &&
                  currentState.trueFalseAnswer === value &&
                  value !== correctAnswer &&
                  'border-destructive/30 bg-destructive/5 text-destructive',
                !resolved && 'hover:bg-muted',
              )}
            >
              {value ? '对' : '错'}
            </button>
          ))}
        </div>
        {resolved && !currentState.correct && question.answer_payload.false_explanation ? (
          <div className="rounded-2xl border border-warning/20 bg-warning/5 px-4 py-3 text-sm text-warning">
            错误点：{question.answer_payload.false_explanation}
          </div>
        ) : null}
        {renderResolvedFeedback(resolved ? currentState.correct : undefined, question.analysis, compact)}
      </div>
    )
  }

  if (question.question_type === 'fill_blank') {
    const blankInputs = currentState.blankInputs || {}
    const submittedBlankIds = currentState.submittedBlankIds || []
    const blanks = question.answer_payload.blanks || []
    const submitAll = () => {
      const allCorrect = blanks.every((blank) =>
        answerMatches(blankInputs[blank.id] || '', blank.answer, blank.aliases),
      )
      onStateChange((current) => ({
        ...current,
        submittedBlankIds: blanks.map((blank) => blank.id),
        resolved: true,
        correct: allCorrect,
      }))
    }
    return (
      <div className="space-y-3">
        {blanks.map((blank) => {
          const submitted = submittedBlankIds.includes(blank.id)
          const correct = answerMatches(blankInputs[blank.id] || '', blank.answer, blank.aliases)
          return (
            <div key={blank.id} className="rounded-2xl border border-border/70 px-4 py-3">
              <div className="text-sm font-medium">{blank.id}</div>
              <div className="mt-2 flex gap-2">
                <Input
                  value={blankInputs[blank.id] || ''}
                  onChange={(event) =>
                    onStateChange((current) => ({
                      ...current,
                      blankInputs: {
                        ...(current.blankInputs || {}),
                        [blank.id]: event.target.value,
                      },
                    }))
                  }
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    onStateChange((current) => ({
                      ...current,
                      submittedBlankIds: Array.from(
                        new Set([...(current.submittedBlankIds || []), blank.id]),
                      ),
                    }))
                  }}
                  placeholder="输入后按 Enter 提交此空"
                />
                {submitted ? (
                  <Badge variant={correct ? 'secondary' : 'destructive'}>
                    {correct ? '正确' : `答案：${blank.answer}`}
                  </Badge>
                ) : null}
              </div>
            </div>
          )
        })}
        <Button type="button" onClick={submitAll}>
          提交全部
        </Button>
        {renderResolvedFeedback(currentState.resolved ? currentState.correct : undefined, question.analysis, compact)}
      </div>
    )
  }

  if (question.question_type === 'matching') {
    const pairs = question.answer_payload.pairs || []
    const selectedLeftId = currentState.selectedLeftId || null
    const matchingPairs = currentState.matchingPairs || {}
    const rightItems = [...pairs].reverse()
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            {pairs.map((pair) => (
              <button
                key={pair.left_id}
                type="button"
                onClick={() => onStateChange((current) => ({ ...current, selectedLeftId: pair.left_id }))}
                className={cn(
                  'w-full rounded-2xl border px-3 py-3 text-left',
                  selectedLeftId === pair.left_id && 'border-info/50 bg-info/5',
                  matchingPairs[pair.left_id] && 'bg-muted',
                  currentState.resolved &&
                    matchingPairs[pair.left_id] === pair.right_id &&
                    'border-success/30 bg-success/5',
                  currentState.resolved &&
                    matchingPairs[pair.left_id] !== pair.right_id &&
                    'border-destructive/30 bg-destructive/5',
                )}
              >
                {pair.left}
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
                  onStateChange((current) => ({
                    ...current,
                    matchingPairs: {
                      ...(current.matchingPairs || {}),
                      [selectedLeftId]: pair.right_id,
                    },
                    selectedLeftId: null,
                  }))
                }}
                className={cn(
                  'w-full rounded-2xl border px-3 py-3 text-left hover:bg-muted',
                  Object.values(matchingPairs).includes(pair.right_id) && 'border-info/20 bg-info/5',
                )}
              >
                {pair.right}
              </button>
            ))}
          </div>
        </div>
        <Button
          type="button"
          onClick={() =>
            onStateChange((current) => ({
              ...current,
              resolved: true,
              correct: pairs.every(
                (pair) => (current.matchingPairs || {})[pair.left_id] === pair.right_id,
              ),
            }))
          }
        >
          提交连线
        </Button>
        {renderResolvedFeedback(currentState.resolved ? currentState.correct : undefined, question.analysis, compact)}
      </div>
    )
  }

  if (question.question_type === 'ordering') {
    const items = question.answer_payload.items || []
    const orderIds = currentState.orderingIds || buildInitialOrderingIds(question)
    const itemById = Object.fromEntries(items.map((item) => [item.id, item]))
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
              onStateChange((current) => ({ ...current, orderingIds: next }))
            }}
            className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 px-4 py-3"
          >
            <span>
              <span className="mr-2 text-muted-foreground">{index + 1}.</span>
              {itemById[id]?.text || id}
            </span>
            <span className="flex gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={currentState.resolved}
                onClick={() =>
                  onStateChange((current) => ({
                    ...current,
                    orderingIds: moveItem(orderIds, index, -1),
                  }))
                }
              >
                上移
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={currentState.resolved}
                onClick={() =>
                  onStateChange((current) => ({
                    ...current,
                    orderingIds: moveItem(orderIds, index, 1),
                  }))
                }
              >
                下移
              </Button>
            </span>
          </div>
        ))}
        <Button
          type="button"
          onClick={() =>
            onStateChange((current) => ({
              ...current,
              resolved: true,
              correct:
                JSON.stringify(orderIds) ===
                JSON.stringify(question.answer_payload.correct_order_ids || []),
            }))
          }
        >
          提交排序
        </Button>
        {currentState.resolved ? (
          <div className="rounded-2xl border border-border/70 bg-muted/40 px-4 py-3 text-sm">
            正确顺序：
            {(question.answer_payload.correct_order_ids || [])
              .map((id) => itemById[id]?.text || id)
              .join(' → ')}
          </div>
        ) : null}
        {renderResolvedFeedback(currentState.resolved ? currentState.correct : undefined, question.analysis, compact)}
      </div>
    )
  }

  if (question.question_type === 'categorization') {
    const categories = question.answer_payload.categories || []
    const items = question.answer_payload.items || []
    const assignments = currentState.categorizationAssignments || {}
    const selectedItemId = currentState.selectedCategorizationItemId || null
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2 rounded-2xl border border-border/70 bg-muted/30 p-3">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              draggable={!currentState.resolved}
              onDragStart={(event) => event.dataTransfer.setData('text/plain', item.id)}
              onClick={() =>
                onStateChange((current) => ({
                  ...current,
                  selectedCategorizationItemId: item.id,
                }))
              }
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm',
                selectedItemId === item.id && 'border-info/50 bg-info/5',
                assignments[item.id] && 'bg-muted',
                currentState.resolved &&
                  assignments[item.id] !== item.category_id &&
                  'border-destructive/30 bg-destructive/5 text-destructive',
              )}
            >
              {item.text}
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {categories.map((category) => (
            <div
              key={category.id}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                const itemId = event.dataTransfer.getData('text/plain')
                if (!itemId || currentState.resolved) return
                onStateChange((current) => ({
                  ...current,
                  categorizationAssignments: {
                    ...(current.categorizationAssignments || {}),
                    [itemId]: category.id,
                  },
                }))
              }}
              className="min-h-28 rounded-2xl border border-border/70 p-3"
            >
              <button
                type="button"
                className="mb-2 w-full rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
                onClick={() => {
                  if (!selectedItemId || currentState.resolved) return
                  onStateChange((current) => ({
                    ...current,
                    categorizationAssignments: {
                      ...(current.categorizationAssignments || {}),
                      [selectedItemId]: category.id,
                    },
                    selectedCategorizationItemId: null,
                  }))
                }}
              >
                {category.name}
              </button>
              <div className="flex flex-wrap gap-2">
                {items
                  .filter((item) => assignments[item.id] === category.id)
                  .map((item) => (
                    <Badge
                      key={item.id}
                      variant={
                        currentState.resolved && item.category_id !== category.id
                          ? 'destructive'
                          : 'outline'
                      }
                    >
                      {item.text}
                    </Badge>
                  ))}
              </div>
            </div>
          ))}
        </div>
        <Button
          type="button"
          onClick={() =>
            onStateChange((current) => ({
              ...current,
              resolved: true,
              correct: items.every(
                (item) =>
                  (current.categorizationAssignments || {})[item.id] === item.category_id,
              ),
            }))
          }
        >
          提交归类
        </Button>
        {currentState.resolved ? (
          <div className="rounded-2xl border border-border/70 bg-muted/40 px-4 py-3 text-sm">
            正确归类：
            {items
              .map(
                (item) =>
                  `${item.text} → ${
                    categories.find((category) => category.id === item.category_id)?.name ||
                    item.category_id
                  }`,
              )
              .join('；')}
          </div>
        ) : null}
        {renderResolvedFeedback(currentState.resolved ? currentState.correct : undefined, question.analysis, compact)}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <Textarea
        value={currentState.shortAnswerText || ''}
        onChange={(event) =>
          onStateChange((current) => ({
            ...current,
            shortAnswerText: event.target.value,
          }))
        }
        rows={compact ? 4 : 5}
        placeholder="先写下你的答案，再点击提交"
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() => {
            onStateChange((current) => ({
              ...current,
              resolved: true,
              shortAnswerSubmitted: true,
              shortAnswerFeedback: null,
            }))
            onShortAnswerSubmit?.()
          }}
        >
          提交答案
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!currentState.shortAnswerSubmitted || currentState.shortAnswerFeedbackLoading}
          onClick={() => onRequestShortAnswerFeedback?.()}
        >
          {currentState.shortAnswerFeedbackLoading ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          AI点评
        </Button>
      </div>
      {currentState.shortAnswerSubmitted ? (
        <div
          className={cn(
            'border border-border/70 bg-background/70 text-sm',
            compact ? 'rounded-xl px-3 py-3' : 'rounded-2xl px-4 py-4',
          )}
        >
          <div className="font-medium">参考答案</div>
          <div className={cn('whitespace-pre-wrap text-muted-foreground', compact ? 'mt-1.5' : 'mt-2')}>
            {question.answer_payload.reference_answer || '暂无参考答案'}
          </div>
          <div className={cn('font-medium', compact ? 'mt-3' : 'mt-4')}>解析</div>
          <div className={cn('whitespace-pre-wrap text-muted-foreground', compact ? 'mt-1.5' : 'mt-2')}>
            {question.analysis || '暂无解析'}
          </div>
          {currentState.shortAnswerFeedback ? (
            <div
              className={cn(
                'rounded-xl border border-primary/20 bg-primary/5 px-3 py-3',
                compact ? 'mt-3' : 'mt-4',
              )}
            >
              <div className="mb-2 text-sm font-medium">AI点评</div>
              {currentState.shortAnswerFeedback.resolved_ai?.model_label ? (
                <div className="mb-2 text-xs text-muted-foreground">
                  实际模型：{currentState.shortAnswerFeedback.resolved_ai.model_label}
                </div>
              ) : null}
              <div className="whitespace-pre-wrap text-sm text-muted-foreground">
                {currentState.shortAnswerFeedback.feedback_text}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
