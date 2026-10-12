import { useState } from 'react'
import type { FreestyleRoundSummary } from '@/shared/api/contracts'
import { Metric } from '@/shared/components/ui/metric'

const ORDER_PREVIEW = 5

interface FreestyleConfigPreviewCardProps {
  summary: FreestyleRoundSummary
  palaceTitleByCardId: Record<string, string>
  onStart: () => void
}

export function FreestyleConfigPreviewCard({ summary, palaceTitleByCardId, onStart }: FreestyleConfigPreviewCardProps) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? summary.order : summary.order.slice(0, ORDER_PREVIEW)
  const total = summary.new_count + summary.review_count

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

      <div className="grid grid-cols-3 gap-3">
        <Metric surface="stage" label="新学" value={summary.new_count} tone={summary.new_count ? 'info' : 'default'} />
        <Metric surface="stage" label="复习" value={summary.review_count} tone={summary.review_count ? 'warning' : 'default'} />
        <Metric surface="stage" label="跳过" value={summary.skipped_count} />
      </div>

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
