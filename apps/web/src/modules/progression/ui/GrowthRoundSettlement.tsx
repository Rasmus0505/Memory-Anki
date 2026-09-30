import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FX_ANCHORS, fxAnchor, resolveFxGate } from '@/shared/fx'
import type { ThemePack } from '@/shared/theme/themePacks'
import { updateGrowthState, useGrowthState } from '../model/growthStateStore'
import { useGrowthSettlement } from '../model/useGrowthCeremony'
import { useProgressionOverview } from '../model/useProgressionOverview'

/** Fill starts once the XP cue's gold lands on the bar. */
const FILL_DELAY_MS = 3000
const FILL_MS = 1400

function useAnimatedFill(from: number, to: number, levelUp: boolean) {
  const motion = resolveFxGate('completion').motion
  const [width, setWidth] = useState(motion ? from : to)
  useEffect(() => {
    if (!motion) {
      setWidth(to)
      return
    }
    setWidth(from)
    const timers = [
      window.setTimeout(() => setWidth(levelUp ? 1 : to), FILL_DELAY_MS),
      ...(levelUp ? [window.setTimeout(() => setWidth(0), FILL_DELAY_MS + FILL_MS * 0.6), window.setTimeout(() => setWidth(to), FILL_DELAY_MS + FILL_MS * 0.7)] : []),
    ]
    return () => timers.forEach((id) => window.clearTimeout(id))
  }, [from, levelUp, motion, to])
  return width
}

function UnboxedPack({ pack }: { pack: ThemePack }) {
  const worn = useGrowthState().pack === pack.id
  return (
    <div data-testid="growth-unboxed-pack" className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-stage-line-strong bg-stage/60 px-3 py-2">
      <div className="min-w-0">
        <div className="text-xs font-bold text-stage-glow">新世界 · {pack.label}</div>
        <div className="truncate text-[11px] text-stage-muted">{pack.tagline}</div>
      </div>
      <button
        type="button"
        disabled={worn}
        onClick={() => updateGrowthState({ pack: pack.id })}
        className="ma-pressable shrink-0 rounded-full bg-stage-glow px-3 py-1 text-xs font-bold text-stage disabled:opacity-60"
      >
        {worn ? '已换上' : '换上'}
      </button>
    </div>
  )
}

/** Round-end growth block: XP settles into the bar, level-ups and stamps get their ceremony. */
export function GrowthRoundSettlement({ roundKey }: { roundKey: string }) {
  const { data } = useProgressionOverview()
  const view = useGrowthSettlement(data, roundKey)
  const level = data?.level
  const levelUp = Boolean(view && view.levelTo > view.levelFrom)
  const startProgress = view && level && !levelUp && level.next_level_xp > level.level_floor
    ? Math.max(0, (view.xpFrom - level.level_floor) / (level.next_level_xp - level.level_floor))
    : 0
  const width = useAnimatedFill(startProgress, level?.progress ?? 0, levelUp)

  if (!data || !view || !level) return null
  const gained = view.xpTo - view.xpFrom
  const doneDaily = data.quests.filter((quest) => quest.scope === 'daily' && quest.done).length
  const dailyTotal = data.quests.filter((quest) => quest.scope === 'daily').length
  return (
    <div data-testid="growth-round-settlement" className="mt-4 rounded-2xl border border-stage-line bg-stage-raised/70 p-4 text-left text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold text-stage-ink">
          {view.baseline ? '成长档案已建立' : levelUp ? `升到 Lv.${level.level}` : `Lv.${level.level}`}
        </span>
        <span className="text-xs font-bold tabular-nums text-stage-glow">
          {view.baseline ? `${level.xp.toLocaleString()} 经验` : gained > 0 ? `本轮 +${gained} 经验` : '经验已入账'}
        </span>
      </div>
      <div {...fxAnchor(FX_ANCHORS.xpBar)} className="mt-2 h-2.5 overflow-hidden rounded-full bg-stage-line">
        <div className="growth-xp-fill h-full rounded-full transition-[width] ease-out" style={{ width: `${Math.max(2, width * 100)}%`, transitionDuration: `${FILL_MS * 0.6}ms` }} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-stage-muted">
        <span>今日委托 {doneDaily}/{dailyTotal}</span>
        {view.stamps.map((stamp) => (
          <span key={stamp.id} className="font-semibold text-stage-glow">印 · {stamp.title}</span>
        ))}
      </div>
      {view.unboxPack ? <UnboxedPack pack={view.unboxPack} /> : null}
      <Link to="/growth" className="mt-2 inline-block text-xs text-stage-glow hover:underline">
        看星图与印章册 →
      </Link>
    </div>
  )
}
