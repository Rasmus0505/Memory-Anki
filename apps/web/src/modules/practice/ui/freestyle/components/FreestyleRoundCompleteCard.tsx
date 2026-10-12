import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ChevronDown, Trophy } from 'lucide-react'
import type { FreestylePartialSettlementSnapshot } from '@/modules/practice/domain/partialSettlement'
import type { FreestyleRoundCompletion } from '@/modules/practice/ui/freestyle/model/roundCompletion'
import { settlementQuizClearCopy } from '@/modules/practice/ui/freestyle/model/overlayQuizClearance'
import { usePrefersReducedMotion } from '@/modules/practice/ui/freestyle/hooks/usePrefersReducedMotion'
import {
  skipRoundCelebration,
  useCountUp,
  useRoundCompleteCelebration,
} from '@/modules/practice/ui/freestyle/components/freestyleRoundCelebration'
import { cn } from '@/shared/lib/utils'

type QuizClearChoice = 'pending' | 'kept' | 'clearing' | 'cleared'

const RING_RADIUS = 44
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

function subjectKey(subjectId: number | null, subjectName: string) {
  return subjectId == null ? `name:${subjectName}` : `id:${subjectId}`
}

function Rise({ index, className, children }: { index: number; className?: string; children: ReactNode }) {
  return (
    <div className={cn('fs-rise', className)} style={{ '--fs-i': index } as CSSProperties}>
      {children}
    </div>
  )
}

