import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import {
  formatNextReviewDetailLabel,
  formatReviewAbsolute,
} from '@/entities/review/model/reviewScheduleFormat'
import { formatDuration } from '@/entities/session/model'
import type { MindMapRecallRating, ReviewCompletionSummary } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Textarea } from '@/shared/components/ui/textarea'

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
  onConfirm: (note: string) => void
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
  onConfirm,
  onCancel,
}: Props) {
  const [note, setNote] = useState('')
  useEffect(() => {
    if (open) setNote('')
  }, [open])

  const unratedCount = summary?.unrated_due_node_count ?? 0
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
                  <div className="text-muted-foreground">本次评分</div>
                  <b>
                    {summary.rated_node_count}/{summary.scope_node_count} 个节点
                  </b>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-muted-foreground">掌握 / 记忆</div>
                  <b>
                    {summary.mastery_percent}% / {summary.memory_health_percent}%
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
              <div className="rounded-lg border p-3 text-sm">
                <div className="text-muted-foreground">下次复习</div>
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
              {unratedCount > 0 ? (
                <div className="space-y-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
                  <div className="flex gap-2">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                    <span>
                      本轮还有 {unratedCount} 个节点未评分。直接结束不会推进它们；也可以一键只给这些未评分节点打分（不会覆盖已评分节点）。
                    </span>
                  </div>
                  {onBulkRateUnrated ? (
                    <div className="space-y-2">
                      <div className="text-xs text-muted-foreground">一键仅评分未评分节点（已评分节点保持原分）</div>
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
              <div>
                <div className="mb-1 text-xs text-muted-foreground">复盘一句（可选）</div>
                <Textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="这次哪里卡了、下次注意什么"
                />
              </div>
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
            <Button disabled={!summary || busy} onClick={() => onConfirm(note.trim())}>
              {submitting ? '正在提交…' : '确认结束本次复习'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
