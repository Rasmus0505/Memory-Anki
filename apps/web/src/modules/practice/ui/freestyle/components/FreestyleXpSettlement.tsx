import { useSyncExternalStore } from 'react'
import type { FreestyleRoundCompletion } from '@/modules/practice/ui/freestyle/model/roundCompletion'
import {
  flipXpNeeded,
  getFlipXpSnapshot,
  readFlipXpSession,
  subscribeFlipXp,
} from '@/modules/practice/ui/freestyle/model/freestyleFlipXp'
import { cn } from '@/shared/lib/utils'

/**
 * Settlement game card: overall level, this visit's gain, and the completed items as a
 * collection. A level crossed this visit gets the strongest treatment on the card.
 */
export function FreestyleXpSettlement({ completion }: { completion: FreestyleRoundCompletion }) {
  const state = useSyncExternalStore(subscribeFlipXp, getFlipXpSnapshot, getFlipXpSnapshot)
  // Cheap: sums the cleared levels. Re-run every render, which the store subscription already triggers.
  const session = readFlipXpSession()
  const need = flipXpNeeded(state.level)
  const ratio = Math.max(0, Math.min(1, state.xp / need))
  const cells: Array<{ key: string; label: string; count: number; tone: string }> = [
    { key: 'new', label: '新学', count: completion.newCount, tone: 'bg-amber-200/70 text-amber-900' },
    { key: 'review', label: '复习', count: completion.reviewCount, tone: 'bg-emerald-200/70 text-emerald-900' },
    { key: 'quiz', label: '做题', count: completion.quizCount, tone: 'bg-sky-200/70 text-sky-900' },
    { key: 'passed', label: '通过', count: completion.passedCount, tone: 'bg-rose-200/70 text-rose-900' },
  ]

  return (
    <section
      data-testid="freestyle-xp-settlement"
      aria-label="翻卡等级与收集"
      className="rounded-2xl border border-amber-500/30 bg-paper-card/95 p-4 text-paper-ink shadow-soft"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-paper-ink-soft">翻卡等级</span>
        <span data-testid="freestyle-xp-total-level" className="font-mono text-2xl font-black tabular-nums text-amber-700">
          Lv {state.level}
        </span>
      </div>
      <div className="mt-2 h-3 overflow-hidden rounded-full bg-amber-900/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-amber-200 via-amber-400 to-amber-500 transition-[width] duration-700 ease-out motion-reduce:transition-none"
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-paper-ink-soft">
        <span data-testid="freestyle-xp-session-gain">本次 +{session.gainedXp} XP</span>
        <span>{state.xp} / {need}</span>
      </div>
      {session.levelsGained > 0 ? (
        <div
          data-testid="freestyle-xp-session-levelup"
          className="fs-rise mt-3 rounded-xl bg-amber-400/25 px-3 py-2 text-center text-sm font-black text-amber-800"
        >
          本次升了 {session.levelsGained} 级：Lv {session.startLevel} → Lv {session.level}
        </div>
      ) : null}
      <div className="mt-4 grid grid-cols-4 gap-2" aria-label="本轮完成内容">
        {cells.map((cell, index) => (
          <div
            key={cell.key}
            className={cn('fs-rise flex flex-col items-center rounded-xl px-1 py-2', cell.tone)}
            style={{ ['--fs-i' as string]: index }}
          >
            <span className="font-mono text-lg font-black tabular-nums">{cell.count}</span>
            <span className="text-[11px] font-semibold">{cell.label}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
