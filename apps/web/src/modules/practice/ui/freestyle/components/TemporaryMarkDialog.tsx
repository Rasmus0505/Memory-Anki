import { useCallback, useEffect, useMemo, useState } from 'react'
import { LoaderCircle, X } from 'lucide-react'
import { toast } from '@/shared/feedback/toast'
import { appConfirm } from '@/shared/components/ui/native-dialog'
import { Button } from '@/shared/components/ui/button'
import { MindMapEditorSurface } from '@/modules/content/public'
import { getPalaceEditorApi, readMindMapEditorState } from '@/modules/content/public'
import type { MindMapEditorState } from '@/shared/api/contracts'
import type { MindMapSelection } from '@/modules/content/domain/mindmap-document-entity'
import {
  replaceFreestyleTemporaryMarksApi,
} from '@/modules/practice/ui/freestyle/api'
import {
  TEMPORARY_MARK_COLOR,
  type EditorDoc,
} from '@/shared/lib/mindmap-split-marks/splitMarks'
import { cn } from '@/shared/lib/utils'

function nodeUidFromSelection(nodes: MindMapSelection[]): string | null {
  const node = nodes[0]
  if (!node?.uid) return null
  return String(node.uid)
}

function collectRootUid(doc: EditorDoc | null | undefined): string | null {
  if (!doc?.root?.data || typeof doc.root.data !== 'object') return null
  const data = doc.root.data as Record<string, unknown>
  return String(data.uid || data.memoryAnkiId || 'root')
}

export function TemporaryMarkDialog({
  open,
  palaceId,
  palaceTitle,
  onClose,
  onConfirmed,
}: {
  open: boolean
  palaceId: number
  palaceTitle?: string
  onClose: () => void
  onConfirmed: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editorState, setEditorState] = useState<MindMapEditorState | null>(null)
  const [marked, setMarked] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError('')
    setMarked(new Set())
    void getPalaceEditorApi(palaceId)
      .then((response) => {
        if (cancelled) return
        setEditorState(readMindMapEditorState(response))
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : '加载宫殿失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, palaceId])

  const rootUid = useMemo(() => {
    const doc = editorState?.editor_doc as EditorDoc | undefined
    return collectRootUid(doc ?? null)
  }, [editorState])

  const highlightedNodeUids = useMemo(() => Array.from(marked), [marked])

  const statusChipsByNodeUid = useMemo(() => {
    const chips: Record<
      string,
      Array<{ text: string; tone: 'warning'; style: 'filled' }>
    > = {}
    for (const uid of marked) {
      chips[uid] = [{ text: TEMPORARY_MARK_COLOR.label, tone: 'warning', style: 'filled' }]
    }
    return chips
  }, [marked])

  const handleNodeClick = useCallback(
    (nodes: MindMapSelection[]) => {
      const uid = nodeUidFromSelection(nodes)
      if (!uid || uid === rootUid) return
      setMarked((current) => {
        const next = new Set(current)
        if (next.has(uid)) next.delete(uid)
        else next.add(uid)
        return next
      })
    },
    [rootUid],
  )

  const handleConfirm = useCallback(async () => {
    if (marked.size === 0) {
      toast.error('请先点击卡片进行临时标记')
      return
    }
    const confirmed = await appConfirm(
      `将永久统一这 ${marked.size} 个标记点及其子树的复习进度为平均值，并改写当前宫殿的随心拆分，直到每个标记支成功「记得/轻松」结算一次。确定继续？`,
      { title: '确认临时标记', tone: 'danger' },
    )
    if (!confirmed) return
    setSaving(true)
    try {
      const result = await replaceFreestyleTemporaryMarksApi(palaceId, {
        node_uids: Array.from(marked),
        unify_progress: true,
        operation_id: `temp-mark-${palaceId}-${Date.now()}`,
      })
      const unify = result.unify
      if (unify?.skipped) {
        toast.success(
          unify.reason === 'no_existing_fsrs'
            ? '临时标记已生效（组内尚无 FSRS 进度，未改写平均）'
            : '临时标记已生效',
        )
      } else {
        toast.success(
          `临时标记已生效，已统一 ${unify?.affected_node_count ?? 0} 个节点进度`,
        )
      }
      onConfirmed()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存临时标记失败')
    } finally {
      setSaving(false)
    }
  }, [marked, onClose, onConfirmed, palaceId])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-zinc-950/80 p-3 backdrop-blur-sm sm:p-6">
      <div
        className={cn(
          'flex h-[min(92vh,900px)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/12 bg-zinc-950 shadow-2xl',
        )}
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-zinc-50">临时标记</div>
            <div className="truncate text-xs text-zinc-400">
              {palaceTitle || `宫殿 ${palaceId}`} · 点击卡片标记/取消 · 确认后永久统一进度
            </div>
          </div>
          <div className="text-xs tabular-nums text-amber-300">已标 {marked.size}</div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="关闭">
            <X className="size-4" />
          </Button>
        </header>

        <div className="relative min-h-0 flex-1 bg-card">
          {loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-zinc-400">
              <LoaderCircle className="size-4 animate-spin" />
              加载完整导图…
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center text-sm text-rose-300">{error}</div>
          ) : editorState ? (
            <MindMapEditorSurface
              editorState={editorState}
              readonly
              className="h-full w-full"
              highlightedNodeUids={highlightedNodeUids}
              statusChipsByNodeUid={statusChipsByNodeUid}
              onNodeClick={handleNodeClick}
              onEditorStateChange={() => {
                /* mark mode is selection-only */
              }}
            />
          ) : null}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-white/10 px-4 py-3">
          <Button
            type="button"
            variant="ghost"
            disabled={saving || marked.size === 0}
            onClick={() => setMarked(new Set())}
          >
            清除选择
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>
              取消
            </Button>
            <Button type="button" disabled={saving || marked.size === 0} onClick={() => void handleConfirm()}>
              {saving ? (
                <>
                  <LoaderCircle className="mr-2 size-4 animate-spin" />
                  处理中…
                </>
              ) : (
                '完成并统一进度'
              )}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  )
}
