import type { CSSProperties } from 'react'
import type { ProgressionOverview } from '@/shared/api/contracts'
import { cue, isFxSkinId, setFxSkin } from '@/shared/fx'
import { cn } from '@/shared/lib/utils'
import { THEME_PACKS, applyThemePack, type ThemePack } from '@/shared/theme/themePacks'
import { isUnlocked, unlockLabel } from '../domain/cosmetics'
import { updateGrowthState } from '../model/growthStateStore'
import { unlockContextOf, useGrowthCosmetics } from '../model/useGrowthCosmetics'

function wear(pack: ThemePack) {
  updateGrowthState({ pack: pack.id })
  // Paint now so the preview burst below already uses the new palette.
  applyThemePack(pack.id)
  setFxSkin(isFxSkinId(pack.fxSkin) ? pack.fxSkin : 'ink')
  cue('grade.commit', {
    origin: { x: window.innerWidth / 2, y: window.innerHeight * 0.6 },
    scope: document.body,
    grade: 4,
    combo: 6,
    milestone: false,
  }, { force: true, owner: 'fx:wardrobe' })
}

function PackScene({ pack }: { pack: ThemePack }) {
  const style = {
    '--pack-ground': pack.preview.ground,
    '--pack-card': pack.preview.card,
    '--pack-accent': pack.preview.accent,
    '--pack-ink': pack.preview.ink,
    '--pack-glow': pack.preview.glow,
  } as CSSProperties
  return (
    <span className="growth-pack-scene" data-mote={pack.ambient.mote} style={style} aria-hidden>
      <span className="growth-pack-scene__card">
        <span className="growth-pack-scene__line" />
        <span className="growth-pack-scene__line growth-pack-scene__line--short" />
        <span className="growth-pack-scene__key" />
      </span>
      <span className="growth-pack-scene__motes" />
    </span>
  )
}

/** Earned worlds: each pack re-dresses the whole app, from paper to particles to rhythm. */
export function Wardrobe({ overview }: { overview: ProgressionOverview }) {
  const { pack: worn } = useGrowthCosmetics(overview)
  const context = unlockContextOf(overview)
  return (
    <section data-testid="growth-wardrobe" className="min-h-0 space-y-2 overflow-y-auto pr-1">
      <div className="px-1 text-[11px] font-semibold text-muted-foreground">主题世界（点一下换上，顺便试手感）</div>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {THEME_PACKS.map((pack) => {
          const open = isUnlocked(pack.unlock, context)
          const active = pack.id === worn.id
          return (
            <li key={pack.id}>
              <button
                type="button"
                disabled={!open}
                aria-pressed={active}
                onClick={() => wear(pack)}
                data-pack={pack.id}
                className={cn(
                  'growth-wardrobe-tile flex w-full flex-col items-stretch gap-2 rounded-2xl p-2.5 text-left transition',
                  active && 'growth-wardrobe-active',
                  !open && 'cursor-not-allowed opacity-55 grayscale-[0.4]',
                )}
              >
                <PackScene pack={pack} />
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-bold">{pack.label}</span>
                  <span className="text-[10px] text-muted-foreground">{open ? pack.tagline : unlockLabel(pack.unlock)}</span>
                </span>
                <span className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{pack.blurb}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
