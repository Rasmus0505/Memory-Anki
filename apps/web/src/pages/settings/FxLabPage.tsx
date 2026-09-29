import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  FX_ANCHORS,
  FX_SKINS,
  FX_SKIN_IDS,
  RARE_LABEL,
  RARE_SHOWS,
  activeFxSkin,
  cue,
  fxAnchor,
  listCues,
  liveParticleCount,
  onCue,
  particleRendererKind,
  replayCue,
  setFxSkin,
  type FxSkinId,
} from '@/shared/fx'
import { cn } from '@/shared/lib/utils'

interface LogLine {
  id: number
  name: string
  at: string
}

/**
 * FX Lab: every registered cue replayed on the real engine, skins switched live,
 * rare shows forced. The mock rail/bar give homing particles somewhere to land.
 */
export default function FxLabPage() {
  const cues = useMemo(() => listCues(), [])
  const groups = useMemo(() => Array.from(new Set(cues.map((item) => item.group))), [cues])
  const [skin, setSkin] = useState<FxSkinId>(activeFxSkin())
  const [stats, setStats] = useState({ live: 0, renderer: 'idle' })
  const [log, setLog] = useState<LogLine[]>([])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setStats({ live: liveParticleCount(), renderer: particleRendererKind() ?? 'idle' })
    }, 250)
    let id = 0
    const off = onCue((name) => {
      id += 1
      const line = { id, name, at: new Date().toLocaleTimeString() }
      setLog((current) => [line, ...current].slice(0, 14))
    })
    return () => {
      window.clearInterval(timer)
      off()
    }
  }, [])

  return (
    <div data-testid="fx-lab" className="flex h-full min-h-0 flex-col gap-3 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-black">FX 实验室</h1>
        <span className="text-xs text-muted-foreground">真实引擎回放 · 忽略设置开关，所有通道都会播放</span>
        <Link to="/profile/feedback" className="ml-auto text-xs text-primary hover:underline">← 反馈设置</Link>
      </header>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card p-3">
        <span className="text-xs font-semibold text-muted-foreground">皮肤</span>
        {FX_SKIN_IDS.map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={skin === id}
            onClick={() => {
              setFxSkin(id)
              setSkin(id)
            }}
            className={cn('rounded-full border px-3 py-1 text-xs', skin === id ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted')}
          >
            {FX_SKINS[id].label}
          </button>
        ))}
        <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
          renderer {stats.renderer} · live {stats.live}
        </span>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
          {groups.map((group) => (
            <section key={group} className="rounded-2xl border bg-card p-3">
              <h2 className="mb-2 text-xs font-bold text-muted-foreground">{group}</h2>
              <div className="flex flex-wrap gap-2">
                {cues.filter((item) => item.group === group).map((item) => (
                  <button
                    key={item.name}
                    type="button"
                    disabled={!item.hasSample}
                    title={item.hasSample ? item.name : `${item.name}：需要真实场景（卡片、按钮）才能触发`}
                    onClick={() => replayCue(item.name)}
                    className="rounded-xl border px-3 py-1.5 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </section>
          ))}
          <section className="rounded-2xl border bg-card p-3">
            <h2 className="mb-2 text-xs font-bold text-muted-foreground">稀有演出（强制）</h2>
            <div className="flex flex-wrap gap-2">
              {RARE_SHOWS.map((show) => (
                <button
                  key={show}
                  type="button"
                  onClick={() => cue('rare.show', { show }, { force: true, owner: 'fx:lab' })}
                  className="rounded-xl border px-3 py-1.5 text-xs hover:bg-muted"
                >
                  {RARE_LABEL[show]}
                </button>
              ))}
            </div>
          </section>
        </div>

        <aside className="flex min-h-0 flex-col gap-3">
          <div className="rounded-2xl border bg-card p-3">
            <div className="mb-2 text-xs font-bold text-muted-foreground">落点（归巢目标）</div>
            <div {...fxAnchor(FX_ANCHORS.progressRail)} className="h-3 rounded-full bg-muted">
              <div {...fxAnchor(FX_ANCHORS.progressViewing)} className="h-full w-1/3 rounded-full bg-primary/60" />
            </div>
            <div {...fxAnchor(FX_ANCHORS.xpBar)} className="mt-3 h-2.5 rounded-full bg-primary/25" />
            <div {...fxAnchor(FX_ANCHORS.feedPager)} className="mt-3 h-16 rounded-xl border border-dashed" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border bg-card p-3">
            <div className="mb-2 text-xs font-bold text-muted-foreground">最近的信号</div>
            <ul className="space-y-1 font-mono text-[11px]">
              {log.map((line) => (
                <li key={line.id} className="flex justify-between gap-2">
                  <span className="truncate">{line.name}</span>
                  <span className="shrink-0 text-muted-foreground">{line.at}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  )
}
