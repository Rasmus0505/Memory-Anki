import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent } from 'react'
import { toast } from 'sonner'
import type {
  ImageTextPreviewResponse,
  MindMapEditorState,
  MindMapImportSourceTree,
} from '@/shared/api/contracts'
import { previewImageTextApi, previewMindMapImportApi } from '@/shared/api/modules/palaces'
import {
  applyImportedEditorState,
  countSourceTreeNodes,
  deleteImportHistory,
  formatMindMapImportError,
  loadImportHistory,
  restoreImportedEditorState,
  saveImportHistory,
  type ImportHistoryItem,
  type ImportUndoSnapshot,
} from '@/features/palace-edit/model/mindmap-import'

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.readAsDataURL(file)
  })
}

interface UseMindMapImportOptions {
  entityKey: string | null
  editorState: MindMapEditorState | null
  setEditorState: (nextState: MindMapEditorState) => void
  selectedNodeUid?: string | null
}

type ImportMode = 'mindmap' | 'text'

export function useMindMapImport({
  entityKey,
  editorState,
  setEditorState,
  selectedNodeUid = null,
}: UseMindMapImportOptions) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [undoing, setUndoing] = useState(false)
  const [error, setError] = useState('')
  const [sourceTree, setSourceTree] = useState<MindMapImportSourceTree | null>(null)
  const [importEditorDoc, setImportEditorDoc] = useState<MindMapEditorState['editor_doc']>(null)
  const [extractedText, setExtractedText] = useState('')
  const [imagePreviewUrl, setImagePreviewUrl] = useState('')
  const [history, setHistory] = useState<ImportHistoryItem[]>([])
  const [externalSyncKey, setExternalSyncKey] = useState(0)
  const [appliedSyncVersion, setAppliedSyncVersion] = useState(0)
  const [undoSnapshot, setUndoSnapshot] = useState<ImportUndoSnapshot | null>(null)
  const [mode, setMode] = useState<ImportMode>('mindmap')
  const activeHistoryIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!entityKey) {
      setHistory([])
      setUndoSnapshot(null)
      activeHistoryIdRef.current = null
      return
    }
    setHistory(loadImportHistory(entityKey))
  }, [entityKey])

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen && entityKey) {
      setHistory(loadImportHistory(entityKey))
    }
    setOpen(nextOpen)
  }

  const handleImportImage = async (file: File) => {
    setLoading(true)
    setError('')
    setSourceTree(null)
    setImportEditorDoc(null)
    setExtractedText('')
    activeHistoryIdRef.current = null
    try {
      const url = await fileToDataUrl(file)
      setImagePreviewUrl(url)
      if (mode === 'text') {
        const result = await previewImageTextApi(file)
        if (!result.ok || !result.extracted_text) {
          setError(formatMindMapImportError(result.error))
          return
        }
        setExtractedText(result.extracted_text)
        return
      }

      const result = await previewMindMapImportApi(file)
      if (!result.ok || !result.source_tree) {
        setError(formatMindMapImportError(result.error))
        return
      }
      setSourceTree(result.source_tree)
      setImportEditorDoc(result.editor_doc ?? null)
      if (entityKey) {
        const saved = saveImportHistory(entityKey, {
          title: result.source_tree.title || '',
          nodeCount: countSourceTreeNodes(result.source_tree.children || []),
          sourceTree: result.source_tree,
          editorDoc: result.editor_doc ?? null,
          imagePreviewUrl: url,
        })
        activeHistoryIdRef.current = saved.item.id
        setHistory(saved.history)
      }
    } catch (nextError) {
      setError(formatMindMapImportError(nextError instanceof Error ? nextError.message : '网络异常，请检查网络后重试。'))
    } finally {
      setLoading(false)
    }
  }

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const items = event.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (!item.type.startsWith('image/')) continue
      const file = item.getAsFile()
      if (file) {
        void handleImportImage(file)
      }
      return
    }
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      void handleImportImage(file)
    }
    event.target.value = ''
  }

  const applyImport = (mode: 'replace' | 'append') => {
    setApplying(true)
    setError('')
    const applied = applyImportedEditorState({
      editorState,
      importedDoc: importEditorDoc,
      mode,
      targetUid: selectedNodeUid,
      sourceTitle: sourceTree?.title || '',
    })
    if (!applied.applied || !applied.nextEditorState || !applied.undoSnapshot) {
      setApplying(false)
      setError(formatMindMapImportError(applied.error))
      return
    }
    setEditorState(applied.nextEditorState)
    setUndoSnapshot(applied.undoSnapshot)
    setExternalSyncKey((value) => value + 1)
    setAppliedSyncVersion((value) => value + 1)
    setApplying(false)
    setOpen(false)
    toast.success(mode === 'replace' ? '已覆盖当前脑图' : '已追加到选中节点')
  }

  const handleApplyReplace = () => applyImport('replace')
  const handleApplyAppend = () => applyImport('append')

  const handleSelectHistory = (item: ImportHistoryItem) => {
    setMode('mindmap')
    activeHistoryIdRef.current = item.id
    setSourceTree(item.sourceTree)
    setImportEditorDoc(item.editorDoc)
    setExtractedText('')
    setImagePreviewUrl(item.imagePreviewUrl)
    setError('')
  }

  const clearPreview = () => {
    activeHistoryIdRef.current = null
    setSourceTree(null)
    setImportEditorDoc(null)
    setExtractedText('')
    setImagePreviewUrl('')
    setError('')
  }

  const handleDeleteHistory = (id: string) => {
    if (!entityKey) return
    const confirmed = window.confirm('删除这条导入历史后，将不能再从历史中恢复这份草稿。确定删除吗？')
    if (!confirmed) return
    const updated = deleteImportHistory(entityKey, id)
    setHistory(updated)
    if (activeHistoryIdRef.current === id) {
      clearPreview()
    }
    toast.success('导入历史已删除')
  }

  const handleUndoLastImport = () => {
    if (!undoSnapshot || !editorState) return
    setUndoing(true)
    const restored = restoreImportedEditorState(editorState, undoSnapshot)
    if (!restored) {
      setUndoing(false)
      return
    }
    setEditorState(restored)
    setUndoSnapshot(null)
    setExternalSyncKey((value) => value + 1)
    setAppliedSyncVersion((value) => value + 1)
    setUndoing(false)
    toast.success('已撤销最近一次导入')
  }

  return {
    importOpen: open,
    setImportOpen: handleOpenChange,
    importMode: mode,
    setImportMode: setMode,
    importLoading: loading,
    importApplying: applying,
    importUndoing: undoing,
    importError: error,
    importSourceTree: sourceTree,
    importExtractedText: extractedText,
    importImagePreviewUrl: imagePreviewUrl,
    importHistory: history,
    importCanAppend: Boolean(selectedNodeUid),
    importCanUndoLastImport: Boolean(undoSnapshot),
    importExternalSyncKey: externalSyncKey,
    importAppliedSyncVersion: appliedSyncVersion,
    handleImportPaste: handlePaste,
    handleImportFileChange: handleFileChange,
    handleImportApplyReplace: handleApplyReplace,
    handleImportApplyAppend: handleApplyAppend,
    handleImportSelectHistory: handleSelectHistory,
    handleImportDeleteHistory: handleDeleteHistory,
    handleUndoLastImport,
  }
}
