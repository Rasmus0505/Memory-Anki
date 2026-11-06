import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ChevronDown, Sparkles, Trophy } from 'lucide-react'
import type { FreestyleOverviewResponse } from '@/shared/api/contracts'
import type { FreestyleRoundCompletion } from '@/modules/practice/ui/freestyle/model/roundCompletion'
import type { FreestyleSaveOutcome } from '@/modules/practice/ui/freestyle/model/freestyleSettlementModel'
import { settlementQuizClearCopy } from '@/modules/practice/ui/freestyle/model/overlayQuizClearance'
import { formatPalaceUnit } from '@/modules/practice/ui/freestyle/model/formatPalaceUnit'
import { usePrefersReducedMotion } from '@/modules/practice/ui/freestyle/hooks/usePrefersReducedMotion'
import {
  skipRoundCelebration,
  useCountUp,
  useRoundCompleteCelebration,
} from '@/modules/practice/ui/freestyle/components/freestyleRoundCelebration'
import { FreestyleSaveStatus } from './FreestyleSaveStatus'
import { FX_ANCHORS } from '@/shared/fx'
import { cn } from '@/shared/lib/utils'

const RING_RADIUS = 44
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS
const NEXT_REVIEW_PREVIEW = 6

function subjectKey(subjectId: number | null, subjectName: string) {
  return subjectId == null ? `name:${subjectName}` : `id:${subjectId}`
}

function percent(done: number, total: number) {
  if (total <= 0) return 0
  return Math.min(100, Math.round((done / total) * 100))
}

