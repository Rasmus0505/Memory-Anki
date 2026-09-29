import type { FxSkinId } from '@/shared/fx'

/** How a cosmetic is earned: a level, or a specific stamp from the stamp book. */
export type UnlockRule = { level: number } | { stamp: string; label: string }

export interface Cosmetic<Id extends string> {
  id: Id
  label: string
  blurb: string
  unlock: UnlockRule
}

export type CardMaterialId = 'rice' | 'kraft' | 'wax' | 'goldfleck'
export type BookmarkId = 'foil' | 'cinnabar' | 'bamboo' | 'starlight'

export const SKINS: Cosmetic<FxSkinId>[] = [
  { id: 'ink', label: '纸墨', blurb: '纸屑、墨点与金粉，默认手感', unlock: { level: 1 } },
  { id: 'foil', label: '金箔', blurb: '碎金箔片与星芒，每一下都亮', unlock: { level: 5 } },
  { id: 'galaxy', label: '星河', blurb: '暖夜星尘，紫玫与金色发光', unlock: { level: 12 } },
]

export const MATERIALS: Cosmetic<CardMaterialId>[] = [
  { id: 'rice', label: '宣纸', blurb: '默认的暖白卡纸', unlock: { level: 1 } },
  { id: 'kraft', label: '牛皮纸', blurb: '更暖更厚的纸感', unlock: { level: 8 } },
  { id: 'wax', label: '蜡笺', blurb: '微微反光的蜡面', unlock: { stamp: 'days_30', label: '「一月耕读」' } },
  { id: 'goldfleck', label: '洒金笺', blurb: '纸里撒着碎金', unlock: { level: 20 } },
]

export const BOOKMARKS: Cosmetic<BookmarkId>[] = [
  { id: 'foil', label: '金箔书签', blurb: '三星卡的默认书签', unlock: { level: 1 } },
  { id: 'cinnabar', label: '朱砂', blurb: '朱红丝带', unlock: { stamp: 'conquer_100', label: '「百折不挠」' } },
  { id: 'bamboo', label: '青竹', blurb: '竹青色书签', unlock: { stamp: 'perfect_1', label: '「一轮无瑕」' } },
  { id: 'starlight', label: '星光', blurb: '会闪的星芒书签', unlock: { level: 30 } },
]

export interface UnlockContext {
  level: number
  stamps: ReadonlySet<string>
}

export function isUnlocked(rule: UnlockRule, context: UnlockContext) {
  return 'level' in rule ? context.level >= rule.level : context.stamps.has(rule.stamp)
}

export function unlockLabel(rule: UnlockRule) {
  return 'level' in rule ? `Lv.${rule.level} 解锁` : `获得印章${rule.label}解锁`
}

/** A saved pick that is not (or no longer) unlocked falls back to the first item. */
export function resolvePick<Id extends string>(items: Cosmetic<Id>[], picked: string | null | undefined, context: UnlockContext): Id {
  const found = items.find((item) => item.id === picked)
  return found && isUnlocked(found.unlock, context) ? found.id : items[0].id
}

/** Cosmetics that became available between two unlock contexts, for the round-end reveal. */
export function newlyUnlocked(before: UnlockContext, after: UnlockContext) {
  return [...SKINS, ...MATERIALS, ...BOOKMARKS].filter(
    (item) => !isUnlocked(item.unlock, before) && isUnlocked(item.unlock, after),
  )
}
