import { useSyncExternalStore } from 'react'
import { FX_ANCHORS } from '@/shared/fx'
import {
  flipXpNeeded,
  getFlipXpSnapshot,
  subscribeFlipXp,
  type FlipXpState,
} from '../model/freestyleFlipXp'

/** The flip XP meter. Subscribes to its own store, so it never re-renders the learning-progress badge. */
export function useFreestyleFlipXp(): FlipXpState {
  return useSyncExternalStore(subscribeFlipXp, getFlipXpSnapshot, getFlipXpSnapshot)
}

/**
 * Game-feel meter in the unit header. Amber paper look (style A) with a bright
 * leading edge (style D). It is labelled as XP so it is never read as 学习进度.
 */
export function FreestyleXpBar({ state }: { state: FlipXpState }) {
  const need = flipXpNeeded(state.level)
  const ratio = Math.max(0, Math.min(1, state.xp / need))
  return (
    <span
      data-testid="freestyle-xp-bar"
      data-fx-anchor={FX_ANCHORS.xpBar}
      role="meter"
      aria-label={`翻卡经验 Lv ${state.level}，${state.xp}/${need}`}
      aria-valuemin={0}
      aria-valuemax={need}
      aria-valuenow={state.xp}
      title="翻卡经验（与学习进度无关）"
      className="relative inline-flex h-5 w-16 shrink-0 items-center overflow-hidden rounded-full border border-amber-500/30 bg-amber-900/10 sm:h-6 sm:w-20"
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-amber-200 via-amber-400 to-amber-500 transition-[width] duration-500 ease-out motion-reduce:transition-none"
        style={{ width: `${ratio * 100}%` }}
      />
      {ratio > 0 ? (
        <span
          aria-hidden
          className="absolute inset-y-0 w-2 rounded-full bg-white/85 blur-[1px] transition-[left] duration-500 ease-out motion-reduce:transition-none"
          style={{ left: `calc(${ratio * 100}% - 4px)` }}
        />
      ) : null}
      <span className="relative z-10 font-mono text-[10px] font-bold tabular-nums tracking-tight text-amber-950 sm:text-[11px]">
        Lv {state.level}
      </span>
    </span>
  )
}