// Progress fills are neutral on purpose: colour semantics live on the type/状态 channels, not on the bars.
const PROGRESS_FILL = 'var(--color-stage-muted)'

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-stage-line">
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${value}%`, backgroundColor: PROGRESS_FILL }}
      />
    </div>
  )
}

function Rise({ index, className, children }: { index: number; className?: string; children: ReactNode }) {
  return (
    <div className={cn('fs-rise', className)} style={{ '--fs-i': index } as CSSProperties}>
      {children}
    </div>
  )
}

/** The trophy ring is the achievement anchor: this round's own completion, not palace mastery. */
function TrophyRing({
  ratio,
  reducedMotion,
  gradientId,
}: {
  ratio: number
  reducedMotion: boolean
  gradientId: string
}) {
  const offset = RING_CIRCUMFERENCE * (1 - Math.max(0, Math.min(1, ratio)))
  return (
    <div className="relative mx-auto size-24 sm:size-28" aria-hidden>
      <div className="fs-halo absolute inset-[-18%] rounded-full" />
      <svg viewBox="0 0 100 100" className="relative size-full -rotate-90">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--color-stage-glow)" />
            <stop offset="100%" stopColor="var(--color-rate-good)" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r={RING_RADIUS} fill="none" stroke="var(--color-stage-line)" strokeWidth="7" />
        <circle
          className={reducedMotion ? undefined : 'fs-ring-draw'}
          cx="50"
          cy="50"
          r={RING_RADIUS}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          style={{ '--fs-ring-from': RING_CIRCUMFERENCE, strokeDashoffset: offset } as CSSProperties}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="fs-trophy-pop flex size-12 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-strong text-primary-foreground shadow-glow sm:size-14">
          <Trophy className="size-6 sm:size-7" strokeWidth={2.2} />
        </div>
      </div>
    </div>
  )
}

function StatTile({
  value,
  label,
  toneClass,
  index,
  reducedMotion,
}: {
  value: number
  label: string
  toneClass: string
  index: number
  reducedMotion: boolean
}) {
  const shown = useCountUp(value, { delayMs: 220 + index * 90, disabled: reducedMotion })
  return (
    <Rise index={index + 2} className="rounded-2xl border border-stage-line bg-stage-raised/70 px-2 py-2.5 text-center">
      <div className={cn('text-xl font-bold tabular-nums sm:text-2xl', toneClass)}>{shown}</div>
      <div className="mt-0.5 text-[11px] text-stage-muted">{label}</div>
    </Rise>
  )
}

type ClearState = 'idle' | 'armed' | 'clearing' | 'cleared'

export interface FreestyleSettlementMeta {
  saveOutcome?: FreestyleSaveOutcome
  onRetrySave?: () => void
  remainingBefore?: number | null
  remainingAfter?: number | null
  remainingPalaces?: number | null
  remainingUnits?: number | null
  nextReviews?: FreestyleOverviewResponse['next_reviews']
}

/**
 * Closing page of a 随心 round: one card that celebrates what was done and
 * offers exactly two moves — clear quiz progress, or settle and go on.
 *
 * Achievement is the only design brief: the hero is the count the learner
 * earned, the ring measures this round (finished = full), and every leftover
 * number stays on one muted status line instead of a headline. Details sit
 * below the actions so 结算 never hides under a long list.
 */
export function FreestyleRoundSettlement({
  completion,
  roundKey,
  quizPalaceCount,
  onClearQuizProgress,
  onSettle,
  onCancelSettlement,
  dueTomorrowCount,
  saveOutcome,
  onRetrySave,
  remainingBefore,
  remainingAfter,
  remainingPalaces,
  remainingUnits,
  nextReviews,
  cancelLabel = '返回上一张',
  showCancel = true,
  settleLabel = '结算',
}: {
  completion: FreestyleRoundCompletion
  roundKey: string
  quizPalaceCount: number
  onClearQuizProgress: () => Promise<void>
  /** Settle this round and go on. Always available, whatever the quiz choice. */
  onSettle: () => void
  onCancelSettlement: () => void
  dueTomorrowCount?: number | null
  saveOutcome?: FreestyleSaveOutcome
  onRetrySave?: () => void
  remainingBefore?: number | null
  remainingAfter?: number | null
  /** Palaces and 复习单元 still waiting for the next round (server overview). */
  remainingPalaces?: number | null
  remainingUnits?: number | null
  nextReviews?: FreestyleOverviewResponse['next_reviews']
  cancelLabel?: string
  /** False when the settled feed has no card to return to. */
  showCancel?: boolean
  settleLabel?: string
}) {
  const reducedMotion = usePrefersReducedMotion()
  const subjects = useMemo(() => completion.bySubject, [completion.bySubject])
  const palaceTotal = subjects.reduce((sum, subject) => sum + subject.palaceCount, 0)
  const clearedPalaces = useMemo(() => (
    subjects
      .flatMap((subject) => subject.palaces)
      .filter((palace) => palace.totalUnits > 0 && palace.cardCount >= palace.totalUnits).length
  ), [subjects])
  const [clearState, setClearState] = useState<ClearState>('idle')
  const [clearError, setClearError] = useState('')
  const [nextReviewsExpanded, setNextReviewsExpanded] = useState(false)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => (
    subjects[0] ? new Set([subjectKey(subjects[0].subjectId, subjects[0].subjectName)]) : new Set()
  ))
  const clearOwnerRef = useRef({ roundKey, operation: 0 })
  if (clearOwnerRef.current.roundKey !== roundKey) clearOwnerRef.current = { roundKey, operation: 0 }
  useEffect(() => () => { clearOwnerRef.current.operation += 1 }, [])
  useEffect(() => {
    setClearState('idle')
    setClearError('')
  }, [roundKey])

  // Sound + haptics + the screen stamp, once per round. Any tap skips it.
  useRoundCompleteCelebration(roundKey, reducedMotion)

  const ratedShown = useCountUp(completion.ratedCount, { durationMs: 1100, delayMs: 160, disabled: reducedMotion })
  const roundRatio = completion.involvedUnitCount > 0
    ? completion.ratedCount / Math.max(completion.ratedCount, completion.involvedUnitCount)
    : 0
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
    setClearError('')
    setClearState('clearing')
    const owner = clearOwnerRef.current
    const operation = ++owner.operation
    const stillCurrent = () => clearOwnerRef.current === owner && owner.operation === operation
    void onClearQuizProgress()
      .then(() => { if (stillCurrent()) setClearState('cleared') })
      .catch((error: unknown) => {
        if (!stillCurrent()) return
        setClearState('idle')
        setClearError(error instanceof Error ? error.message : '清空做题进度失败。')
      })
  }

  const clearLabel = clearState === 'clearing'
    ? '正在清空…'
    : clearState === 'cleared'
      ? '已清空做题进度'
      : clearState === 'armed'
        ? '再点确认清空'
        : '清空做题进度'

  const statusText = [
    remainingUnits != null && remainingPalaces != null
      ? (remainingUnits > 0 ? `还剩 ${formatPalaceUnit(remainingPalaces, remainingUnits)} 待下一轮` : '本轮已全部完成')
      : (completion.remainingCandidates > 0 ? `还剩 ${completion.remainingCandidates} 项待下一轮` : '本轮已全部完成'),
    typeof remainingBefore === 'number' && typeof remainingAfter === 'number'
      ? `今日还剩 ${remainingBefore} → ${remainingAfter} 复习单元`
      : '',
    typeof dueTomorrowCount === 'number' ? `明天 ${dueTomorrowCount} 个复习单元要复习` : '',
  ].filter(Boolean).join(' · ')

  return (
    <div
      data-testid="freestyle-round-complete"
      data-fx-anchor={FX_ANCHORS.roundSummary}
      className="mx-auto flex w-full max-w-2xl shrink-0 flex-col px-1 py-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))]"
    >
      <div className="fs-complete-panel relative overflow-hidden rounded-[1.75rem] border border-stage-line-strong bg-stage-raised/95 p-5 text-stage-ink shadow-[0_24px_80px_-16px_rgb(0_0_0/0.7)] sm:p-7">
        {showCancel ? (
          <button
            type="button"
            data-testid="freestyle-round-cancel-settlement"
            className="ma-pressable mb-4 flex w-full items-center justify-center rounded-2xl border border-stage-line-strong px-4 py-3 text-sm font-medium text-stage-ink hover:bg-stage-ink/8"
            onClick={onCancelSettlement}
          >
            {cancelLabel}
          </button>
        ) : null}

        <Rise index={0} className="text-center">
          <TrophyRing ratio={roundRatio} reducedMotion={reducedMotion} gradientId="fs-ring-gradient-round" />
          <div className="mt-3 flex items-center justify-center gap-3">
            <div className="text-xs font-semibold tracking-[0.18em] text-stage-glow">本轮完成</div>
            <button
              type="button"
              data-testid="freestyle-round-skip-show"
              className="text-[11px] font-medium text-stage-muted underline-offset-2 hover:underline"
              onClick={() => skipRoundCelebration(roundKey)}
            >
              跳过
            </button>
          </div>
          <h2 className="mt-1 text-3xl font-semibold leading-tight sm:text-4xl">
            <span className="tabular-nums">{ratedShown}</span>
            <span className="ml-1 text-lg font-medium text-stage-muted sm:text-xl">个单元</span>
          </h2>
          <p data-testid="freestyle-round-summary" className="mt-1.5 text-sm text-stage-muted">
            新学 {completion.newCount} · 复习 {completion.reviewCount} · {palaceTotal} 个宫殿 · {completion.involvedUnitCount} 个单元
          </p>
          {clearedPalaces > 0 ? (
            <p
              data-testid="freestyle-round-cleared-palaces"
              className="mx-auto mt-3 inline-flex items-center gap-1.5 rounded-full border border-rate-good/35 bg-rate-good/12 px-3 py-1 text-xs font-medium text-rate-good"
            >
              <Sparkles className="size-3.5" aria-hidden />
              {clearedPalaces} 个宫殿今日已清
            </p>
          ) : null}
        </Rise>

        <div className="mt-5 grid grid-cols-3 gap-2 sm:gap-3">
          <StatTile value={completion.passedCount} label="已通过" toneClass="text-rate-good" index={0} reducedMotion={reducedMotion} />
          <StatTile value={completion.newCount} label="新学" toneClass="text-stage-glow" index={1} reducedMotion={reducedMotion} />
          <StatTile value={completion.retryCount} label="重练" toneClass="text-rate-hard" index={2} reducedMotion={reducedMotion} />
        </div>

        <Rise index={5} className="mt-4">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span>宫殿总进度</span>
            <span className="tabular-nums text-stage-muted">
              {completion.ratedCount} / {completion.totalUnits} 单元 · {overall}%
            </span>
          </div>
          <div className="mt-2">
            <ProgressBar value={overall} />
          </div>
        </Rise>

        <Rise index={6} className="mt-4 flex flex-col items-center gap-1 text-center text-xs leading-5 text-stage-muted">
          {saveOutcome ? <FreestyleSaveStatus outcome={saveOutcome} onRetry={onRetrySave} /> : null}
          <p data-testid="freestyle-round-status">{statusText}</p>
        </Rise>

        {quizPalaceCount > 0 && clearState !== 'cleared' ? (
          <p className="mt-3 text-center text-[11px] leading-5 text-stage-muted">
            {settlementQuizClearCopy(quizPalaceCount)}
          </p>
        ) : null}
        {clearState === 'cleared' ? (
          <p className="mt-3 text-center text-[11px] leading-5 text-stage-muted">已清空做题进度，学习历史和复习安排保持不变。</p>
        ) : null}
        {clearError ? <p className="mt-2 text-center text-xs text-rate-again">{clearError}</p> : null}

        {/* Exactly two moves: keep progress (the default) or clear it, then settle. */}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:gap-3">
          {quizPalaceCount > 0 ? (
            <button
              type="button"
              data-testid="freestyle-round-quiz-clear"
              data-state={clearState}
              className={cn(
                'ma-pressable flex min-h-12 items-center justify-center rounded-2xl border px-3 py-3 text-sm font-medium transition-colors',
                clearState === 'armed'
                  ? 'border-rate-again/60 bg-rate-again/15 text-rate-again'
                  : 'border-stage-line-strong text-stage-ink hover:bg-stage-ink/8',
                (clearState === 'clearing' || clearState === 'cleared') && 'opacity-60',
              )}
              disabled={clearState === 'clearing' || clearState === 'cleared'}
              onClick={() => {
                if (clearState === 'idle') {
                  setClearState('armed')
                  return
                }
                if (clearState === 'armed') runClear()
              }}
            >
              {clearLabel}
            </button>
          ) : null}
          <button
            type="button"
            data-testid="freestyle-round-settle"
            className={cn(
              'ma-pressable fs-cta-shine relative flex min-h-12 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-r from-primary to-primary-strong px-4 py-3 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110',
              quizPalaceCount > 0 ? 'col-span-1' : 'col-span-2',
            )}
            onClick={onSettle}
          >
            {settleLabel}
          </button>
        </div>

        {subjects.length > 0 ? (
          <Rise index={7}>
            <details className="mt-3 rounded-2xl border border-stage-line bg-stage/40 px-4 py-3">
              <summary className="cursor-pointer text-sm font-medium text-stage-ink">
                按学科看明细（{subjects.length}）
              </summary>
              <ul data-testid="freestyle-round-complete-subjects" className="mt-3 max-h-[min(40dvh,18rem)] space-y-2 overflow-y-auto pr-0.5">
                {subjects.map((subject) => {
                  const key = subjectKey(subject.subjectId, subject.subjectName)
                  const open = expanded.has(key)
                  return (
                    <li key={key} className="overflow-hidden rounded-2xl border border-stage-line bg-stage/40">
                      <button
                        type="button"
                        data-testid="freestyle-round-complete-subject"
                        aria-expanded={open}
                        className="flex w-full flex-col gap-1 px-3 py-2.5 text-left"
                        onClick={() => toggleSubject(key)}
                      >
                        <span className="flex w-full items-center gap-2">
                          <ChevronDown
                            className={cn('size-4 shrink-0 text-stage-muted transition-transform duration-300', open ? 'rotate-0' : '-rotate-90')}
                          />
                          <span className="min-w-0 flex-1 truncate font-medium">{subject.subjectName}</span>
                          <span className="shrink-0 text-xs tabular-nums text-stage-muted">
                            {subject.cardCount} / {subject.totalUnits} · {percent(subject.cardCount, subject.totalUnits)}%
                          </span>
                        </span>
                        <ProgressBar value={percent(subject.cardCount, subject.totalUnits)} />
                      </button>
                      {open ? (
                        <ul className="space-y-1 border-t border-stage-line px-3 py-2">
                          {subject.palaces.map((palace) => {
                            const palacePercent = percent(palace.cardCount, palace.totalUnits)
                            return (
                              <li
                                key={palace.palaceId}
                                data-testid="freestyle-round-complete-palace"
                                className="flex items-center justify-between gap-2 text-sm"
                              >
                                <span className="min-w-0 truncate">{palace.palaceTitle}</span>
                                <span className="shrink-0 text-xs tabular-nums text-stage-muted">
                                  {palace.cardCount} / {palace.totalUnits} · {palacePercent}%
                                </span>
                              </li>
                            )
                          })}
                        </ul>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </details>
          </Rise>
        ) : null}

        {nextReviews ? (
          nextReviews.length === 0 ? (
            <p data-testid="freestyle-round-next-reviews" className="mt-3 text-sm text-stage-muted">暂无已安排的复习</p>
          ) : (
            <details data-testid="freestyle-round-next-reviews" className="mt-3 rounded-2xl border border-stage-line bg-stage/40 px-4 py-3">
              <summary className="cursor-pointer text-sm font-medium text-stage-ink">
                下次复习（{nextReviews.length}）
              </summary>
              <ul className="mt-3 flex flex-col gap-1 text-sm">
                {(nextReviewsExpanded ? nextReviews : nextReviews.slice(0, NEXT_REVIEW_PREVIEW)).map((item) => (
                  <li key={item.unit_id} className="flex justify-between gap-3">
                    <span className="truncate">{item.name || item.palace_name}</span>
                    <span className="shrink-0 tabular-nums text-stage-muted">{item.due_date}</span>
                  </li>
                ))}
              </ul>
              {nextReviews.length > NEXT_REVIEW_PREVIEW ? (
                <button
                  type="button"
                  aria-expanded={nextReviewsExpanded}
                  className="mt-2 text-xs text-stage-muted underline-offset-2 hover:underline"
                  onClick={() => setNextReviewsExpanded((value) => !value)}
                >
                  {nextReviewsExpanded ? '收起' : `展开全部 ${nextReviews.length} 项`}
                </button>
              ) : null}
            </details>
          )
        ) : null}
      </div>
    </div>
  )
}
