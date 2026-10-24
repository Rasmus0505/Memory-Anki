import { useState } from 'react'
import type {
  FreestyleNewPlacement,
  FreestyleRoundSummary,
  FreestyleRoundSummaryItem,
  FreestyleUnitOrder,
} from '@/shared/api/contracts'
import { Metric } from '@/shared/components/ui/metric'
import { palaceIdentityClass } from '@/modules/practice/ui/freestyle/model/freestyleProgressSegments'
import { cn } from '@/shared/lib/utils'

const ORDER_PREVIEW = 5

export const PREVIEW_UNIT_ORDER_LABELS: Record<FreestyleUnitOrder, string> = {
  structured: '宫殿内按知识结构',
  random: '宫殿内随机',
}

export const PREVIEW_PLACEMENT_LABELS: Record<FreestyleNewPlacement, string> = {
  new_first: '先学后复',
  review_first: '先复后学',
  ratio: '按比例穿插',
}

export interface PreviewPalaceRow {
  key: string
  palaceId: number | null
  title: string
  count: number
}

/**
 * One row per palace, in the order the round will use: a palace sits where its first
 * card appears in the summary order.
 */
export function previewPalaceRows(
  order: FreestyleRoundSummaryItem[],
  palaceTitleByCardId: Record<string, string>,
): PreviewPalaceRow[] {
  const rows = new Map<string, PreviewPalaceRow>()
  for (const item of order) {
    const key = item.palace_id == null ? 'none' : String(item.palace_id)
    const existing = rows.get(key)
    if (existing) {
      existing.count += 1
      continue
    }
    rows.set(key, {
      key,
      palaceId: item.palace_id,
      title: palaceTitleByCardId[item.card_id] || '未命名宫殿',
      count: 1,
    })
  }
  return [...rows.values()]
}

interface FreestyleConfigPreviewCardProps {
  summary: FreestyleRoundSummary
  palaceTitleByCardId: Record<string, string>
  /** Palace-internal unit order of the config this round was built from. Omitted: no chip. */
  unitOrder?: FreestyleUnitOrder | null
  /** New placement of the config this round was built from. Omitted: no chip. */
  newPlacement?: FreestyleNewPlacement | null
  onStart: () => void
}

export function FreestyleConfigPreviewCard({
  summary,
  palaceTitleByCardId,
  unitOrder,
  newPlacement,
  onStart,
}: FreestyleConfigPreviewCardProps) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? summary.order : summary.order.slice(0, ORDER_PREVIEW)
  const total = summary.new_count + summary.review_count
  const newShare = total > 0 ? (summary.new_count / total) * 100 : 0
  const palaceRows = previewPalaceRows(summary.order, palaceTitleByCardId)
  const largestPalace = Math.max(1, ...palaceRows.map((row) => row.count))

  return (
    <section
      aria-label="本轮预览"
      data-testid="freestyle-config-preview"
      className="flex flex-col gap-4 rounded-2xl border border-stage-line bg-surface-stage-raised p-4 text-ink-stage"
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">这一轮将学习 {total} 张</h3>
        <p className="text-xs leading-5 text-ink-stage-muted">
          {summary.skipped_count > 0
            ? `另有 ${summary.skipped_count} 张不在本轮，会留到之后的轮次。`
            : '本轮会包含所有待学内容，没有跳过。'}
        </p>
      </div>

      {unitOrder || newPlacement ? (
        <div className="flex flex-wrap gap-1.5" aria-label="本轮设置">
          {unitOrder ? (
            <span className="rounded-full border border-stage-line px-2.5 py-0.5 text-xs text-ink-stage-muted">
              {PREVIEW_UNIT_ORDER_LABELS[unitOrder]}
            </span>
          ) : null}
          {newPlacement ? (
            <span className="rounded-full border border-stage-line px-2.5 py-0.5 text-xs text-ink-stage-muted">
              {PREVIEW_PLACEMENT_LABELS[newPlacement]}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-3 gap-3">
        <Metric surface="stage" label="新学" value={summary.new_count} tone={summary.new_count ? 'info' : 'default'} />
        <Metric surface="stage" label="复习" value={summary.review_count} tone={summary.review_count ? 'warning' : 'default'} />
        <Metric surface="stage" label="跳过" value={summary.skipped_count} />
      </div>

      {total > 0 ? (
        <div className="flex flex-col gap-2" data-testid="freestyle-preview-composition">
          <div className="flex items-baseline justify-between text-xs text-ink-stage-muted">
            <span>新学与复习</span>
            <span className="tabular-nums">新学 {summary.new_count} · 复习 {summary.review_count}</span>
          </div>
          <div
            role="img"
            aria-label={`新学 ${summary.new_count} 张，复习 ${summary.review_count} 张`}
            className="flex h-2 overflow-hidden rounded-full bg-stage-ink/10"
          >
            {summary.new_count > 0 ? (
              <div className="h-full bg-info" style={{ width: `${newShare}%` }} />
            ) : null}
            {summary.review_count > 0 ? (
              <div className="h-full bg-warning" style={{ width: `${100 - newShare}%` }} />
            ) : null}
          </div>
        </div>
      ) : null}

      {palaceRows.length > 0 ? (
        <div className="flex flex-col gap-1.5" aria-label="宫殿分布" data-testid="freestyle-preview-palaces">
          {palaceRows.map((row) => (
            <div key={row.key} data-testid="freestyle-preview-palace-row" className="flex items-center gap-2 text-sm">
              <span className="w-24 shrink-0 truncate text-xs" title={row.title}>{row.title}</span>
              <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-stage-ink/10">
                <div
                  className={cn('h-full rounded-full', palaceIdentityClass(row.palaceId))}
                  style={{ width: `${(row.count / largestPalace) * 100}%` }}
                />
              </div>
              <span className="w-8 shrink-0 text-right text-xs tabular-nums text-ink-stage-muted">{row.count}</span>
            </div>
          ))}
        </div>
      ) : null}

      {summary.order.length > 0 ? (
        <ol className="flex flex-col gap-1 text-sm" aria-label="学习顺序">
          {visible.map((item, index) => (
            <li key={item.card_id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-stage">
              <span className="w-5 shrink-0 text-right tabular-nums text-ink-stage-muted">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate">
                {palaceTitleByCardId[item.card_id] ?? '未命名宫殿'}
              </span>
              <span
                className={
                  item.kind === 'review'
                    ? 'shrink-0 rounded-full bg-warning-soft px-2 py-0.5 text-xs text-warning-strong'
                    : 'shrink-0 rounded-full bg-info-soft px-2 py-0.5 text-xs text-info-strong'
                }
              >
                {item.kind === 'review' ? '复习' : '新学'}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      {summary.order.length > ORDER_PREVIEW ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="self-start text-xs text-ink-stage-muted underline-offset-2 hover:underline"
        >
          {expanded ? '收起' : `展开全部 ${summary.order.length} 张`}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onStart}
        disabled={total === 0}
        className="ma-pressable rounded-xl bg-stage-glow px-4 py-2.5 text-sm font-medium text-stage disabled:opacity-40"
      >
        开始学习
      </button>
    </section>
  )
}
