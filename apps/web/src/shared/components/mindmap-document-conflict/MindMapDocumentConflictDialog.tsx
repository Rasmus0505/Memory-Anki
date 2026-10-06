import { useEffect, useMemo, useRef, useState } from 'react'
import type { MindMapEditorState } from '@/shared/api/contracts'
import type { MindMapConflictResolution } from '@/shared/hooks/mindMapDocumentConflict'
import type { MindMapEditorConflict } from '@/shared/persistence/mindmapEditorDraftStore'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { mergeIndependentNodeEdits, summarizeConflictSnapshot } from './conflictModel'

type ConflictWithBaseline = MindMapEditorConflict & { baselineSnapshot?: MindMapEditorState | null }
export interface MindMapDocumentConflictDialogProps {
  pendingConflict: ConflictWithBaseline | null
  resolveConflict: (resolution: MindMapConflictResolution) => Promise<boolean>
}

function SnapshotSummary({ label, snapshot }: { label: string; snapshot: MindMapEditorState | null }) {
  const summary = useMemo(() => summarizeConflictSnapshot(snapshot), [snapshot])
  return <section aria-label={label} className="min-w-0 space-y-2 rounded-lg border p-3">
    <h3 className="font-semibold">{label} · {summary.nodeCount} 个节点</h3>
    <p className="break-words font-medium">{summary.title}</p>
    {summary.readable ? <ul className="max-h-52 space-y-1 overflow-auto text-sm text-muted-foreground">
      {summary.lines.map((line, i) => <li key={i} className="break-words">{line}</li>)}
    </ul> : <p className="text-sm">{snapshot ? '无法生成文本摘要，请下载完整快照检查。' : '尚未取得远端快照。'}</p>}
    {summary.nodeCount > 12 && <p className="text-xs text-muted-foreground">仅展示前 12 个文本摘要，下载包含全部内容。</p>}
  </section>
}

/** The keyed panel retires all pending feedback when owner/operation changes. */
export function MindMapDocumentConflictDialog(props: MindMapDocumentConflictDialogProps) {
  if (!props.pendingConflict) return null
  return <ConflictPanel key={`${props.pendingConflict.ownerId}:${props.pendingConflict.operationId}`}
    conflict={props.pendingConflict} resolveConflict={props.resolveConflict} />
}

function ConflictPanel({ conflict, resolveConflict }: {
  conflict: ConflictWithBaseline
  resolveConflict: MindMapDocumentConflictDialogProps['resolveConflict']
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(true)
  const alive = useRef(true)
  const busyRef = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const merged = useMemo(() => mergeIndependentNodeEdits(conflict.baselineSnapshot, conflict.localSnapshot, conflict.remoteSnapshot), [conflict])
  const recoveryHref = useMemo(() => `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify({
    format: 'memory-anki-document-conflict-v1', ...conflict,
  }, null, 2))}`, [conflict])
  const choose = async (choice: 'local' | 'remote' | 'manual') => {
    if (busyRef.current || (choice === 'manual' && !merged.snapshot)) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const identity = { ownerId: conflict.ownerId, operationId: conflict.operationId }
      const accepted = await resolveConflict(choice === 'manual'
        ? { ...identity, choice, snapshot: merged.snapshot! }
        : { ...identity, choice })
      if (alive.current && !accepted) setError('冲突状态已变化或暂不能处理。双方内容尚未被覆盖，请稍后重试。')
    } catch (cause) {
      if (alive.current) setError(`无法完成冲突归档／处理：${cause instanceof Error ? cause.message : '本地存储不可用。'} 双方内容尚未被覆盖，请先下载双方快照，再恢复存储并重试。`)
    } finally {
      busyRef.current = false
      if (alive.current) setBusy(false)
    }
  }
  return <>
    {!open && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive p-3 text-sm">
      文档存在未解决冲突，自动保存已暂停。
      <Button variant="outline" onClick={() => setOpen(true)}>查看并解决冲突</Button>
    </div>}
    <Dialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next) }}>
      <DialogContent floating={false} className="max-h-[90vh] max-w-3xl overflow-y-auto" dismissOnInteractOutside={false}>
        <DialogHeader>
          <DialogTitle>文档版本冲突</DialogTitle>
          <DialogDescription>本地未保存内容与服务器版本不同。自动保存已暂停；选择前会先归档双方快照。远端指服务器当前版本，并非自动同步设备。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <SnapshotSummary label="本地版本" snapshot={conflict.localSnapshot} />
          <SnapshotSummary label="远端版本" snapshot={conflict.remoteSnapshot} />
        </div>
        <p className="text-sm text-muted-foreground">{merged.reason ?? '共同基线可用：可合并不同 UID 节点上的独立编辑。同一节点或结构变化不会被猜测合并。'}</p>
        {error && <p role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive">{error}</p>}
        <a className="text-sm font-medium text-primary underline" href={recoveryHref}
          download={`mindmap-conflict-${conflict.ownerId}-${conflict.operationId}.json`}>下载双方完整快照（恢复用 JSON）</a>
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>稍后处理</Button>
          <Button variant="outline" disabled={busy || !conflict.remoteSnapshot || !conflict.remoteEditorFingerprint} onClick={() => void choose('local')}>选用本地版本</Button>
          <Button variant="outline" disabled={busy || !conflict.remoteSnapshot || !conflict.remoteEditorFingerprint} onClick={() => void choose('remote')}>选用远端版本</Button>
          <Button disabled={busy || !merged.snapshot || !conflict.remoteEditorFingerprint} onClick={() => void choose('manual')}>{busy ? '正在归档…' : '合并独立节点编辑'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
