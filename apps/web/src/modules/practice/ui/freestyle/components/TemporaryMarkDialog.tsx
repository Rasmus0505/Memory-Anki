import { useCallback, useEffect, useMemo, useState, type ComponentProps } from 'react'
import { LoaderCircle, X } from 'lucide-react'
import { toast } from '@/shared/feedback/toast'
import { appConfirm } from '@/shared/components/ui/native-dialog'
import { Button } from '@/shared/components/ui/button'
import { MindMapEditorSurface } from '@/modules/content/public'
import {
  getPalaceEditorApi,
  readMindMapEditorState,
  savePalaceEditorApi,
} from '@/modules/content/public'
import type { MindMapEditorState } from '@/shared/api/contracts'
import type { MindMapSelection } from '@/modules/content/domain/mindmap-document-entity'
import {
  getFreestyleTemporaryMarksApi,
  replaceFreestyleTemporaryMarksApi,
} from '@/modules/practice/ui/freestyle/api'
import { palaceEditorCache } from '@/modules/practice/ui/freestyle/components/freestyleBranchCardSupport'
import {
  buildEditorParentMap,
  buildSplitMarkStatusChips,
  clearPermanentMarksInDoc,
  collectPermanentMarkUids,
  collectRootUid,
  type EditorDoc,
  togglePermanentMarkInDoc,
} from '@/shared/lib/mindmap-split-marks/splitMarks'
import { cn } from '@/shared/lib/utils'

export type SplitMarkDialogMode = 'temporary' | 'permanent'

function nodeUidFromSelection(nodes: MindMapSelection[]): string | null {
  const node = nodes[0]
  if (!node?.uid) return null
  return String(node.uid)
}

function editorDocFromState(state: MindMapEditorState | null): EditorDoc | null {
  if (!state?.editor_doc || typeof state.editor_doc !== 'object') return null
  return state.editor_doc as EditorDoc
}

/**
 * Shared freestyle mark picker: temporary (API Set) or permanent (editor_doc flags).
 * Topology/levels are identical; only persistence and lifecycle differ.
 */
