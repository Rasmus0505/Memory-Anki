import { useCallback, useEffect, useMemo, useState } from 'react'
import { LoaderCircle, X } from 'lucide-react'
import { MindMapEditorSurface, type MindMapSelection } from '@/modules/content/public'
import {
  getPalaceEditorApi,
  readMindMapEditorState,
  savePalaceEditorApi,
} from '@/modules/content/public'
import { Button } from '@/shared/components/ui/button'
import type { MindMapEditorState } from '@/shared/api/contracts'
import { toast } from '@/shared/feedback/toast'
import {
  buildEditorParentMap,
  buildSplitMarkStatusChips,
  clearPermanentMarksInDoc,
  collectPermanentMarkUids,
  collectRootUid,
  togglePermanentMarkInDoc,
  type EditorDoc,
} from '@/shared/lib/mindmap-split-marks/splitMarks'
import { palaceEditorCache } from './freestyleBranchCardSupport'

function editorDoc(state: MindMapEditorState | null): EditorDoc | null {
  return state?.editor_doc && typeof state.editor_doc === 'object'
    ? state.editor_doc as EditorDoc
    : null
}

export function PermanentMarkDialog({
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
  const [state, setState] = useState<MindMapEditorState | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    setError('')
    void getPalaceEditorApi(palaceId)
      .then((response) => {
        if (active) setState(readMindMapEditorState(response))
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : '加载宫殿失败')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [open, palaceId])

  const doc = useMemo(() => editorDoc(state), [state])
  const markedUids = useMemo(() => collectPermanentMarkUids(doc), [doc])
  const rootUid = useMemo(() => collectRootUid(doc), [doc])
  const parentMap = useMemo(() => buildEditorParentMap(doc), [doc])
  const chips = useMemo(
    () => buildSplitMarkStatusChips(markedUids, parentMap, rootUid),
    [markedUids, parentMap, rootUid],
  )

  const toggle = useCallback((nodes: MindMapSelection[]) => {
    const uid = nodes[0]?.uid
    if (!uid || !state || !doc) return
    const result = togglePermanentMarkInDoc(doc, String(uid))
    if (result.doc !== doc) setState({ ...state, editor_doc: result.doc })
  }, [doc, state])

  async function save() {
    if (!state) return
    setSaving(true)
    setError('')
    try {
      const response = await savePalaceEditorApi(palaceId, state)
      const saved = readMindMapEditorState(response)
      palaceEditorCache.set(palaceId, Promise.resolve(saved))
      toast.success(markedUids.length ? '永久标记已保存，复习队列已重建' : '永久标记已清除，宫殿已退出复习')
      onConfirmed()
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存永久标记失败')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-zinc-950/80 p-3 backdrop-blur-sm sm:p-6">
      <div className="flex h-[min(92vh,900px)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/12 bg-zinc-950 shadow-2xl">
        <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-zinc-50">永久标记</div>
            <div className="truncate text-xs text-zinc-400">{palaceTitle || `宫殿 ${palaceId}`} · 标记节点会切出独立复习单元，根节点也可标记</div>
          </div>
          <div className="text-xs text-amber-300">已标 {markedUids.length}</div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="关闭"><X className="size-4" /></Button>
        </header>
        <div className="relative min-h-0 flex-1 bg-card">
          {loading ? <div className="flex h-full items-center justify-center gap-2 text-sm text-zinc-400"><LoaderCircle className="size-4 animate-spin" />加载完整导图…</div> : null}
          {error ? <div className="flex h-full items-center justify-center text-sm text-rose-300">{error}</div> : null}
          {!loading && !error && state ? (
            <MindMapEditorSurface
              editorState={state}
              readonly
              className="h-full w-full"
              highlightedNodeUids={Object.keys(chips)}
              statusChipsByNodeUid={chips}
              onNodeClick={toggle}
              onEditorStateChange={() => undefined}
            />
          ) : null}
        </div>
        <footer className="flex items-center justify-between gap-2 border-t border-white/10 px-4 py-3">
          <Button variant="ghost" disabled={saving || !doc || markedUids.length === 0} onClick={() => doc && state && setState({ ...state, editor_doc: clearPermanentMarksInDoc(doc) })}>清除全部</Button>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={saving} onClick={onClose}>取消</Button>
            <Button disabled={saving || !state} onClick={() => void save()}>{saving ? '保存中…' : '保存永久标记'}</Button>
          </div>
        </footer>
      </div>
    </div>
  )
}
