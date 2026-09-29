import { useEffect, useMemo } from 'react'
import type { ProgressionOverview } from '@/shared/api/contracts'
import { isFxSkinId, setFxSkin } from '@/shared/fx'
import { BOOKMARKS, MATERIALS, SKINS, resolvePick, type UnlockContext } from '../domain/cosmetics'
import { useGrowthState } from './growthStateStore'

export function unlockContextOf(overview: ProgressionOverview | null): UnlockContext {
  return {
    level: overview?.level.level ?? 1,
    stamps: new Set(overview?.stamps.filter((stamp) => stamp.unlocked_on).map((stamp) => stamp.id) ?? []),
  }
}

/**
 * Applies the wardrobe globally: the particle skin to the fx engine, card material
 * and bookmark as root data attributes that CSS reads. Until progression loads,
 * saved picks are trusted so the look does not flicker at startup.
 */
export function useGrowthCosmetics(overview: ProgressionOverview | null) {
  const state = useGrowthState()
  const context = useMemo(() => unlockContextOf(overview), [overview])
  const trusted = overview == null

  const skin = trusted ? state.skin : resolvePick(SKINS, state.skin, context)
  const material = trusted ? state.material : resolvePick(MATERIALS, state.material, context)
  const bookmark = trusted ? state.bookmark : resolvePick(BOOKMARKS, state.bookmark, context)

  useEffect(() => {
    setFxSkin(isFxSkinId(skin) ? skin : 'ink')
  }, [skin])

  useEffect(() => {
    const root = document.documentElement
    root.dataset.cardMaterial = material
    root.dataset.cardBookmark = bookmark
    return () => {
      delete root.dataset.cardMaterial
      delete root.dataset.cardBookmark
    }
  }, [bookmark, material])

  return { skin, material, bookmark, context }
}
