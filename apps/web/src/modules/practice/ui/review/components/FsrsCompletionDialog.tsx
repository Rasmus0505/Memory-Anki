import { AlertTriangle } from 'lucide-react'
import {
  formatLastReviewDetailLabel,
  formatNextReviewDetailLabel,
  formatReviewAbsolute,
} from '@/modules/memory/public'
import { formatDuration } from '@/modules/session/public'
import type { MindMapRecallRating, ReviewCompletionSummary } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { MasteryDeltaBadge } from '@/modules/practice/ui/review/components/MasteryDeltaBadge'

const BULK_RATING_OPTIONS: Array<{ rating: MindMapRecallRating; label: string }> = [
  { rating: 1, label: '忘记' },
  { rating: 2, label: '困难' },
  { rating: 3, label: '记得' },
  { rating: 4, label: '轻松' },
]

interface Props {
  open: boolean
  summary: ReviewCompletionSummary | null
  durationSeconds?: number
  submitting?: boolean
  preparing?: boolean
  error?: string | null
  submissionFailed?: boolean
  bulkRating?: boolean
  onRetry?: () => void
  onRetrySubmission?: () => void
  /** One-tap rate every still-unrated node in this session's frozen due scope. */
  onBulkRateUnrated?: (rating: MindMapRecallRating) => void | Promise<void>
  /** Rate palace due nodes outside frozen scope (other branches). Requires confirmation. */
  onBulkRateOutOfScopeDue?: (rating: MindMapRecallRating) => void | Promise<void>
  onConfirm: () => void
  onCancel: () => void
}

