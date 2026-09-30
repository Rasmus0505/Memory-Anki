import {
  DEFAULT_THEME_PACK,
  THEME_PACKS,
  type ThemePack,
  type ThemePackId,
  type UnlockRule,
} from '@/shared/theme/themePacks'

export type { UnlockRule }

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

/** A saved pack that is not (or no longer) unlocked falls back to the default world. */
export function resolvePack(picked: string | null | undefined, context: UnlockContext): ThemePackId {
  const found = THEME_PACKS.find((pack) => pack.id === picked)
  return found && isUnlocked(found.unlock, context) ? found.id : DEFAULT_THEME_PACK
}

/** Unlocked packs whose unboxing has not played yet, in ladder order. */
export function packsAwaitingUnbox(context: UnlockContext, unboxed: readonly string[]): ThemePack[] {
  return THEME_PACKS.filter((pack) => isUnlocked(pack.unlock, context) && !unboxed.includes(pack.id))
}
