import { useState } from 'react'
import type { FreestyleRoundSummary } from '@/shared/api/contracts'

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
      className="flex flex-col gap-4 rounded-2xl border border-stage-line bg-stage-raised p-4 text-stage-ink"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium">这一轮将学习 {total} 张</h3>
        {summary.skipped_count > 0 ? (
          <span className="text-xs text-stage-muted">跳过 {summary.skipped_count}</span>
        ) : null}
      </div>
      <dl className="grid grid-cols-2 gap-2 text-center">
        <div className="rounded-xl bg-stage-glass px-2 py-2">
          <dt className="text-[11px] text-stage-muted">新学</dt>
          <dd className="text-lg font-semibold tabular-nums">{summary.new_count}</dd>
        </div>
        <div className="rounded-xl bg-stage-glass px-2 py-2">
          <dt className="text-[11px] text-stage-muted">复习</dt>
          <dd className="text-lg font-semibold tabular-nums">{summary.review_count}</dd>
        </div>
      </dl>
      {summary.order.length > 0 ? (
        <ol className="flex flex-col gap-1 text-sm">
          {visible.map((item, index) => (
            <li key={item.card_id} className="flex items-center gap-3">
              <span className="w-5 shrink-0 text-right tabular-nums text-stage-faint">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate">
                {palaceTitleByCardId[item.card_id] ?? '未命名宫殿'}
              </span>
              <span className="shrink-0 text-xs text-stage-muted">{item.kind === 'review' ? '复习' : '新学'}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {summary.order.length > ORDER_PREVIEW ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="self-start text-xs text-stage-muted underline-offset-2 hover:underline"
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
