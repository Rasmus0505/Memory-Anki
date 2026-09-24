import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, RotateCcw } from 'lucide-react'
import type { FreestyleRoundCompletion } from '@/modules/practice/ui/freestyle/model/roundCompletion'
import { settlementQuizClearCopy } from '@/modules/practice/ui/freestyle/model/overlayQuizClearance'
import { formatTimer } from '@/modules/practice/ui/freestyle/model/freestyle-cards'
import { cn } from '@/shared/lib/utils'

type QuizClearChoice = 'pending' | 'kept' | 'clearing' | 'cleared'

function subjectKey(subjectId: number | null, subjectName: string) {
  return subjectId == null ? `name:${subjectName}` : `id:${subjectId}`
}

/**
 * Closing slot of a round: overview stats, subject/palace time breakdown,
 * one choice to clear 做题 progress for every palace in this 随心配置,
 * and 「再来一轮」 to reopen config for a fresh server round.
 */
export function FreestyleRoundCompleteCard({
  completion,
  roundKey,
  quizPalaceCount,
  onClearQuizProgress,
  onAnotherRound,
  onCancelSettlement,
}: {
  completion: FreestyleRoundCompletion
  roundKey: string
  quizPalaceCount: number
  onClearQuizProgress: () => Promise<void>
  onAnotherRound: () => void
  /** Leave this slot. Later card dwell and 做题 stay on this round's learning clock. */
  onCancelSettlement: () => void
}) {
  const subjects = useMemo(() => completion.bySubject ?? [], [completion.bySubject])
  const [quizChoice, setQuizChoice] = useState<QuizClearChoice>('pending')
  const [quizClearError, setQuizClearError] = useState('')
  useEffect(() => {
    setQuizChoice('pending')
    setQuizClearError('')
  }, [roundKey])
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
      data-testid="freestyle-round-complete"
      className="mx-auto flex h-full w-full max-w-2xl flex-col justify-center px-1 py-4"
    >
      <div className="rounded-3xl border border-emerald-300/20 bg-zinc-900/90 p-5 text-zinc-50 shadow-[0_16px_56px_rgba(0,0,0,0.5)] backdrop-blur sm:p-7">
        <div className="text-center">
          <div className="text-xs font-semibold tracking-wide text-emerald-300">今日到期已清</div>
          <h2 className="mt-1.5 text-2xl font-semibold leading-tight sm:text-3xl">
            {completion.ratedCount} 张已评分
          </h2>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2 sm:gap-3">
          <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-center">
            <div className="text-2xl font-bold text-emerald-300 sm:text-3xl">
              {completion.passedCount}
            </div>
            <div className="mt-1 text-[11px] text-zinc-400 sm:text-xs">已通过</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-center">
            <div className="text-2xl font-bold text-amber-200 sm:text-3xl">
              {completion.retryCount}
            </div>
            <div className="mt-1 text-[11px] text-zinc-400 sm:text-xs">
              {completion.retryCount > 0 ? '本轮重练过' : '重练'}
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-center">
            <div className="text-2xl font-bold tabular-nums sm:text-3xl">
              {completion.quizCount}
            </div>
            <div className="mt-1 text-[11px] text-zinc-400 sm:text-xs">题目</div>
          </div>
        </div>

        <div
          data-testid="freestyle-round-complete-total-time"
          className="mt-4 rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-4 py-3 text-center"
        >
          <div className="text-[11px] font-medium tracking-wide text-emerald-200/80">本次随心</div>
          <div className="mt-0.5 text-2xl font-semibold tabular-nums text-emerald-100 sm:text-3xl">
            {formatTimer(completion.totalEffectiveSeconds ?? 0)}
          </div>
          <div
            data-testid="freestyle-round-complete-quiz-time"
            className="mt-2 border-t border-emerald-200/15 pt-2 text-sm text-emerald-100/90"
          >
            <span className="text-[11px] font-medium tracking-wide text-emerald-200/70">做题时间</span>
            <span className="ml-2 font-semibold tabular-nums">
              {formatTimer(completion.quizSeconds ?? 0)}
            </span>
          </div>
        </div>

        {subjects.length > 0 ? (
          <div
            data-testid="freestyle-round-complete-subjects"
            className="mt-4 max-h-[min(40dvh,18rem)] space-y-2 overflow-y-auto pr-0.5"
          >
            {subjects.map((subject) => {
              const key = subjectKey(subject.subjectId, subject.subjectName)
              const open = openKey === key
              return (
                <div
                  key={key}
                  className="overflow-hidden rounded-2xl border border-white/10 bg-white/5"
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
                        'size-4 shrink-0 text-zinc-400 transition-transform',
                        open ? 'rotate-0' : '-rotate-90',
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate font-medium text-zinc-50">
                      {subject.subjectName}
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-zinc-400 sm:text-xs">
                      {subject.palaceCount} 宫 · {subject.cardCount} 卡 · {formatTimer(subject.effectiveSeconds)}
                    </span>
                  </button>
                  {open ? (
                    <div className="space-y-1 border-t border-white/8 px-3 py-2">
                      {subject.palaces.map((palace) => (
                        <div
                          key={palace.palaceId}
                          data-testid="freestyle-round-complete-palace"
                          className="flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 text-sm text-zinc-200"
                        >
                          <span className="min-w-0 truncate">{palace.palaceTitle}</span>
                          <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">
                            {palace.cardCount} 卡 · {formatTimer(palace.effectiveSeconds)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : null}

        {quizPalaceCount > 0 ? (
          <div
            data-testid="freestyle-round-quiz-clear"
            className="mt-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
          >
            <div className="text-sm font-medium text-zinc-50">做题进度</div>
            {quizChoice === 'kept' ? (
              <p className="mt-1 text-xs leading-5 text-zinc-400">已保留做题进度，之后仍可查看。</p>
            ) : quizChoice === 'cleared' ? (
              <p className="mt-1 text-xs leading-5 text-zinc-400">已清除本次随心配置中所有宫殿的做题进度。</p>
            ) : (
              <>
                <p className="mt-1 text-xs leading-5 text-zinc-400">
                  {settlementQuizClearCopy(quizPalaceCount)}
                </p>
                {quizClearError ? (
                  <p className="mt-1 text-xs leading-5 text-rose-300">{quizClearError}</p>
                ) : null}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    data-testid="freestyle-round-quiz-keep"
                    className="rounded-xl border border-white/15 px-3 py-2 text-sm font-medium text-zinc-100 transition-colors hover:bg-white/10 disabled:opacity-60"
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
                    className="rounded-xl bg-rose-400/90 px-3 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-rose-300 disabled:opacity-60"
                    disabled={quizChoice === 'clearing'}
                    onClick={() => {
                      setQuizClearError('')
                      setQuizChoice('clearing')
                      void onClearQuizProgress()
                        .then(() => setQuizChoice('cleared'))
                        .catch((error: unknown) => {
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
        ) : null}

        <button
          type="button"
          data-testid="freestyle-round-cancel-settlement"
          className="mt-5 flex w-full items-center justify-center rounded-2xl border border-white/15 px-4 py-3 text-sm font-medium text-zinc-100 transition-colors hover:bg-white/10 active:bg-white/15"
          onClick={onCancelSettlement}
        >
          取消结算
        </button>
        <button
          type="button"
          data-testid="freestyle-round-another"
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-400/90 px-4 py-3 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-300 active:bg-emerald-200"
          onClick={onAnotherRound}
        >
          <RotateCcw className="size-4" />
          再来一轮
        </button>
      </div>
    </div>
  )
}
