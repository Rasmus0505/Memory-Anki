import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent } from 'react'
import { toast } from 'sonner'
import type {
  MindMapEditorState,
  MindMapImportSourceTree,
} from '@/shared/api/contracts'
import {
  previewImageTextApi,
  previewMindMapBatchImportApi,
  previewMindMapImportApi,
} from '@/shared/api/modules/palaces'
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
type MindMapImportWorkflow = 'single' | 'batch'
type BatchImportStatus = 'idle' | 'ready' | 'loading' | 'success' | 'error'

export interface BatchImportImageItem {
  id: string
  file: File
  previewUrl: string
  name: string
}

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
  const [mindMapWorkflow, setMindMapWorkflow] = useState<MindMapImportWorkflow>('single')
  const [batchImages, setBatchImages] = useState<BatchImportImageItem[]>([])
  const [structureImageId, setStructureImageId] = useState<string | null>(null)
  const [batchStatus, setBatchStatus] = useState<BatchImportStatus>('idle')
  const [lastBatchMeta, setLastBatchMeta] = useState<{ structureImageIndex: number; imageCount: number } | null>(null)
  const activeHistoryIdRef = useRef<string | null>(null)
  const batchImagesRef = useRef<BatchImportImageItem[]>([])

  useEffect(() => {
    if (!entityKey) {
      setHistory([])
      setUndoSnapshot(null)
      activeHistoryIdRef.current = null
      return
    }
    setHistory(loadImportHistory(entityKey))
  }, [entityKey])

  useEffect(() => {
    batchImagesRef.current = batchImages
  }, [batchImages])

  useEffect(() => {
    return () => {
      batchImagesRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl))
    }
  }, [])

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen && entityKey) {
      setHistory(loadImportHistory(entityKey))
    }
    setOpen(nextOpen)
  }

  const handleImportImage = async (file: File) => {
    setLoading(true)
    setError('')
    setBatchStatus('idle')
    setSourceTree(null)
    setImportEditorDoc(null)
    setExtractedText('')
    setLastBatchMeta(null)
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
          importMode: 'single',
          imageCount: 1,
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

  const createBatchImageItem = (file: File): BatchImportImageItem => ({
    id: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    file,
    previewUrl: URL.createObjectURL(file),
    name: file.name,
  })

  const resetMindMapPreview = () => {
    setSourceTree(null)
    setImportEditorDoc(null)
    setImagePreviewUrl('')
    setLastBatchMeta(null)
    activeHistoryIdRef.current = null
  }

  const appendBatchFiles = (files: File[]) => {
    if (!files.length) return
    setError('')
    setExtractedText('')
    resetMindMapPreview()
    setBatchImages((current) => {
      const next = [...current, ...files.map(createBatchImageItem)]
      const currentStructureId = structureImageId || current[0]?.id || null
      setStructureImageId(currentStructureId && next.some((item) => item.id === currentStructureId) ? currentStructureId : (next[0]?.id ?? null))
      setBatchStatus(next.length > 0 ? 'ready' : 'idle')
      return next
    })
  }

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const items = event.clipboardData?.items
    if (!items) return
    const imageFiles: File[] = []
    for (const item of items) {
      if (!item.type.startsWith('image/')) continue
      const file = item.getAsFile()
      if (file) {
        imageFiles.push(file)
      }
    }
    if (imageFiles.length === 0) return
    if (mode === 'text' || mindMapWorkflow === 'single') {
      void handleImportImage(imageFiles[0])
      return
    }
    appendBatchFiles(imageFiles)
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    if (files.length > 0) {
      if (mode === 'text' || mindMapWorkflow === 'single') {
        void handleImportImage(files[0])
      } else {
        appendBatchFiles(files)
      }
    }
    event.target.value = ''
  }

  const handleBatchImportStart = async () => {
    if (batchImages.length === 0) {
      setError('请先上传至少一张图片。')
      setBatchStatus('error')
      return
    }
    setLoading(true)
    setBatchStatus('loading')
    setError('')
    setSourceTree(null)
    setImportEditorDoc(null)
    setImagePreviewUrl('')
    setLastBatchMeta(null)
    activeHistoryIdRef.current = null

    const activeStructureId = structureImageId || batchImages[0]?.id || null
    const resolvedStructureIndex = Math.max(0, batchImages.findIndex((item) => item.id === activeStructureId))

    try {
      const result = await previewMindMapBatchImportApi(
        batchImages.map((item) => item.file),
        {
          structureImageIndex: resolvedStructureIndex,
        },
      )
      if (!result.ok || !result.source_tree) {
        setError(formatMindMapImportError(result.error))
        setBatchStatus('error')
        return
      }

      const appliedStructureIndex = result.structure_image_index ?? resolvedStructureIndex
      const structureItem = batchImages[appliedStructureIndex] ?? batchImages[0]
      setSourceTree(result.source_tree)
      setImportEditorDoc(result.editor_doc ?? null)
      setImagePreviewUrl(structureItem?.previewUrl ?? '')
      setLastBatchMeta({
        structureImageIndex: appliedStructureIndex,
        imageCount: result.image_count ?? batchImages.length,
      })
      setBatchStatus('success')

      if (entityKey) {
        const saved = saveImportHistory(entityKey, {
          title: result.source_tree.title || '',
          nodeCount: countSourceTreeNodes(result.source_tree.children || []),
          sourceTree: result.source_tree,
          editorDoc: result.editor_doc ?? null,
          imagePreviewUrl: structureItem?.previewUrl ?? '',
          importMode: 'batch',
          imageCount: result.image_count ?? batchImages.length,
        })
        activeHistoryIdRef.current = saved.item.id
        setHistory(saved.history)
      }
    } catch (nextError) {
      setError(formatMindMapImportError(nextError instanceof Error ? nextError.message : '网络异常，请检查网络后重试。'))
      setBatchStatus('error')
    } finally {
      setLoading(false)
    }
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
    setMindMapWorkflow(item.importMode === 'batch' ? 'batch' : 'single')
    activeHistoryIdRef.current = item.id
    setSourceTree(item.sourceTree)
    setImportEditorDoc(item.editorDoc)
    setExtractedText('')
    setImagePreviewUrl(item.imagePreviewUrl)
    setError('')
    setLastBatchMeta(
      item.importMode === 'batch'
        ? {
            structureImageIndex: 0,
            imageCount: item.imageCount ?? 0,
          }
        : null,
    )
    setBatchStatus(item.importMode === 'batch' ? 'success' : 'idle')
  }

  const clearPreview = () => {
    activeHistoryIdRef.current = null
    setSourceTree(null)
    setImportEditorDoc(null)
    setExtractedText('')
    setImagePreviewUrl('')
    setError('')
    setLastBatchMeta(null)
    setBatchStatus(batchImages.length > 0 ? 'ready' : 'idle')
  }

  const clearBatchQueue = () => {
    setBatchImages((current) => {
      current.forEach((item) => URL.revokeObjectURL(item.previewUrl))
      return []
    })
    setStructureImageId(null)
    setBatchStatus('idle')
  }

  const handleDeleteBatchImage = (id: string) => {
    setBatchImages((current) => {
      const target = current.find((item) => item.id === id)
      if (target) {
        URL.revokeObjectURL(target.previewUrl)
      }
      const next = current.filter((item) => item.id !== id)
      const nextStructureId = structureImageId === id ? next[0]?.id ?? null : structureImageId
      setStructureImageId(nextStructureId)
      setBatchStatus(next.length > 0 ? 'ready' : 'idle')
      return next
    })
    setError('')
    resetMindMapPreview()
  }

  const handleMoveBatchImage = (id: string, direction: 'up' | 'down') => {
    setBatchImages((current) => {
      const index = current.findIndex((item) => item.id === id)
      if (index === -1) return current
      const targetIndex = direction === 'up' ? index - 1 : index + 1
      if (targetIndex < 0 || targetIndex >= current.length) return current
      const next = [...current]
      const [item] = next.splice(index, 1)
      next.splice(targetIndex, 0, item)
      return next
    })
    setError('')
    resetMindMapPreview()
    setBatchStatus('ready')
  }

  const handleSetStructureImage = (id: string) => {
    setStructureImageId(id)
    setError('')
    resetMindMapPreview()
    setBatchStatus(batchImages.length > 0 ? 'ready' : 'idle')
  }

  const handleMindMapWorkflowChange = (workflow: MindMapImportWorkflow) => {
    setMindMapWorkflow(workflow)
    setError('')
    setSourceTree(null)
    setImportEditorDoc(null)
    setImagePreviewUrl('')
    setLastBatchMeta(null)
    if (workflow === 'single') {
      setBatchStatus('idle')
    } else {
      setBatchStatus(batchImages.length > 0 ? 'ready' : 'idle')
    }
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
    mindMapImportWorkflow: mindMapWorkflow,
    setMindMapImportWorkflow: handleMindMapWorkflowChange,
    importLoading: loading,
    importApplying: applying,
    importUndoing: undoing,
    importError: error,
    importSourceTree: sourceTree,
    importExtractedText: extractedText,
    importImagePreviewUrl: imagePreviewUrl,
    importHistory: history,
    importBatchImages: batchImages,
    importStructureImageId: structureImageId || batchImages[0]?.id || null,
    importBatchStatus: batchStatus,
    importBatchMeta: lastBatchMeta,
    importCanAppend: Boolean(selectedNodeUid),
    importCanUndoLastImport: Boolean(undoSnapshot),
    importExternalSyncKey: externalSyncKey,
    importAppliedSyncVersion: appliedSyncVersion,
    handleImportPaste: handlePaste,
    handleImportFileChange: handleFileChange,
    handleBatchImportStart,
    handleDeleteBatchImage,
    handleMoveBatchImage,
    handleSetStructureImage,
    clearBatchQueue,
    handleImportApplyReplace: handleApplyReplace,
    handleImportApplyAppend: handleApplyAppend,
    handleImportSelectHistory: handleSelectHistory,
    handleImportDeleteHistory: handleDeleteHistory,
    handleUndoLastImport,
  }
}
