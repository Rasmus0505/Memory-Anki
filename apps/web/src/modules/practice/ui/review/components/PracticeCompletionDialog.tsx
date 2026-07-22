import { useEffect, useState } from 'react'
import { formatDuration } from '@/modules/session/public'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Textarea } from '@/shared/components/ui/textarea'

export function PracticeCompletionDialog({ open, durationSeconds, submitting, error, onRetry, onConfirm, onCancel }: { open: boolean; durationSeconds?: number; submitting?: boolean; error?: string | null; onRetry?: () => void; onConfirm: (note: string) => void; onCancel: () => void }) {
  const [note, setNote] = useState('')
  useEffect(() => { if (open) setNote('') }, [open])
  return <Dialog open={open} onOpenChange={(next) => { if (!next && !submitting) onCancel() }}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>完成本次练习</DialogTitle></DialogHeader><div className="space-y-4 px-6 py-4">{typeof durationSeconds === 'number' ? <div className="rounded-lg border p-3 text-sm">本次耗时：<b>{formatDuration(durationSeconds)}</b></div> : null}<p className="text-sm text-muted-foreground">已产生的节点评分已经直接写入 FSRS；结束练习不会推进任何旧复习阶段。</p>{error ? <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}<Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} maxLength={500} placeholder="复盘一句（可选）" /></div><div className="flex justify-end gap-3 border-t px-6 py-4"><Button variant="outline" disabled={submitting} onClick={onCancel}>返回练习</Button>{error && onRetry ? <Button onClick={onRetry}>重新提交</Button> : <Button disabled={submitting} onClick={() => onConfirm(note.trim())}>{submitting ? '正在保存…' : '确认完成'}</Button>}</div></DialogContent></Dialog>
}
