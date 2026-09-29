import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ProgressionStarmap } from '@/shared/api/contracts'
import { cn } from '@/shared/lib/utils'
import { layoutSky, type Star } from '../../domain/starmapLayout'
import { StarmapCanvas } from './StarmapCanvas'

function percent(value: number) {
  return `${Math.round(value * 100)}%`
}

function StarInfo({ star, sky, onClose }: { star: Star; sky: ReturnType<typeof layoutSky>; onClose: () => void }) {
  const children = sky.stars
    .filter((item) => item.parentKey === star.key && item.kind === 'palace')
    .sort((a, b) => a.mastery - b.mastery)
    .slice(0, 6)
  return (
    <div
      data-testid="growth-starmap-info"
      className="absolute bottom-3 left-3 right-3 z-20 rounded-2xl border border-amber-200/20 bg-[hsl(24_30%_9%/0.9)] p-3 text-amber-50 shadow-xl backdrop-blur sm:right-auto sm:w-72"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold">{star.label}</div>
          <div className="mt-0.5 text-xs text-amber-100/70">
            掌握 {percent(star.mastery)} · {'★'.repeat(star.stars)}
            {star.due > 0 ? ` · ${star.due} 张待复习` : ' · 暂无待复习'}
          </div>
        </div>
        <button type="button" onClick={onClose} className="rounded-md px-1.5 text-amber-100/60 hover:text-amber-50" aria-label="关闭星星详情">
          ✕
        </button>
      </div>
      {star.kind === 'palace' ? (
        <Link
          to={`/freestyle?palaceId=${star.id}`}
          className="mt-3 inline-flex rounded-full bg-amber-400/90 px-3 py-1 text-xs font-bold text-[hsl(24_50%_10%)] hover:bg-amber-300"
        >
          去随心练这座宫殿
        </Link>
      ) : children.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {children.map((child) => (
            <li key={child.key}>
              <Link
                to={`/freestyle?palaceId=${child.id}`}
                className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-xs hover:bg-amber-100/10"
              >
                <span className="truncate">{child.label}</span>
                <span className="shrink-0 tabular-nums text-amber-100/60">{percent(child.mastery)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/** 暖夜星座: subject = constellation, chapter = bright star, palace = companion. */
export function Starmap({ starmap, className }: { starmap: ProgressionStarmap; className?: string }) {
  const sky = useMemo(() => layoutSky(starmap), [starmap])
  const [selected, setSelected] = useState<Star | null>(null)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const subjects = sky.stars.filter((star) => star.kind === 'subject')
  const lit = sky.stars.filter((star) => star.kind === 'palace' && star.mastery >= 0.8).length
  const palaces = sky.stars.filter((star) => star.kind === 'palace').length

  if (palaces === 0) {
    return (
      <div className={cn('growth-starmap grid place-items-center rounded-3xl text-sm text-amber-100/70', className)}>
        还没有宫殿。建好第一座宫殿，这片夜空就会亮起第一颗星。
      </div>
    )
  }

  return (
    <div className={cn('relative overflow-hidden rounded-3xl', className)}>
      <StarmapCanvas
        sky={sky}
        selectedKey={selected?.key ?? null}
        focusKey={focusKey}
        onSelect={(star) => {
          setSelected(star)
          if (star) setFocusKey(star.key)
        }}
        ariaLabel={`知识星图：${subjects.length} 个学科，${palaces} 座宫殿，其中 ${lit} 座已点亮`}
      />
      <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex flex-wrap items-center gap-1.5">
        <span className="pointer-events-auto rounded-full bg-[hsl(24_30%_9%/0.7)] px-2.5 py-1 text-[11px] font-semibold text-amber-100/80 backdrop-blur">
          已点亮 {lit}/{palaces}
        </span>
        <button
          type="button"
          onClick={() => {
            setSelected(null)
            setFocusKey(null)
          }}
          className="pointer-events-auto rounded-full bg-[hsl(24_30%_9%/0.7)] px-2.5 py-1 text-[11px] text-amber-100/80 backdrop-blur hover:text-amber-50"
        >
          全景
        </button>
        {subjects.map((subject) => (
          <button
            key={subject.key}
            type="button"
            onClick={() => {
              setSelected(subject)
              setFocusKey(subject.key)
            }}
            className={cn(
              'pointer-events-auto rounded-full px-2.5 py-1 text-[11px] backdrop-blur',
              selected?.key === subject.key ? 'bg-amber-300/90 text-[hsl(24_50%_10%)]' : 'bg-[hsl(24_30%_9%/0.7)] text-amber-100/80 hover:text-amber-50',
            )}
          >
            {subject.label}
          </button>
        ))}
      </div>
      <div className="pointer-events-none absolute bottom-3 right-3 z-10 hidden text-[10px] text-amber-100/45 sm:block">
        亮度 = 掌握 · 大小 = 星级 · 闪烁 = 待复习
      </div>
      {selected && selected.kind !== 'subject' ? <StarInfo star={selected} sky={sky} onClose={() => setSelected(null)} /> : null}
    </div>
  )
}
