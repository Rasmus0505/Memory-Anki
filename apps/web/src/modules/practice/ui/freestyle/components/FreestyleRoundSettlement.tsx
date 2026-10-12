import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { FreestyleOverviewResponse } from '@/shared/api/contracts'
import type { FreestyleRoundCompletion } from '@/modules/practice/ui/freestyle/model/roundCompletion'
import type { FreestyleSaveOutcome } from '@/modules/practice/ui/freestyle/model/freestyleSettlementModel'
import { settlementQuizClearCopy } from '@/modules/practice/ui/freestyle/model/overlayQuizClearance'
import { FreestyleSaveStatus } from './FreestyleSaveStatus'
import { cn } from '@/shared/lib/utils'

type QuizChoice = 'pending' | 'confirming' | 'clearing' | 'cleared' | 'kept'

const NEXT_REVIEW_PREVIEW = 5

function subjectKey(subjectId: number | null, subjectName: string) {
  return subjectId == null ? `name:${subjectName}` : `id:${subjectId}`
}

function percent(done: number, total: number) {
  if (total <= 0) return 0
  return Math.min(100, Math.round((done / total) * 100))
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-stage-line">
      <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${value}%` }} />
    </div>
  )
}

/**
 * Closing slot of a 随心 round. It reports what was done and offers the two
 * next actions: clear 做题 progress, or open the config for the next round.
 */
export function FreestyleRoundSettlement({
  completion,
  roundKey,
  quizPalaceCount,
  onClearQuizProgress,
  onAnotherRound,
  onCancelSettlement,
  dueTomorrowCount,
  saveOutcome,
  onRetrySave,
  remainingBefore,
  remainingAfter,
  nextReviews,
  onFinishStudy,
  onAddDueToday,
}: {
  completion: FreestyleRoundCompletion
  roundKey: string
  quizPalaceCount: number
  onClearQuizProgress: () => Promise<void>
  onAnotherRound: () => void
  onCancelSettlement: () => void
  dueTomorrowCount?: number | null
  saveOutcome?: FreestyleSaveOutcome
  onRetrySave?: () => void
  remainingBefore?: number | null
  remainingAfter?: number | null
  nextReviews?: FreestyleOverviewResponse['next_reviews']
  /** Finish this visit only; never marks the underlying round or its units passed. */
  onFinishStudy?: () => void
  onAddDueToday?: () => void
}) {
  const subjects = useMemo(() => completion.bySubject, [completion.bySubject])
  const palaceTotal = subjects.reduce((sum, subject) => sum + subject.palaceCount, 0)
  const [quizChoice, setQuizChoice] = useState<QuizChoice>('pending')
  const [quizError, setQuizError] = useState('')
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => (
    subjects[0] ? new Set([subjectKey(subjects[0].subjectId, subjects[0].subjectName)]) : new Set()
  ))
  const clearOwnerRef = useRef({ roundKey, operation: 0 })
  if (clearOwnerRef.current.roundKey !== roundKey) clearOwnerRef.current = { roundKey, operation: 0 }
  useEffect(() => () => { clearOwnerRef.current.operation += 1 }, [])
  useEffect(() => {
    setQuizChoice('pending')
    setQuizError('')
  }, [roundKey])

  const quizResolved = quizPalaceCount === 0 || quizChoice === 'kept' || quizChoice === 'cleared'
  const overall = percent(completion.ratedCount, completion.totalUnits)

  const toggleSubject = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const runClear = () => {
    setQuizError('')
    setQuizChoice('clearing')
    const owner = clearOwnerRef.current
    const operation = ++owner.operation
    const stillCurrent = () => clearOwnerRef.current === owner && owner.operation === operation
    void onClearQuizProgress()
      .then(() => { if (stillCurrent()) setQuizChoice('cleared') })
      .catch((error: unknown) => {
        if (!stillCurrent()) return
        setQuizChoice('pending')
        setQuizError(error instanceof Error ? error.message : '清空做题进度失败。')
      })
  }

  return (
    <div data-testid="freestyle-round-complete" className="mx-auto flex w-full max-w-2xl flex-col px-1 py-4">
      <div className="relative rounded-[1.75rem] border border-stage-line-strong bg-stage-raised/95 p-5 text-stage-ink shadow-[0_24px_80px_-16px_rgb(0_0_0/0.7)] sm:p-7">
        <button
          type="button"
          data-testid="freestyle-round-cancel-settlement"
          className="mb-4 flex w-full items-center justify-center rounded-2xl border border-stage-line-strong px-4 py-3 text-sm font-medium text-stage-ink hover:bg-stage-ink/8"
          onClick={onCancelSettlement}
        >
          返回上一张
        </button>

        <div className="text-xs font-semibold tracking-[0.18em] text-stage-glow">本轮完成</div>
        <p data-testid="freestyle-round-summary" className="mt-2 text-lg font-semibold leading-snug sm:text-xl">
          新学 {completion.newCount} · 复习 {completion.reviewCount} · {palaceTotal} 个宫殿 · {completion.involvedUnitCount} 个单元
        </p>

        <div className="mt-5">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span>总进度</span>
            <span className="tabular-nums text-stage-muted">
              {completion.ratedCount} / {completion.totalUnits} 单元 · {overall}%
            </span>
          </div>
          <div className="mt-2">
            <ProgressBar value={overall} />
          </div>
        </div>

        <ul data-testid="freestyle-round-complete-subjects" className="mt-5 space-y-2">
          {subjects.map((subject) => {
            const key = subjectKey(subject.subjectId, subject.subjectName)
            const open = expanded.has(key)
            return (
              <li key={key} className="overflow-hidden rounded-2xl border border-stage-line bg-stage/40">
                <button
                  type="button"
                  data-testid="freestyle-round-complete-subject"
                  aria-expanded={open}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
                  onClick={() => toggleSubject(key)}
                >
                  <ChevronDown
                    className={cn('size-4 shrink-0 text-stage-muted transition-transform duration-300', open ? 'rotate-0' : '-rotate-90')}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">{subject.subjectName}</span>
                  <span className="shrink-0 text-xs tabular-nums text-stage-muted">
                    {subject.cardCount} / {subject.totalUnits} · {percent(subject.cardCount, subject.totalUnits)}%
                  </span>
                </button>
                {open ? (
                  <ul className="space-y-1 border-t border-stage-line px-3 py-2">
                    {subject.palaces.map((palace) => (
                      <li
                        key={palace.palaceId}
                        data-testid="freestyle-round-complete-palace"
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span className="min-w-0 truncate">{palace.palaceTitle}</span>
                        <span className="shrink-0 text-xs tabular-nums text-stage-muted">
                          {palace.cardCount} / {palace.totalUnits} · {percent(palace.cardCount, palace.totalUnits)}%
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            )
          })}
        </ul>

        <div className="mt-5 flex flex-col items-center gap-1 text-center text-xs leading-5 text-stage-muted">
          {saveOutcome ? <FreestyleSaveStatus outcome={saveOutcome} onRetry={onRetrySave} /> : null}
          <p data-testid="freestyle-round-status">
            {completion.remainingCandidates > 0 ? `还剩 ${completion.remainingCandidates} 项待下一轮` : '本轮已全部完成'}
            {typeof remainingBefore === 'number' && typeof remainingAfter === 'number'
              ? ` · 今日还剩 ${remainingBefore} → ${remainingAfter} 项`
              : ''}
            {typeof dueTomorrowCount === 'number' ? ` · 明天 ${dueTomorrowCount} 项要复习` : ''}
          </p>
        </div>

        {nextReviews ? (
          <section data-testid="freestyle-round-next-reviews" className="mt-5 flex flex-col gap-2">
            <h3 className="text-xs text-stage-muted">下次复习</h3>
            {nextReviews.length === 0 ? (
              <p className="text-sm text-stage-muted">暂无已安排的复习</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {nextReviews.slice(0, NEXT_REVIEW_PREVIEW).map((item) => (
                  <li key={item.unit_id} className="flex justify-between gap-3">
                    <span className="truncate">{item.name || item.palace_name}</span>
                    <span className="shrink-0 tabular-nums text-stage-muted">{item.due_date}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {quizChoice === 'cleared' ? (
          <p className="mt-3 text-center text-xs text-stage-muted">已清空做题进度，学习历史和复习安排保持不变。</p>
        ) : null}
        {quizChoice === 'kept' ? (
          <p className="mt-3 text-center text-xs text-stage-muted">已保留做题进度。</p>
        ) : null}
        {quizChoice === 'confirming' ? (
          <div data-testid="freestyle-round-quiz-confirm" className="mt-4 rounded-2xl border border-stage-line bg-stage/40 px-4 py-3">
            <p className="text-sm leading-6">{settlementQuizClearCopy(quizPalaceCount)}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                data-testid="freestyle-round-quiz-cancel"
                className="rounded-xl border border-stage-line-strong px-3 py-2 text-sm font-medium text-stage-ink hover:bg-stage-ink/8"
                onClick={() => setQuizChoice('pending')}
              >
                取消
              </button>
              <button
                type="button"
                data-testid="freestyle-round-quiz-clear-confirm"
                className="rounded-xl bg-rate-again/90 px-3 py-2 text-sm font-semibold text-stage hover:bg-rate-again"
                onClick={runClear}
              >
                确认清空
              </button>
            </div>
          </div>
        ) : null}
        {quizError ? <p className="mt-2 text-center text-xs text-rate-again">{quizError}</p> : null}

        <div className={cn('mt-5 gap-3', quizPalaceCount > 0 ? 'grid grid-cols-2' : 'flex')}>
          {quizPalaceCount > 0 ? (
            <button
              type="button"
              data-testid="freestyle-round-quiz-clear"
              className="flex items-center justify-center rounded-2xl border border-stage-line-strong px-4 py-3 text-sm font-medium text-stage-ink hover:bg-stage-ink/8 disabled:opacity-50"
              disabled={quizChoice === 'clearing' || quizChoice === 'cleared' || quizChoice === 'confirming'}
              onClick={() => {
                setQuizError('')
                setQuizChoice('confirming')
              }}
            >
              {quizChoice === 'clearing' ? '正在清空…' : quizChoice === 'cleared' ? '已清空' : '清空做题进度'}
            </button>
          ) : null}
          <button
            type="button"
            data-testid="freestyle-round-another"
            className="flex items-center justify-center rounded-2xl bg-gradient-to-r from-primary to-primary-strong px-4 py-3 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50"
            disabled={!quizResolved}
            onClick={onAnotherRound}
          >
            开启下一轮
          </button>
        </div>
        {quizPalaceCount > 0 && quizChoice === 'pending' ? (
          <button
            type="button"
            data-testid="freestyle-round-quiz-keep"
            className="mt-3 w-full text-center text-xs text-stage-muted underline-offset-2 hover:underline"
            onClick={() => setQuizChoice('kept')}
          >
            保留做题进度，不清空
          </button>
        ) : null}
        {onFinishStudy ? (
          <button
            type="button"
            data-testid="freestyle-study-finish-confirm"
            className="mt-3 w-full rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            disabled={!quizResolved}
            onClick={onFinishStudy}
          >
            结束并保留本轮
          </button>
        ) : null}
        {onAddDueToday ? (
          <button
            type="button"
            className="mt-2 w-full rounded-2xl border border-stage-line-strong px-4 py-3 text-sm"
            onClick={onAddDueToday}
          >
            加入今天到期内容，继续本轮
          </button>
        ) : null}
        {onFinishStudy && !quizResolved ? (
          <p className="mt-2 text-center text-xs text-stage-muted">结束前请选择保留或清除做题已完成状态。</p>
        ) : null}
      </div>
    </div>
  )
}