function PassRing({
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
    <div className="relative mx-auto size-28 sm:size-32" aria-hidden>
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
        <div className="fs-trophy-pop flex size-14 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-strong text-primary-foreground shadow-glow sm:size-16">
          <Trophy className="size-7 sm:size-8" strokeWidth={2.2} />
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
  const shown = useCountUp(value, { delayMs: 260 + index * 90, disabled: reducedMotion })
  return (
    <Rise index={index + 3} className="rounded-2xl border border-stage-line bg-stage-raised/70 px-3 py-3 text-center">
      <div className={cn('text-2xl font-bold tabular-nums sm:text-3xl', toneClass)}>{shown}</div>
      <div className="mt-1 text-[11px] text-stage-muted sm:text-xs">{label}</div>
    </Rise>
  )
}

/**
 * Closing slot of a 随心 round for the 小结算 batch and the 结束本次学习 pause.
 * The round-complete summary lives in FreestyleRoundSettlement.
 */
export function FreestyleRoundCompleteCard({
  completion,
  roundKey,
  quizPalaceCount,
  onClearQuizProgress,
  onCancelSettlement,
  variant,
  partialSettlements = [],
  onConfirmPartial,
  onFinishStudy,
  onAddDueToday,
  unscoredCount,
}: {
  completion: FreestyleRoundCompletion
  roundKey: string
  quizPalaceCount: number
  onClearQuizProgress: () => Promise<void>
  /** Leave this slot and return to the previous card. */
  onCancelSettlement: () => void
  /** 小结算 confirms a finished batch. 结束本次学习 pauses the round without passing it. */
  variant: 'partial' | 'study'
  partialSettlements?: readonly FreestylePartialSettlementSnapshot[]
  onConfirmPartial?: () => void
  /** Finish this visit only; never marks the underlying round or its units passed. */
  onFinishStudy?: () => void
  onAddDueToday?: () => void
  /** Occurrence-local pending count, from the existing queue scoring projection. */
  unscoredCount?: number
}) {
  const reducedMotion = usePrefersReducedMotion()
  const subjects = useMemo(() => completion.bySubject ?? [], [completion.bySubject])
  const [quizChoice, setQuizChoice] = useState<QuizClearChoice>('pending')
  const [quizClearError, setQuizClearError] = useState('')
  const clearOwnerRef = useRef({ roundKey, operation: 0 })
  if (clearOwnerRef.current.roundKey !== roundKey) clearOwnerRef.current = { roundKey, operation: 0 }
  useEffect(() => () => { clearOwnerRef.current.operation += 1 }, [])
  useEffect(() => {
    setQuizChoice('pending')
    setQuizClearError('')
  }, [roundKey])
  useRoundCompleteCelebration(roundKey, reducedMotion, variant !== 'study')
  const partial = variant === 'partial'
  const study = variant === 'study'
  const quizChoiceResolved = quizPalaceCount === 0 || quizChoice === 'kept' || quizChoice === 'cleared'
  const ratedShown = useCountUp(completion.ratedCount, { durationMs: 1100, delayMs: 180, disabled: reducedMotion })
  const passRatio = completion.ratedCount > 0 ? completion.passedCount / completion.ratedCount : 0
  const firstKey = subjects[0]
    ? subjectKey(subjects[0].subjectId, subjects[0].subjectName)
    : null
  const [expandedKey, setExpandedKey] = useState<string | null>(firstKey)
  const openKey = useMemo(() => {
    if (expandedKey && subjects.some((item) => subjectKey(item.subjectId, item.subjectName) === expandedKey)) {
      return expandedKey
    }
    return firstKey
  }, [expandedKey, firstKey, subjects])

  return (
    <div
      data-testid={partial ? 'freestyle-partial-settlement-card' : 'freestyle-round-complete'}
      className={cn(
        'mx-auto flex w-full max-w-2xl shrink-0 flex-col px-1 py-4',
        // Both settlement variants can be taller than a phone viewport. Keep the
        // card at its content height so its owner scrollport can reach the actions;
        // h-full + justify-center would center overflow outside that scrollport.
        'h-auto justify-start pb-[max(1rem,env(safe-area-inset-bottom,0px))]',
      )}
    >
      <div className="fs-complete-panel relative overflow-hidden rounded-[1.75rem] border border-stage-line-strong bg-stage-raised/95 p-5 text-stage-ink shadow-[0_24px_80px_-16px_rgb(0_0_0/0.7)] sm:p-7">
        <button
          type="button"
          data-testid="freestyle-round-cancel-settlement"
          className="ma-pressable mb-4 flex w-full items-center justify-center rounded-2xl border border-stage-line-strong px-4 py-3 text-sm font-medium text-stage-ink hover:bg-stage-ink/8"
          onClick={onCancelSettlement}
        >
          {partial ? '取消结算' : '继续本轮学习'}
        </button>
        <Rise index={0} className="text-center">
          {!study ? (
            <PassRing
              ratio={passRatio}
              reducedMotion={reducedMotion}
              gradientId={partial ? 'fs-ring-gradient-partial' : 'fs-ring-gradient'}
            />
          ) : null}
          <div className="mt-3 flex items-center justify-center gap-3">
            <div className="text-xs font-semibold tracking-[0.18em] text-stage-glow">
              {partial ? '小结算' : '结束本次学习'}
            </div>
            <button
              type="button"
              data-testid="freestyle-round-skip-show"
              className="text-[11px] font-medium text-stage-muted underline-offset-2 hover:underline"
              onClick={() => skipRoundCelebration(roundKey)}
            >
              跳过
            </button>
          </div>
          <h2 className="mt-1.5 text-2xl font-semibold leading-tight sm:text-3xl">
            <span className="tabular-nums">{ratedShown}</span> 张已评分
          </h2>
        </Rise>

        <div className="mt-5 grid grid-cols-3 gap-2 sm:gap-3">
          <StatTile value={completion.passedCount} label="已通过" toneClass="text-rate-good" index={0} reducedMotion={reducedMotion} />
          <StatTile
            value={completion.retryCount}
            label="经历过重练"
            toneClass="text-rate-hard"
            index={1}
            reducedMotion={reducedMotion}
          />
          <StatTile value={completion.quizCount} label="做题卡片" toneClass="text-stage-ink" index={2} reducedMotion={reducedMotion} />
        </div>
        <p className="mt-2 text-center text-[11px] leading-5 text-stage-muted">
          已评分含通过与重练；“经历过重练”表示本轮曾需重练，不代表仍有待办。
        </p>

        {!partial && unscoredCount != null ? (
          <p data-testid="freestyle-study-pending-counts" className="mt-3 text-center text-sm text-stage-ink">
            待评分 {unscoredCount} 次（含重练） · 已评分未通过 {Math.max(0, completion.ratedCount - completion.passedCount)} 个学习内容
          </p>
        ) : null}
        {!partial ? (
          <p data-testid="freestyle-study-resume-note" className="mt-3 text-center text-sm leading-6 text-stage-ink">
            结束本次学习不等于全部通过。未评分和未通过的内容会保留在同一轮，下次继续；不会补记通过或重置复习安排。
          </p>
        ) : null}

        {!partial && partialSettlements.length ? (
          <Rise index={7}>
            <details className="mt-4 rounded-2xl border border-stage-line bg-stage/40 px-4 py-3">
              <summary className="cursor-pointer text-sm font-medium text-stage-ink">提前结算记录（已计入上方总数）</summary>
                <div data-testid="freestyle-round-partial-settlements" className="mt-3 space-y-3">
                <p className="text-xs leading-5 text-stage-muted">提前完成的单元已包含在本轮总数中，不要重复相加。</p>
              <ul className="mt-3 space-y-3">
                {partialSettlements.map((item, index) => (
                  <li key={item.id} className="rounded-xl border border-stage-line bg-stage-raised/50 px-3 py-2">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="font-medium">第 {index + 1} 次 · {item.cardCount} 张</span>
                    </div>
                    <div className="mt-1 text-xs leading-5 text-stage-muted">
                      已评分 {item.ratedCount} · 已通过 {item.passedCount}
                      {item.retryCount ? ` · 重练 ${item.retryCount}` : ''}
                      {item.quizCount ? ` · 题目 ${item.quizCount}` : ''}
                    </div>
                    {item.bySubject.length ? (
                      <div className="mt-1 text-xs leading-5 text-stage-muted">
                        {item.bySubject.map((subject) => (
                          `${subject.subjectName} ${subject.cardCount} 张`
                        )).join(' · ')}
                      </div>
                    ) : null}
                  </li>
                ))}
                </ul>
              </div>
            </details>
          </Rise>
        ) : null}

        {subjects.length > 0 ? (
          <Rise index={7}>
            <details className="mt-4 rounded-2xl border border-stage-line bg-stage/40 px-4 py-3">
              <summary className="cursor-pointer text-sm font-medium text-stage-ink">按学科查看明细（{subjects.length}）</summary>
              <div
                data-testid="freestyle-round-complete-subjects"
                className="mt-3 max-h-[min(40dvh,18rem)] space-y-2 overflow-y-auto pr-0.5"
              >
              {subjects.map((subject) => {
                const key = subjectKey(subject.subjectId, subject.subjectName)
                const open = openKey === key
                return (
                  <div
                    key={key}
                    className="overflow-hidden rounded-2xl border border-stage-line bg-stage/40 transition-colors hover:border-stage-line-strong"
                  >
                    <button
                      type="button"
                      data-testid="freestyle-round-complete-subject"
                      data-open={open ? 'true' : 'false'}
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
                      onClick={() => setExpandedKey(open ? null : key)}
                      aria-expanded={open}
                    >
                      <ChevronDown
                        className={cn(
                          'size-4 shrink-0 text-stage-muted transition-transform duration-300 ease-[var(--ease-spring-soft)]',
                          open ? 'rotate-0' : '-rotate-90',
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate font-medium text-stage-ink">
                        {subject.subjectName}
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-stage-muted sm:text-xs">
                        {subject.palaceCount} 宫 · {subject.cardCount} 卡
                      </span>
                    </button>
                    {open ? (
                      <div className="fs-expand space-y-1 border-t border-stage-line px-3 py-2">
                        {subject.palaces.map((palace) => (
                          <div
                            key={palace.palaceId}
                            data-testid="freestyle-round-complete-palace"
                            className="flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 text-sm text-stage-ink/90"
                          >
                            <span className="min-w-0 truncate">{palace.palaceTitle}</span>
                            <span className="shrink-0 text-[11px] tabular-nums text-stage-muted">
                              {palace.cardCount} 卡
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )
              })}
              </div>
            </details>
          </Rise>
        ) : null}

        {!partial && quizPalaceCount > 0 ? (
          <Rise index={8}>
            <div
              data-testid="freestyle-round-quiz-clear"
              className="mt-4 rounded-2xl border border-stage-line bg-stage/40 px-4 py-3"
            >
              <div className="text-sm font-medium text-stage-ink">做题进度</div>
              {quizChoice === 'kept' ? (
                <p className="mt-1 text-xs leading-5 text-stage-muted">已保留做题进度，之后仍可查看。</p>
              ) : quizChoice === 'cleared' ? (
                <p className="mt-1 text-xs leading-5 text-stage-muted">已清除本轮涉及宫殿的做题已完成状态，学习历史和复习安排保持不变。</p>
              ) : (
                <>
                  <p className="mt-1 text-xs leading-5 text-stage-muted">
                    {settlementQuizClearCopy(quizPalaceCount)}
                  </p>
                  {quizClearError ? (
                    <p className="mt-1 text-xs leading-5 text-rate-again">{quizClearError}</p>
                  ) : null}
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      data-testid="freestyle-round-quiz-keep"
                      className="ma-pressable rounded-xl border border-stage-line-strong px-3 py-2 text-sm font-medium text-stage-ink hover:bg-stage-ink/8 disabled:opacity-60"
                      disabled={quizChoice === 'clearing'}
                      onClick={() => {
                        setQuizClearError('')
                        setQuizChoice('kept')
                      }}
                    >
                      保留
                    </button>
                    <button
                      type="button"
                      data-testid="freestyle-round-quiz-clear-confirm"
                      className="ma-pressable rounded-xl bg-rate-again/90 px-3 py-2 text-sm font-semibold text-stage hover:bg-rate-again disabled:opacity-60"
                      disabled={quizChoice === 'clearing'}
                      onClick={() => {
                        setQuizClearError('')
                        setQuizChoice('clearing')
                        const owner = clearOwnerRef.current
                        const operation = ++owner.operation
                        const stillCurrent = () => clearOwnerRef.current === owner && owner.operation === operation
                        void onClearQuizProgress()
                          .then(() => { if (stillCurrent()) setQuizChoice('cleared') })
                          .catch((error: unknown) => {
                            if (!stillCurrent()) return
                            setQuizChoice('pending')
                            setQuizClearError(error instanceof Error ? error.message : '清除做题进度失败。')
                          })
                      }}
                    >
                      {quizChoice === 'clearing' ? '正在清除…' : '清除'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </Rise>
        ) : null}

        <Rise index={9}>
          {!partial && onFinishStudy ? (
            <button
              type="button"
              data-testid="freestyle-study-finish-confirm"
              className="ma-pressable mt-3 w-full rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              disabled={!quizChoiceResolved}
              onClick={onFinishStudy}
            >
              结束并保留本轮
            </button>
          ) : null}
          {!partial && onAddDueToday ? (
            <button type="button" className="ma-pressable mt-2 w-full rounded-2xl border border-stage-line-strong px-4 py-3 text-sm" onClick={onAddDueToday}>
              加入今天到期内容，继续本轮
            </button>
          ) : null}
          {!partial && !quizChoiceResolved && onFinishStudy ? (
            <p className="mt-2 text-center text-xs text-stage-muted">结束前请选择保留或清除做题已完成状态。</p>
          ) : null}
          {partial ? (
            <button
              type="button"
              data-testid="freestyle-partial-settlement-confirm"
              className="ma-pressable fs-cta-shine relative mt-2 flex w-full items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-r from-primary to-primary-strong px-4 py-3 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110"
              onClick={onConfirmPartial}
            >
              确认结算
            </button>
          ) : null}
        </Rise>
      </div>
    </div>
  )
}