export function FsrsCompletionDialog({
  open,
  summary,
  durationSeconds,
  submitting = false,
  preparing = false,
  error = null,
  submissionFailed = false,
  bulkRating = false,
  onRetry,
  onRetrySubmission,
  onBulkRateUnrated,
  onBulkRateOutOfScopeDue,
  onConfirm,
  onCancel,
}: Props) {
  const unratedCount = summary?.unrated_due_node_count ?? 0
  const outOfScopeDueCount = summary?.out_of_scope_due_node_count ?? 0
  const remainingDueCount = summary?.remaining_due_node_count ?? 0
  const busy = submitting || bulkRating || preparing

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onCancel() }}>
      <DialogContent className="max-w-lg" data-timer-activity="ignore">
        <DialogHeader><DialogTitle>完成 FSRS 复习</DialogTitle></DialogHeader>
        <div className="space-y-4 px-6 py-4">
          {typeof durationSeconds === 'number' ? (
            <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
              本次耗时：<b>{formatDuration(durationSeconds)}</b>
            </div>
          ) : null}
          {preparing ? <p className="text-sm text-muted-foreground">正在读取最新 FSRS 状态…</p> : null}
          {error ? (
            <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}
          {summary ? (
            <>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border p-3">
                  <div className="text-muted-foreground">本次到期评分</div>
                  <b>
                    {summary.rated_node_count}/{summary.scope_node_count} 个节点
                  </b>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-muted-foreground">稳定度参考 / 预计保持率</div>
                  <b className="inline-flex items-baseline">
                    <span>{summary.mastery_percent}%</span>
                    <MasteryDeltaBadge
                      current={summary.mastery_percent}
                      previous={summary.previous_mastery_percent}
                    />
                    <span className="mx-1 text-muted-foreground">/</span>
                    <span>{summary.memory_health_percent}%</span>
                  </b>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                {Object.entries(summary.rating_counts ?? { 忘记: 0, 困难: 0, 记得: 0, 轻松: 0 }).map(
                  ([label, count]) => (
                    <div key={label} className="rounded-lg border px-2 py-2">
                      <div>{label}</div>
                      <b className="text-base">{count}</b>
                    </div>
                  ),
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border p-3 text-sm">
                  <div className="text-muted-foreground">上次正式复习</div>
                  <b className="mt-0.5 block">
                    {summary.last_review_at
                      ? formatReviewAbsolute(summary.last_review_at)
                      : '—'}
                  </b>
                  <div className="mt-1 text-muted-foreground">
                    {formatLastReviewDetailLabel(summary.last_review_at)}
                  </div>
                </div>
                <div className="rounded-lg border p-3 text-sm">
                  <div className="text-muted-foreground">下次复习（整宫）</div>
                  <b className="mt-0.5 block">{formatReviewAbsolute(summary.next_review_at)}</b>
                  <div className="mt-1 text-muted-foreground">
                    {formatNextReviewDetailLabel({
                      nextReviewAt: summary.next_review_at,
                      nextReviewNodeCount: summary.next_review_node_count ?? summary.remaining_due_node_count,
                      nextReviewEntryMode: summary.next_review_entry_mode,
                      nextReviewEntryLabel: summary.next_review_entry_label,
                    })}
                  </div>
                </div>
              </div>
              {unratedCount === 0 && remainingDueCount > 0 ? (
                <div className="rounded-lg border border-info/40 bg-info/10 p-3 text-sm text-muted-foreground">
                  本次到期节点已评分；整宫仍有 <b className="text-foreground">{remainingDueCount}</b> 个到期节点
                  {outOfScopeDueCount > 0 ? `（其中 ${outOfScopeDueCount} 个尚未并入本次）` : ''}。
                  确认结束后宫殿可能仍显示可立即复习，这是正常的。
                </div>
              ) : null}
              {unratedCount > 0 ? (
                <div className="space-y-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
                  <div className="flex gap-2">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                    <span>
                      本次还有 {unratedCount} 个到期节点未评分。正式 wave
                      要求冻结范围内全部评分后才能完成结算；可返回继续评分，或一键只给这些未评分节点打分（不会覆盖已评分节点）。
                    </span>
                  </div>
                  {onBulkRateUnrated ? (
                    <div className="space-y-2">
                      <div className="text-xs text-muted-foreground">一键评分本次未评分到期节点</div>
                      <div className="grid grid-cols-4 gap-2">
                        {BULK_RATING_OPTIONS.map((option) => (
                          <Button
                            key={option.rating}
                            type="button"
                            size="sm"
                            variant={option.rating === 1 ? 'destructive' : option.rating === 3 ? 'default' : 'outline'}
                            disabled={busy}
                            onClick={() => {
                              void onBulkRateUnrated(option.rating)
                            }}
                          >
                            {bulkRating ? '…' : option.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {outOfScopeDueCount > 0 && onBulkRateOutOfScopeDue ? (
                <div className="space-y-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
                  <div className="flex gap-2">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                    <span>
                      另有 {outOfScopeDueCount} 个到期节点尚未并入本次（少见边角）。
                      一键评分会写入它们的 FSRS，即使你没有翻到那些卡。
                    </span>
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">确认后一键评分尚未并入的到期节点</div>
                    <div className="grid grid-cols-4 gap-2">
                      {BULK_RATING_OPTIONS.map((option) => (
                        <Button
                          key={`oos-${option.rating}`}
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => {
                            const ok = window.confirm(
                              `将把尚未并入本次的 ${outOfScopeDueCount} 个到期节点记为「${option.label}」。确定？`,
                            )
                            if (!ok) return
                            void onBulkRateOutOfScopeDue(option.rating)
                          }}
                        >
                          {bulkRating ? '…' : option.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
        <div className="flex justify-end gap-3 border-t px-6 py-4">
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            返回继续评分
          </Button>
          {submissionFailed ? (
            <Button disabled={!onRetrySubmission || busy} onClick={onRetrySubmission}>
              重新提交
            </Button>
          ) : error && !summary ? (
            <Button disabled={!onRetry || busy} onClick={onRetry}>
              重新加载
            </Button>
          ) : (
            <Button
              disabled={!summary || busy || unratedCount > 0}
              onClick={onConfirm}
              title={
                unratedCount > 0
                  ? '请先完成冻结范围内全部到期节点评分，或使用一键补评'
                  : undefined
              }
            >
              {submitting
                ? '正在提交…'
                : unratedCount > 0
                  ? `还有 ${unratedCount} 个未评分`
                  : '确认结束本次复习'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
