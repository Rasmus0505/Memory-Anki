import { useEffect, useMemo } from 'react'
import type { ProgressionOverview } from '@/shared/api/contracts'
import { isFxSkinId, setFxSkin } from '@/shared/fx'
import { applyThemePack, themePackById } from '@/shared/theme/themePacks'
import { resolvePack, type UnlockContext } from '../domain/cosmetics'
import { useGrowthState } from './growthStateStore'

export function unlockContextOf(overview: ProgressionOverview | null): UnlockContext {
  return {
    level: overview?.level.level ?? 1,
    stamps: new Set(overview?.stamps.filter((stamp) => stamp.unlocked_on).map((stamp) => stamp.id) ?? []),
  }
}

/**
 * Wears the saved theme pack app-wide: tokens, paper, motes and rhythm through
 * `shared/theme`, the particle palette through `shared/fx`. Until progression
 * loads the saved pick is trusted, so the world never flickers at startup.
 */
export function useGrowthCosmetics(overview: ProgressionOverview | null) {
  const state = useGrowthState()
  const context = useMemo(() => unlockContextOf(overview), [overview])
  const pack = overview == null ? state.pack : resolvePack(state.pack, context)

  useEffect(() => {
    const applied = applyThemePack(pack)
    setFxSkin(isFxSkinId(applied.fxSkin) ? applied.fxSkin : 'ink')
  }, [pack])

  return { pack: themePackById(pack), context }
}
