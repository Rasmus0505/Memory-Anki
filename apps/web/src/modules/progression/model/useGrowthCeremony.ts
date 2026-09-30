import { useEffect, useRef, useState } from 'react'
import type { ProgressionOverview } from '@/shared/api/contracts'
import { cue, isFxSkinId, useFxOwner } from '@/shared/fx'
import { planCeremony, type CeremonyPlan } from '../domain/ceremony'
import type { ThemePack } from '@/shared/theme/themePacks'
import { packsAwaitingUnbox } from '../domain/cosmetics'
import { readGrowthState, writeGrowthState } from './growthStateStore'
import { unlockContextOf } from './useGrowthCosmetics'

/** Mid-round: every fresh stamp or finished quest gets one quiet corner stamp, then is marked seen. */
export function useLiveGrowthToasts(overview: ProgressionOverview | null) {
  useEffect(() => {
    if (!overview) return
    const plan = planCeremony(readGrowthState(), overview, 'live')
    writeGrowthState(plan.next)
    if (plan.baseline) return
    plan.stamps.forEach((stamp, index) => {
      window.setTimeout(() => cue('stamp.unlock', { title: stamp.title, ceremony: false }), index * 900)
    })
    plan.quests.forEach((quest, index) => {
      window.setTimeout(() => cue('quest.done', { title: quest.title }), (plan.stamps.length + index) * 900)
    })
  }, [overview])
}

export interface SettlementView extends CeremonyPlan {
  /** At most one new world per round gets its unboxing; the rest wait for later rounds. */
  unboxPack: ThemePack | null
}

/** Timing after the round meteor shower (≈2.3s) so the two never talk over each other. */
const XP_CUE_MS = 2600
const LEVEL_CUE_MS = 3600
const STAMP_CUE_MS = 4400
const STAMP_GAP_MS = 1100

/**
 * Round-end settlement: plans once per round, persists "seen" right away (so the
 * other device never replays it), then sequences XP → level-up → stamps under
 * the round's fx owner.
 */
export function useGrowthSettlement(overview: ProgressionOverview | null, roundKey: string) {
  const [view, setView] = useState<SettlementView | null>(null)
  const settledFor = useRef<string | null>(null)
  const owner = useFxOwner(`growth:${roundKey}`)

  useEffect(() => {
    if (!overview || settledFor.current === roundKey) return
    settledFor.current = roundKey
    const before = readGrowthState()
    const plan = planCeremony(before, overview, 'settle')
    const unboxPack = plan.baseline ? null : packsAwaitingUnbox(unlockContextOf(overview), before.unboxed)[0] ?? null
    const next = unboxPack ? { ...plan.next, unboxed: [...plan.next.unboxed, unboxPack.id] } : plan.next
    writeGrowthState(next)
    setView({ ...plan, next, unboxPack })
  }, [overview, roundKey])

  useEffect(() => {
    if (!view || view.baseline) return
    const timers: number[] = []
    const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms))
    const gained = view.xpTo - view.xpFrom
    if (gained > 0) later(XP_CUE_MS, () => cue('xp.gain', { amount: gained }, { owner }))
    if (view.levelTo > view.levelFrom) later(LEVEL_CUE_MS, () => cue('level.up', { level: view.levelTo }, { owner }))
    view.stamps.forEach((stamp, index) => {
      later(STAMP_CUE_MS + index * STAMP_GAP_MS, () => cue('stamp.unlock', { title: stamp.title, ceremony: true }, { owner }))
    })
    const pack = view.unboxPack
    if (pack) {
      later(STAMP_CUE_MS + view.stamps.length * STAMP_GAP_MS + 300, () => {
        cue('pack.unbox', { label: pack.label, skin: isFxSkinId(pack.fxSkin) ? pack.fxSkin : 'ink' }, { owner })
      })
    }
    return () => timers.forEach((id) => window.clearTimeout(id))
  }, [owner, view])

  return view
}