export function SplitMarkDialog({
  open,
  mode,
  palaceId,
  palaceTitle,
  onClose,
  onConfirmed,
}: {
  open: boolean
  mode: SplitMarkDialogMode
  palaceId: number
  palaceTitle?: string
  onClose: () => void
  onConfirmed: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editorState, setEditorState] = useState<MindMapEditorState | null>(null)
  /** Temporary mode only: selected mark uids. Permanent uses editor_doc flags. */
  const [tempMarked, setTempMarked] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError('')
    setTempMarked(new Set())
    setEditorState(null)

    const load = async () => {
      try {
        if (mode === 'temporary') {
          const [editorResponse, marksResponse] = await Promise.all([
            getPalaceEditorApi(palaceId),
            getFreestyleTemporaryMarksApi(palaceId),
          ])
          if (cancelled) return
          setEditorState(readMindMapEditorState(editorResponse))
          const active = (marksResponse.active_root_uids || []).filter(Boolean)
          setTempMarked(new Set(active))
        } else {
          const editorResponse = await getPalaceEditorApi(palaceId)
          if (cancelled) return
          setEditorState(readMindMapEditorState(editorResponse))
        }
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : '加载宫殿失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [open, palaceId, mode])

  const doc = useMemo(() => editorDocFromState(editorState), [editorState])
  const rootUid = useMemo(() => collectRootUid(doc), [doc])
  const parentMap = useMemo(() => buildEditorParentMap(doc), [doc])

  const markedUids = useMemo(() => {
    if (mode === 'temporary') return Array.from(tempMarked)
    return collectPermanentMarkUids(doc)
  }, [mode, tempMarked, doc])

  const markedCount = markedUids.length

  const statusChipsByNodeUid = useMemo(
    () => buildSplitMarkStatusChips(markedUids, parentMap, rootUid),
    [markedUids, parentMap, rootUid],
  )

  const highlightedNodeUids = useMemo(
    () => Object.keys(statusChipsByNodeUid),
    [statusChipsByNodeUid],
  )

  const handleNodeClick = useCallback(
    (nodes: MindMapSelection[]) => {
      const uid = nodeUidFromSelection(nodes)
      if (!uid || uid === rootUid) return
      if (mode === 'temporary') {
        setTempMarked((current) => {
          const next = new Set(current)
          if (next.has(uid)) next.delete(uid)
          else next.add(uid)
          return next
        })
        return
      }
      if (!editorState || !doc) return
      const result = togglePermanentMarkInDoc(doc, uid)
      if (result.doc === doc) return
      setEditorState({
        ...editorState,
        editor_doc: result.doc as MindMapEditorState['editor_doc'],
      })
    },
    [rootUid, mode, editorState, doc],
  )

  const handleClear = useCallback(() => {
    if (mode === 'temporary') {
      setTempMarked(new Set())
      return
    }
    if (!editorState || !doc) return
    setEditorState({
      ...editorState,
      editor_doc: clearPermanentMarksInDoc(doc) as MindMapEditorState['editor_doc'],
    })
  }, [mode, editorState, doc])

  const handleConfirm = useCallback(async () => {
    if (mode === 'temporary') {
      if (tempMarked.size === 0) {
        toast.error('请先点击卡片进行临时标记')
        return
      }
      const confirmed = await appConfirm(
        `将永久统一这 ${tempMarked.size} 个标记点及其子树的复习进度为平均值，并改写当前宫殿的随心拆分，直到每个标记支成功「记得/轻松」结算一次。确定继续？`,
        { title: '确认临时标记', tone: 'danger' },
      )
      if (!confirmed) return
      setSaving(true)
      try {
        const result = await replaceFreestyleTemporaryMarksApi(palaceId, {
          node_uids: Array.from(tempMarked),
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
        palaceEditorCache.delete(palaceId)
        onConfirmed()
        onClose()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '保存临时标记失败')
      } finally {
        setSaving(false)
      }
      return
    }

    if (!editorState) {
      toast.error('宫殿尚未加载完成')
      return
    }
    setSaving(true)
    try {
      await savePalaceEditorApi(palaceId, {
        editor_doc: editorState.editor_doc,
        editor_config: editorState.editor_config,
        editor_local_config: editorState.editor_local_config,
        lang: editorState.lang,
        editor_source: 'practice_edit',
        expected_editor_fingerprint: editorState.editor_fingerprint ?? null,
      })
      toast.success(
        markedCount > 0
          ? `永久标记已保存（${markedCount} 处，层级自动）`
          : '已清除永久标记并保存',
      )
      palaceEditorCache.delete(palaceId)
      onConfirmed()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存永久标记失败')
    } finally {
      setSaving(false)
    }
  }, [
    mode,
    tempMarked,
    palaceId,
    onConfirmed,
    onClose,
    editorState,
    markedCount,
  ])

  if (!open) return null

  const isTemporary = mode === 'temporary'
  const title = isTemporary ? '临时标记' : '永久标记'
  const subtitleHint = isTemporary
    ? '临时 · 评分后消除 · 点击卡片标记/取消 · 确认后统一进度'
    : '永久 · 写入宫殿文档 · 点击卡片标记/取消 · 层级按祖先自动推导'
  const confirmLabel = isTemporary
    ? '完成并统一进度'
    : markedCount === 0
      ? '清除并保存'
      : '保存永久标记'
  const confirmDisabled = saving || (isTemporary && markedCount === 0)

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-zinc-950/80 p-3 backdrop-blur-sm sm:p-6">
      <div
        className={cn(
          'flex h-[min(92vh,900px)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/12 bg-zinc-950 shadow-2xl',
        )}
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-zinc-50">{title}</div>
            <div className="truncate text-xs text-zinc-400">
              {palaceTitle || `宫殿 ${palaceId}`} · {subtitleHint}
            </div>
          </div>
          <div className="text-xs tabular-nums text-amber-300">已标 {markedCount}</div>
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
            disabled={saving || markedCount === 0}
            onClick={handleClear}
          >
            清除选择
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>
              取消
            </Button>
            <Button type="button" disabled={confirmDisabled} onClick={() => void handleConfirm()}>
              {saving ? (
                <>
                  <LoaderCircle className="mr-2 size-4 animate-spin" />
                  处理中…
                </>
              ) : (
                confirmLabel
              )}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  )
}

/** Back-compat wrapper for freestyle temporary marks. */
export function TemporaryMarkDialog(
  props: Omit<ComponentProps<typeof SplitMarkDialog>, 'mode'>,
) {
  return <SplitMarkDialog {...props} mode="temporary" />
}

export function PermanentMarkDialog(
  props: Omit<ComponentProps<typeof SplitMarkDialog>, 'mode'>,
) {
  return <SplitMarkDialog {...props} mode="permanent" />
}
