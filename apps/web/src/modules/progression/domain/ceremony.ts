import type { ProgressionOverview, ProgressionQuest, ProgressionStamp } from '@/shared/api/contracts'
import { appendToasted, type GrowthState } from './growthState'

/** Round end gets the full show; mid-round only quiet corner stamps. */
export type CeremonyMode = 'settle' | 'live'

export interface CeremonyPlan {
  /** First load ever: everything so far is taken as already seen, silently. */
  baseline: boolean
  xpFrom: number
  xpTo: number
  levelFrom: number
  levelTo: number
  /** Stamps to celebrate with a full ceremony (settle) or a corner stamp (live). */
  stamps: ProgressionStamp[]
  quests: ProgressionQuest[]
  next: GrowthState
}

/** Round-end ceremonies stay short: the rest are marked seen and live in the stamp book. */
export const MAX_STAMP_CEREMONIES = 3

export function questToastKey(overview: ProgressionOverview, quest: ProgressionQuest) {
  return `quest:${quest.scope}:${quest.key}:${overview.today}`
}

export function planCeremony(state: GrowthState, overview: ProgressionOverview, mode: CeremonyMode): CeremonyPlan {
  const unlocked = overview.stamps.filter((stamp) => stamp.unlocked_on)
  const level = overview.level
  if (state.seenLevel == null || state.seenXp == null) {
    return {
      baseline: true,
      xpFrom: level.xp,
      xpTo: level.xp,
      levelFrom: level.level,
      levelTo: level.level,
      stamps: [],
      quests: [],
      next: {
        ...state,
        seenLevel: level.level,
        seenXp: level.xp,
        celebrated: unlocked.map((stamp) => stamp.id),
        toasted: appendToasted(state.toasted, [
          ...unlocked.map((stamp) => stamp.id),
          ...overview.quests.filter((quest) => quest.done).map((quest) => questToastKey(overview, quest)),
        ]),
      },
    }
  }

  const doneQuests = overview.quests.filter((quest) => quest.done && !state.toasted.includes(questToastKey(overview, quest)))
  const questKeys = doneQuests.map((quest) => questToastKey(overview, quest))

  if (mode === 'live') {
    const fresh = unlocked.filter((stamp) => !state.toasted.includes(stamp.id) && !state.celebrated.includes(stamp.id))
    return {
      baseline: false,
      xpFrom: state.seenXp,
      xpTo: state.seenXp,
      levelFrom: state.seenLevel,
      levelTo: state.seenLevel,
      stamps: fresh,
      quests: doneQuests,
      next: { ...state, toasted: appendToasted(state.toasted, [...fresh.map((stamp) => stamp.id), ...questKeys]) },
    }
  }

  const pending = unlocked.filter((stamp) => !state.celebrated.includes(stamp.id))
  return {
    baseline: false,
    // XP never shrinks in the view, even if evidence was undone elsewhere.
    xpFrom: Math.min(state.seenXp, level.xp),
    xpTo: level.xp,
    levelFrom: Math.min(state.seenLevel, level.level),
    levelTo: level.level,
    stamps: pending.slice(0, MAX_STAMP_CEREMONIES),
    quests: doneQuests,
    next: {
      ...state,
      seenLevel: level.level,
      seenXp: level.xp,
      celebrated: [...state.celebrated, ...pending.map((stamp) => stamp.id)],
      toasted: appendToasted(state.toasted, [...pending.map((stamp) => stamp.id), ...questKeys]),
    },
  }
}
