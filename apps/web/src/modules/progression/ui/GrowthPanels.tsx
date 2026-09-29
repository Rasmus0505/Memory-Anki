import type { ProgressionOverview, ProgressionQuest, ProgressionStamp, ProgressionXpSource } from '@/shared/api/contracts'
import { FX_ANCHORS, fxAnchor } from '@/shared/fx'
import { cn } from '@/shared/lib/utils'

const SOURCE_LABEL: Record<ProgressionXpSource, string> = {
  rating: '评分',
  conquer: '攻克',
  first_learn: '新学会',
  quiz: '做题',
  time: '专注',
  quest: '委托',
}

export function LevelBar({ progress, className }: { progress: number; className?: string }) {
  return (
    <div {...fxAnchor(FX_ANCHORS.xpBar)} className={cn('growth-xp-bar h-2.5 overflow-hidden rounded-full', className)}>
      <div className="growth-xp-fill h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, progress * 100))}%` }} />
    </div>
  )
}

export function LevelCard({ overview, compact = false }: { overview: ProgressionOverview; compact?: boolean }) {
  const { level, xp } = overview
  const toNext = Math.max(0, level.next_level_xp - level.xp)
  const sources = (Object.entries(xp.sources) as Array<[ProgressionXpSource, number]>).filter(([, value]) => value > 0)
  const total = sources.reduce((sum, [, value]) => sum + value, 0) || 1
  return (
    <section data-testid="growth-level-card" className="growth-paper flex min-w-0 flex-col gap-3 rounded-3xl p-4">
      <div className="flex items-end gap-3">
        <div className="growth-level-seal grid size-14 shrink-0 place-items-center rounded-2xl">
          <span className="text-[10px] font-bold leading-none opacity-70">Lv</span>
          <span className="-mt-1 text-2xl font-black tabular-nums leading-none">{level.level}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-bold text-foreground">累计 {level.xp.toLocaleString()} 经验</span>
            <span className="text-xs tabular-nums text-muted-foreground">距 Lv.{level.level + 1} 还差 {toNext.toLocaleString()}</span>
          </div>
          <LevelBar progress={level.progress} className="mt-2" />
          <div className="mt-1.5 flex gap-3 text-xs text-muted-foreground">
            <span>今天 +{xp.today}</span>
            <span>本周 +{xp.week}</span>
            <span>学习 {overview.stats.active_days ?? 0} 天</span>
          </div>
        </div>
      </div>
      {!compact && sources.length > 0 ? (
        <div>
          <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
            {sources.map(([source, value]) => (
              <span key={source} data-source={source} className="growth-source-seg h-full" style={{ width: `${(value / total) * 100}%` }} />
            ))}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {sources.map(([source, value]) => (
              <span key={source} className="inline-flex items-center gap-1">
                <span data-source={source} className="growth-source-seg size-2 rounded-full" />
                {SOURCE_LABEL[source]} {value.toLocaleString()}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  )
}

function QuestRow({ quest }: { quest: ProgressionQuest }) {
  const ratio = quest.target ? quest.progress / quest.target : 0
  return (
    <li data-done={quest.done ? 'true' : 'false'} className="growth-quest relative rounded-2xl px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className={cn('truncate text-sm font-semibold', quest.done && 'text-muted-foreground line-through decoration-2')}>{quest.title}</span>
        <span className="shrink-0 text-xs font-bold tabular-nums text-primary">+{quest.xp}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div className="growth-quest-fill h-full rounded-full" style={{ width: `${Math.min(100, ratio * 100)}%` }} />
        </div>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {quest.progress}/{quest.target}
        </span>
      </div>
      {!quest.done ? <p className="mt-1 truncate text-[11px] text-muted-foreground">{quest.hint}</p> : null}
      {quest.done ? <span className="growth-quest-stamp" aria-hidden>完成</span> : null}
    </li>
  )
}

export function QuestBoard({ quests }: { quests: ProgressionQuest[] }) {
  const daily = quests.filter((quest) => quest.scope === 'daily')
  const weekly = quests.filter((quest) => quest.scope === 'weekly')
  return (
    <section data-testid="growth-quests" className="growth-paper flex min-h-0 flex-col rounded-3xl p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-bold">今日委托</h2>
        <span className="text-[11px] text-muted-foreground">可选 · 没做完也不会累积</span>
      </div>
      <ul className="mt-2 grid min-h-0 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        {daily.map((quest) => <QuestRow key={quest.key} quest={quest} />)}
        {weekly.map((quest) => <QuestRow key={quest.key} quest={{ ...quest, title: `本周 · ${quest.title}` }} />)}
      </ul>
    </section>
  )
}

const TIER_LABEL = { paper: '纸印', silver: '银印', gold: '金印' } as const

function StampTile({ stamp }: { stamp: ProgressionStamp }) {
  const unlocked = Boolean(stamp.unlocked_on)
  return (
    <li
      data-testid="growth-stamp"
      data-unlocked={unlocked ? 'true' : 'false'}
      data-tier={stamp.tier}
      title={`${stamp.title}：${stamp.description}${unlocked ? `（${stamp.unlocked_on} 获得）` : ''}`}
      className="growth-stamp flex flex-col items-center gap-1 rounded-2xl p-2 text-center"
    >
      <span className="growth-stamp-seal grid size-12 place-items-center rounded-xl text-sm font-black">{stamp.title.slice(0, 2)}</span>
      <span className="w-full truncate text-[11px] font-semibold">{stamp.title}</span>
      <span className="text-[10px] tabular-nums text-muted-foreground">
        {unlocked ? TIER_LABEL[stamp.tier] : `${stamp.progress}/${stamp.target}`}
      </span>
    </li>
  )
}

export function StampBook({ stamps }: { stamps: ProgressionStamp[] }) {
  const groups = Array.from(new Set(stamps.map((stamp) => stamp.group)))
  const got = stamps.filter((stamp) => stamp.unlocked_on).length
  return (
    <section data-testid="growth-stamp-book" className="flex min-h-0 flex-col">
      <div className="mb-2 flex items-baseline justify-between px-1">
        <h2 className="text-sm font-bold">印章册</h2>
        <span className="text-xs tabular-nums text-muted-foreground">{got}/{stamps.length}</span>
      </div>
      <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
        {groups.map((group) => (
          <div key={group}>
            <div className="mb-1 px-1 text-[11px] font-semibold text-muted-foreground">{group}</div>
            <ul className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
              {stamps.filter((stamp) => stamp.group === group).map((stamp) => <StampTile key={stamp.id} stamp={stamp} />)}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}
