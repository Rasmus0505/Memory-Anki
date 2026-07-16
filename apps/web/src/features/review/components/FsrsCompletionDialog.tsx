import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { formatDuration } from '@/entities/session/model'
import type { ReviewCompletionSummary } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Textarea } from '@/shared/components/ui/textarea'

interface Props {
  open: boolean
  summary: ReviewCompletionSummary | null
  durationSeconds?: number
  submitting?: boolean
  preparing?: boolean
  error?: string | null
  submissionFailed?: boolean
  onRetry?: () => void
  onRetrySubmission?: () => void
  onConfirm: (note: string) => void
  onCancel: () => void
}

function nextReview(value: string | null) {
  if (!value) return '暂无后续安排'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

export function FsrsCompletionDialog({ open, summary, durationSeconds, submitting = false, preparing = false, error = null, submissionFailed = false, onRetry, onRetrySubmission, onConfirm, onCancel }: Props) {
  const [note, setNote] = useState('')
  useEffect(() => { if (open) setNote('') }, [open])
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !submitting) onCancel() }}>
      <DialogContent className="max-w-lg" data-timer-activity="ignore">
        <DialogHeader><DialogTitle>完成 FSRS 复习</DialogTitle></DialogHeader>
        <div className="space-y-4 px-6 py-4">
          {typeof durationSeconds === 'number' ? <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">本次耗时：<b>{formatDuration(durationSeconds)}</b></div> : null}
          {preparing ? <p className="text-sm text-muted-foreground">正在读取最新 FSRS 状态…</p> : null}
          {error ? <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}
          {summary ? <>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border p-3"><div className="text-muted-foreground">本次评分</div><b>{summary.rated_node_count}/{summary.scope_node_count} 个节点</b></div>
              <div className="rounded-lg border p-3"><div className="text-muted-foreground">掌握 / 记忆</div><b>{summary.mastery_percent}% / {summary.memory_health_percent}%</b></div>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center text-xs">
              {Object.entries(summary.rating_counts ?? { 忘记: 0, 困难: 0, 记得: 0, 轻松: 0 }).map(([label, count]) => <div key={label} className="rounded-lg border px-2 py-2"><div>{label}</div><b className="text-base">{count}</b></div>)}
            </div>
            <div className="rounded-lg border p-3 text-sm"><div>下次复习：<b>{nextReview(summary.next_review_at)}</b></div><div className="mt-1 text-muted-foreground">当前仍到期 {summary.remaining_due_node_count} 个节点</div></div>
            {summary.unrated_due_node_count > 0 ? <div className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" /><span>还有 {summary.unrated_due_node_count} 个未评分节点。结束后它们不会被推进，将保持到期并再次进入复习队列。</span></div> : null}
            <div><div className="mb-1 text-xs text-muted-foreground">复盘一句（可选）</div><Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} maxLength={500} placeholder="这次哪里卡了、下次注意什么" /></div>
          </> : null}
        </div>
        <div className="flex justify-end gap-3 border-t px-6 py-4">
          <Button variant="outline" disabled={submitting} onClick={onCancel}>返回继续评分</Button>
          {submissionFailed ? <Button disabled={!onRetrySubmission || submitting} onClick={onRetrySubmission}>重新提交</Button> : error && !summary ? <Button disabled={!onRetry || submitting} onClick={onRetry}>重新加载</Button> : <Button disabled={!summary || submitting} onClick={() => onConfirm(note.trim())}>{submitting ? '正在提交…' : '确认结束本次复习'}</Button>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
