import type { ProgressionOverview } from '@/shared/api/contracts'
import { cue, setFxSkin, type FxSkinId } from '@/shared/fx'
import { cn } from '@/shared/lib/utils'
import { BOOKMARKS, MATERIALS, SKINS, isUnlocked, unlockLabel, type Cosmetic } from '../domain/cosmetics'
import { updateGrowthState } from '../model/growthStateStore'
import { useGrowthCosmetics } from '../model/useGrowthCosmetics'

function previewSkin(id: FxSkinId) {
  setFxSkin(id)
  cue('grade.commit', {
    origin: { x: window.innerWidth / 2, y: window.innerHeight * 0.6 },
    scope: document.body,
    grade: 4,
    combo: 6,
    milestone: false,
  }, { force: true, owner: 'fx:wardrobe' })
}

function Shelf<Id extends string>({
  title,
  items,
  picked,
  kind,
  overview,
  onPick,
}: {
  title: string
  items: Cosmetic<Id>[]
  picked: string
  kind: string
  overview: ProgressionOverview
  onPick: (id: Id) => void
}) {
  const context = {
    level: overview.level.level,
    stamps: new Set(overview.stamps.filter((stamp) => stamp.unlocked_on).map((stamp) => stamp.id)),
  }
  return (
    <div>
      <div className="mb-1.5 px-1 text-[11px] font-semibold text-muted-foreground">{title}</div>
      <ul className="grid grid-cols-2 gap-2">
        {items.map((item) => {
          const open = isUnlocked(item.unlock, context)
          const active = item.id === picked
          return (
            <li key={item.id}>
              <button
                type="button"
                disabled={!open}
                aria-pressed={active}
                onClick={() => onPick(item.id)}
                data-kind={kind}
                data-item={item.id}
                className={cn(
                  'growth-wardrobe-tile flex w-full flex-col items-start gap-1 rounded-2xl p-2.5 text-left transition',
                  active && 'growth-wardrobe-active',
                  !open && 'cursor-not-allowed opacity-55',
                )}
              >
                <span className="growth-wardrobe-swatch h-8 w-full rounded-lg" aria-hidden />
                <span className="text-xs font-bold">{item.label}</span>
                <span className="line-clamp-1 text-[10px] text-muted-foreground">{open ? item.blurb : unlockLabel(item.unlock)}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Earned looks: particle skins, card paper and the key-card bookmark. */
export function Wardrobe({ overview }: { overview: ProgressionOverview }) {
  const { skin, material, bookmark } = useGrowthCosmetics(overview)
  return (
    <section data-testid="growth-wardrobe" className="min-h-0 space-y-4 overflow-y-auto pr-1">
      <Shelf
        title="反馈皮肤（点一下试手感）"
        items={SKINS}
        picked={skin}
        kind="skin"
        overview={overview}
        onPick={(id) => {
          updateGrowthState({ skin: id })
          previewSkin(id)
        }}
      />
      <Shelf title="卡片材质" items={MATERIALS} picked={material} kind="material" overview={overview} onPick={(id) => updateGrowthState({ material: id })} />
      <Shelf title="重点卡书签" items={BOOKMARKS} picked={bookmark} kind="bookmark" overview={overview} onPick={(id) => updateGrowthState({ bookmark: id })} />
    </section>
  )
}
