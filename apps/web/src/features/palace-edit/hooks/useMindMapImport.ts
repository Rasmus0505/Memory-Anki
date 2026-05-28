import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent } from 'react'
import { toast } from 'sonner'
import type {
  ImageTextPreviewResponse,
  MindMapEditorState,
  MindMapImportSourceTree,
  MindMapImportPreviewResponse,
  PdfImportOptions,
  PdfPageSummary,
  SubjectDocumentSummary,
} from '@/shared/api/contracts'
import {
  deleteSubjectDocumentApi,
  getSubjectDocumentPagesApi,
  getSubjectDocumentsApi,
  uploadSubjectDocumentApi,
} from '@/shared/api/modules/knowledge'
import {
  buildPdfImportOptionsFromSettings,
  getReviewSettingsApi,
  updateReviewSettingsApi,
} from '@/shared/api/modules/profile'
import {
  previewImageTextApi,
  previewMindMapBatchImportApi,
  previewMindMapImportApi,
  previewMindMapPdfImportApi,
  previewPdfTextApi,
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

function uniqueSortedPages(values: number[]) {
  return Array.from(new Set(values.filter((value) => Number.isInteger(value) && value > 0))).sort((left, right) => left - right)
}

function serializePageSelection(values: number[]) {
  return uniqueSortedPages(values).join(', ')
}

function parsePageSelectionInput(value: string, maxPage: number | null): { pages: number[]; error: string } {
  const normalized = value.trim()
  if (!normalized) {
    return { pages: [], error: '' }
  }
  const segments = normalized
    .split(/[，,]/)
    .map((segment) => segment.trim())
    .filter(Boolean)
  const pages: number[] = []
  for (const segment of segments) {
    if (/^\d+$/.test(segment)) {
      pages.push(Number(segment))
      continue
    }
    const rangeMatch = segment.match(/^(\d+)\s*-\s*(\d+)$/)
    if (rangeMatch) {
      const start = Number(rangeMatch[1])
      const end = Number(rangeMatch[2])
      if (start > end) {
        return { pages: [], error: '页码范围格式无效，请使用从小到大的范围，例如 3-6。' }
      }
      for (let page = start; page <= end; page += 1) {
        pages.push(page)
      }
      continue
    }
    return { pages: [], error: '页码格式无效，请使用 1,3-5 这样的格式。' }
  }
  const normalizedPages = uniqueSortedPages(pages)
  if (normalizedPages.some((page) => page <= 0)) {
    return { pages: [], error: '页码必须从 1 开始。' }
  }
  if (maxPage != null && normalizedPages.some((page) => page > maxPage)) {
    return { pages: [], error: `存在超出 PDF 总页数的页码，当前资料共 ${maxPage} 页。` }
  }
  return { pages: normalizedPages, error: '' }
}

const PDF_IMPORT_UI_STATE_PREFIX = 'mindmap_import_pdf_ui_'

interface PersistedPdfUiState {
  previewPageByDocument?: Record<string, number>
  analyzedPagesByDocument?: Record<string, number[]>
}

function pdfUiStateKey(entityKey: string) {
  return `${PDF_IMPORT_UI_STATE_PREFIX}${entityKey}`
}

function loadPersistedPdfUiState(entityKey: string | null): PersistedPdfUiState {
  if (!entityKey) return {}
  try {
    const raw = localStorage.getItem(pdfUiStateKey(entityKey))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as PersistedPdfUiState
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function savePersistedPdfUiState(entityKey: string | null, nextState: PersistedPdfUiState) {
  if (!entityKey) return
  try {
    localStorage.setItem(pdfUiStateKey(entityKey), JSON.stringify(nextState))
  } catch {
    // Ignore persistence failures and keep current-session behavior.
  }
}

interface UseMindMapImportOptions {
  entityKey: string | null
  editorState: MindMapEditorState | null
  setEditorState: (nextState: MindMapEditorState) => void
  selectedNodeUid?: string | null
  subjectOptions?: ImportSubjectOption[]
  defaultSubjectId?: number | null
}

export type ImportMode = 'mindmap' | 'text'
export type MindMapImportWorkflow = 'single' | 'batch'
export type ImportSourceKind = 'image-single' | 'image-batch' | 'subject-pdf'
type BatchImportStatus = 'idle' | 'ready' | 'loading' | 'success' | 'error'

export interface BatchImportImageItem {
  id: string
  file: File
  previewUrl: string
  name: string
}

export interface ImportSubjectOption {
  id: number
  name: string
}

export function useMindMapImport({
  entityKey,
  editorState,
  setEditorState,
  selectedNodeUid = null,
  subjectOptions = [],
  defaultSubjectId = null,
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
  const [mode, setModeState] = useState<ImportMode>('mindmap')
  const [sourceKind, setSourceKindState] = useState<ImportSourceKind>('image-single')
  const [mindMapWorkflow, setMindMapWorkflowState] = useState<MindMapImportWorkflow>('single')
  const [batchImages, setBatchImages] = useState<BatchImportImageItem[]>([])
  const [structureImageId, setStructureImageId] = useState<string | null>(null)
  const [batchStatus, setBatchStatus] = useState<BatchImportStatus>('idle')
  const [lastBatchMeta, setLastBatchMeta] = useState<{ structureImageIndex: number; imageCount: number } | null>(null)
  const [subjectDocuments, setSubjectDocuments] = useState<SubjectDocumentSummary[]>([])
  const [subjectDocumentsLoading, setSubjectDocumentsLoading] = useState(false)
  const [selectedSubjectId, setSelectedSubjectId] = useState<number | null>(
    defaultSubjectId ?? subjectOptions[0]?.id ?? null,
  )
  const [selectedSubjectDocumentId, setSelectedSubjectDocumentId] = useState<number | null>(null)
  const [pdfPageMeta, setPdfPageMeta] = useState<PdfPageSummary[]>([])
  const [pdfPagesLoading, setPdfPagesLoading] = useState(false)
  const [selectedPdfPages, setSelectedPdfPages] = useState<number[]>([])
  const [pdfPageInput, setPdfPageInputState] = useState('')
  const [pdfSelectionError, setPdfSelectionError] = useState('')
  const [structurePage, setStructurePage] = useState<number | null>(null)
  const [pdfPreviewPage, setPdfPreviewPageState] = useState<number | null>(null)
  const [analyzedPdfPages, setAnalyzedPdfPages] = useState<number[]>([])
  const [rangePrompt, setRangePrompt] = useState('')
  const [pdfImportOptions, setPdfImportOptions] = useState<PdfImportOptions>({
    strict_restore: true,
    quote_original_text_only: true,
    mount_on_original_leaf_only: true,
    preserve_emphasis_marks: true,
    semantic_split_long_paragraphs: true,
    preserve_line_breaks: true,
  })
  const [importWarnings, setImportWarnings] = useState<string[]>([])
  const [importCanApply, setImportCanApply] = useState(true)
  const [importMatchMode, setImportMatchMode] = useState<'strict_match' | 'approximate_match'>('strict_match')
  const activeHistoryIdRef = useRef<string | null>(null)
  const batchImagesRef = useRef<BatchImportImageItem[]>([])

  const maxPdfPage = useMemo(() => (pdfPageMeta.length > 0 ? pdfPageMeta.length : null), [pdfPageMeta.length])
  const selectedDocumentStorageKey = useMemo(
    () => (selectedSubjectDocumentId != null ? String(selectedSubjectDocumentId) : null),
    [selectedSubjectDocumentId],
  )

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

  useEffect(() => {
    if (mode === 'text' && sourceKind === 'image-batch') {
      setSourceKindState('image-single')
      setMindMapWorkflowState('single')
    }
  }, [mode, sourceKind])

  useEffect(() => {
    let cancelled = false
    const loadImportDefaults = async () => {
      try {
        const settings = await getReviewSettingsApi()
        if (cancelled) return
        setPdfImportOptions(buildPdfImportOptionsFromSettings(settings))
      } catch {
        if (cancelled) return
        setPdfImportOptions(buildPdfImportOptionsFromSettings(null))
      }
    }
    void loadImportDefaults()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (subjectOptions.length === 0) {
      setSelectedSubjectId(null)
      return
    }
    const validIds = new Set(subjectOptions.map((item) => item.id))
    if (defaultSubjectId && validIds.has(defaultSubjectId)) {
      setSelectedSubjectId((current) => (current === defaultSubjectId ? current : defaultSubjectId))
      return
    }
    setSelectedSubjectId((current) => (current != null && validIds.has(current) ? current : subjectOptions[0]?.id ?? null))
  }, [defaultSubjectId, subjectOptions])

  useEffect(() => {
    if (!selectedSubjectId) {
      setSubjectDocuments([])
      setSelectedSubjectDocumentId(null)
      return
    }
    let cancelled = false
    const loadDocuments = async () => {
      setSubjectDocumentsLoading(true)
      try {
        const result = await getSubjectDocumentsApi(selectedSubjectId)
        if (cancelled) return
        setSubjectDocuments(result.items || [])
        setSelectedSubjectDocumentId((current) =>
          current != null && (result.items || []).some((item) => item.id === current)
            ? current
            : (result.items?.[0]?.id ?? null),
        )
      } catch (nextError) {
        if (cancelled) return
        setSubjectDocuments([])
        setSelectedSubjectDocumentId(null)
        setError(formatMindMapImportError(nextError instanceof Error ? nextError.message : '加载学科 PDF 资料失败。'))
      } finally {
        if (!cancelled) {
          setSubjectDocumentsLoading(false)
        }
      }
    }
    void loadDocuments()
    return () => {
      cancelled = true
    }
  }, [selectedSubjectId])

  useEffect(() => {
    if (!selectedSubjectId || !selectedSubjectDocumentId) {
      setPdfPageMeta([])
      setSelectedPdfPages([])
      setPdfPageInputState('')
      setPdfSelectionError('')
      setStructurePage(null)
      setPdfPreviewPageState(null)
      setAnalyzedPdfPages([])
      return
    }
    let cancelled = false
    const loadPages = async () => {
      setPdfPagesLoading(true)
      try {
        const result = await getSubjectDocumentPagesApi(selectedSubjectId, selectedSubjectDocumentId)
        if (cancelled) return
        const persistedState = loadPersistedPdfUiState(entityKey)
        const persistedPreviewPage =
          persistedState.previewPageByDocument?.[String(selectedSubjectDocumentId)] ?? null
        const persistedAnalyzedPages =
          persistedState.analyzedPagesByDocument?.[String(selectedSubjectDocumentId)] ?? []
        setPdfPageMeta(result.pages || [])
        setSelectedPdfPages((current) => current.filter((page) => page <= (result.page_count || 0)))
        setPdfPreviewPageState(() => {
          if (
            persistedPreviewPage != null &&
            persistedPreviewPage >= 1 &&
            persistedPreviewPage <= (result.page_count || 0)
          ) {
            return persistedPreviewPage
          }
          return result.pages?.[0]?.page_number ?? null
        })
        setAnalyzedPdfPages(
          uniqueSortedPages((persistedAnalyzedPages || []).filter((page) => page <= (result.page_count || 0))),
        )
      } catch (nextError) {
        if (cancelled) return
        setPdfPageMeta([])
        setSelectedPdfPages([])
        setPdfPageInputState('')
        setPdfSelectionError('')
        setStructurePage(null)
        setPdfPreviewPageState(null)
        setAnalyzedPdfPages([])
        setError(formatMindMapImportError(nextError instanceof Error ? nextError.message : '加载 PDF 页面失败。'))
      } finally {
        if (!cancelled) {
          setPdfPagesLoading(false)
        }
      }
    }
    void loadPages()
    return () => {
      cancelled = true
    }
  }, [selectedSubjectDocumentId, selectedSubjectId])

  useEffect(() => {
    setPdfPageInputState(serializePageSelection(selectedPdfPages))
    if (selectedPdfPages.length === 0) {
      setStructurePage(null)
      return
    }
    setStructurePage((current) => (current != null && selectedPdfPages.includes(current) ? current : selectedPdfPages[0]))
  }, [selectedPdfPages])

  useEffect(() => {
    if (!entityKey || !selectedDocumentStorageKey || pdfPreviewPage == null) return
    const currentState = loadPersistedPdfUiState(entityKey)
    savePersistedPdfUiState(entityKey, {
      ...currentState,
      previewPageByDocument: {
        ...(currentState.previewPageByDocument || {}),
        [selectedDocumentStorageKey]: pdfPreviewPage,
      },
    })
  }, [entityKey, pdfPreviewPage, selectedDocumentStorageKey])

  const setPdfPreviewPage = (pageNumber: number | null) => {
    setPdfPreviewPageState(pageNumber)
  }

  const persistAnalyzedPdfPages = (documentId: number, pages: number[]) => {
    if (!entityKey) return
    const currentState = loadPersistedPdfUiState(entityKey)
    savePersistedPdfUiState(entityKey, {
      ...currentState,
      analyzedPagesByDocument: {
        ...(currentState.analyzedPagesByDocument || {}),
        [String(documentId)]: uniqueSortedPages(pages),
      },
    })
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen && entityKey) {
      setHistory(loadImportHistory(entityKey))
    }
    setOpen(nextOpen)
  }

  const resetMindMapPreview = () => {
    setSourceTree(null)
    setImportEditorDoc(null)
    setImagePreviewUrl('')
    setLastBatchMeta(null)
    activeHistoryIdRef.current = null
  }

  const clearPreview = () => {
    activeHistoryIdRef.current = null
    setSourceTree(null)
    setImportEditorDoc(null)
    setExtractedText('')
    setImagePreviewUrl('')
    setError('')
    setImportWarnings([])
    setImportCanApply(true)
    setImportMatchMode('strict_match')
    setLastBatchMeta(null)
    setBatchStatus(batchImages.length > 0 ? 'ready' : 'idle')
  }

  const setImportPdfOption = async (key: keyof PdfImportOptions, value: boolean) => {
    const nextOptions = { ...pdfImportOptions, [key]: value }
    setPdfImportOptions(nextOptions)
    try {
      await updateReviewSettingsApi({
        import_pdf_strict_restore_default: String(nextOptions.strict_restore),
        import_pdf_quote_original_default: String(nextOptions.quote_original_text_only),
        import_pdf_mount_leaf_only_default: String(nextOptions.mount_on_original_leaf_only),
        import_pdf_preserve_emphasis_default: String(nextOptions.preserve_emphasis_marks),
        import_pdf_semantic_split_default: String(nextOptions.semantic_split_long_paragraphs),
        import_pdf_preserve_line_breaks_default: String(nextOptions.preserve_line_breaks),
      })
    } catch {
      toast.error('导入默认配置保存失败，本次设置仅在当前会话中生效。')
    }
  }

  const refreshSubjectDocuments = async (preferredDocumentId?: number | null) => {
    if (!selectedSubjectId) return
    const result = await getSubjectDocumentsApi(selectedSubjectId)
    setSubjectDocuments(result.items || [])
    setSelectedSubjectDocumentId((current) => {
      if (preferredDocumentId != null && (result.items || []).some((item) => item.id === preferredDocumentId)) {
        return preferredDocumentId
      }
      return current != null && (result.items || []).some((item) => item.id === current)
        ? current
        : (result.items?.[0]?.id ?? null)
    })
  }

  const saveImportHistoryItem = (payload: {
    response: MindMapImportPreviewResponse
    previewUrl: string
    importMode: 'single' | 'batch' | 'pdf'
    imageCount: number
  }) => {
    if (!entityKey || !payload.response.source_tree) return
    const saved = saveImportHistory(entityKey, {
      title: payload.response.source_tree.title || '',
      nodeCount: countSourceTreeNodes(payload.response.source_tree.children || []),
      sourceTree: payload.response.source_tree,
      editorDoc: payload.response.editor_doc ?? null,
      imagePreviewUrl: payload.previewUrl,
      importMode: payload.importMode,
      imageCount: payload.imageCount,
    })
    activeHistoryIdRef.current = saved.item.id
    setHistory(saved.history)
    if (!saved.persisted) {
      toast.warning('这次识别结果已生成，但本地历史记录空间不足，当前会话内仍可继续覆盖或追加。')
    }
  }

  const setImportMode = (nextMode: ImportMode) => {
    setModeState(nextMode)
    setError('')
    if (nextMode === 'text' && sourceKind === 'image-batch') {
      setSourceKindState('image-single')
      setMindMapWorkflowState('single')
    }
  }

  const setImportSourceKind = (nextSourceKind: ImportSourceKind) => {
    setSourceKindState(nextSourceKind)
    if (nextSourceKind === 'image-single') {
      setMindMapWorkflowState('single')
    } else if (nextSourceKind === 'image-batch') {
      setMindMapWorkflowState('batch')
    }
    setError('')
    resetMindMapPreview()
    setExtractedText('')
  }

  const handleMindMapWorkflowChange = (workflow: MindMapImportWorkflow) => {
    setMindMapWorkflowState(workflow)
    setSourceKindState(workflow === 'batch' ? 'image-batch' : 'image-single')
    setError('')
    resetMindMapPreview()
    setExtractedText('')
    setLastBatchMeta(null)
    setBatchStatus(workflow === 'batch' && batchImages.length > 0 ? 'ready' : 'idle')
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
      saveImportHistoryItem({
        response: result,
        previewUrl: url,
        importMode: 'single',
        imageCount: 1,
      })
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

  const appendBatchFiles = (files: File[]) => {
    if (!files.length) return
    setError('')
    setExtractedText('')
    resetMindMapPreview()
    setBatchImages((current) => {
      const next = [...current, ...files.map(createBatchImageItem)]
      const currentStructureId = structureImageId || current[0]?.id || null
      setStructureImageId(
        currentStructureId && next.some((item) => item.id === currentStructureId)
          ? currentStructureId
          : (next[0]?.id ?? null),
      )
      setBatchStatus(next.length > 0 ? 'ready' : 'idle')
      return next
    })
  }

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (sourceKind === 'subject-pdf') return
    const items = event.clipboardData?.items
    if (!items) return
    const imageFiles: File[] = []
    for (const item of Array.from(items)) {
      if (!item.type.startsWith('image/')) continue
      const file = item.getAsFile()
      if (file) imageFiles.push(file)
    }
    if (imageFiles.length === 0) return
    if (mode === 'text' || sourceKind === 'image-single') {
      void handleImportImage(imageFiles[0])
      return
    }
    appendBatchFiles(imageFiles)
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (sourceKind === 'subject-pdf') {
      event.target.value = ''
      return
    }
    const files = Array.from(event.target.files || [])
    if (files.length > 0) {
      if (mode === 'text' || sourceKind === 'image-single') {
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
        { structureImageIndex: resolvedStructureIndex },
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
      saveImportHistoryItem({
        response: result,
        previewUrl: structureItem?.previewUrl ?? '',
        importMode: 'batch',
        imageCount: result.image_count ?? batchImages.length,
      })
    } catch (nextError) {
      setError(formatMindMapImportError(nextError instanceof Error ? nextError.message : '网络异常，请检查网络后重试。'))
      setBatchStatus('error')
    } finally {
      setLoading(false)
    }
  }

  const setPdfPageInput = (value: string) => {
    setPdfPageInputState(value)
    const parsed = parsePageSelectionInput(value, maxPdfPage)
    setPdfSelectionError(parsed.error)
    if (!parsed.error) {
      setSelectedPdfPages(parsed.pages)
    }
  }

  const togglePdfPage = (pageNumber: number) => {
    setError('')
    setPdfPreviewPageState(pageNumber)
    setSelectedPdfPages((current) =>
      current.includes(pageNumber)
        ? current.filter((page) => page !== pageNumber)
        : uniqueSortedPages([...current, pageNumber]),
    )
    setPdfSelectionError('')
  }

  const handlePdfImportStart = async () => {
    if (!selectedSubjectDocumentId) {
      setError('请先选择一份学科 PDF 资料。')
      return
    }
    if (pdfSelectionError) {
      setError(pdfSelectionError)
      return
    }
    if (selectedPdfPages.length === 0) {
      setError('请先选择至少一页 PDF。')
      return
    }
    if (mode === 'mindmap' && !structurePage) {
      setError('请先指定当前脑图识别使用的结构页。')
      return
    }

    setLoading(true)
    setError('')
    setSourceTree(null)
    setImportEditorDoc(null)
    setExtractedText('')
    setLastBatchMeta(null)
    activeHistoryIdRef.current = null
    setImportWarnings([])
    setImportCanApply(true)
    setImportMatchMode('strict_match')

    const selectedDocument = subjectDocuments.find((item) => item.id === selectedSubjectDocumentId) ?? null
    const previewPage = pdfPageMeta.find((page) => page.page_number === (structurePage ?? selectedPdfPages[0])) ?? pdfPageMeta[0]
    const previewUrl = previewPage?.preview_url || previewPage?.thumbnail_url || ''

    try {
      if (mode === 'text') {
        const result: ImageTextPreviewResponse = await previewPdfTextApi({
          subject_document_id: selectedSubjectDocumentId,
          page_selection: selectedPdfPages,
          range_prompt: rangePrompt.trim(),
        })
      if (!result.ok || !result.extracted_text) {
        setError(formatMindMapImportError(result.error))
        return
      }
        setImagePreviewUrl(previewUrl)
        setPdfPreviewPageState(structurePage ?? selectedPdfPages[0] ?? null)
        const nextAnalyzedPages = uniqueSortedPages([...analyzedPdfPages, ...selectedPdfPages])
        setAnalyzedPdfPages(nextAnalyzedPages)
        persistAnalyzedPdfPages(selectedSubjectDocumentId, nextAnalyzedPages)
        setExtractedText(result.extracted_text)
        return
      }

      const result = await previewMindMapPdfImportApi({
        subject_document_id: selectedSubjectDocumentId,
        page_selection: selectedPdfPages,
        structure_page: structurePage,
        range_prompt: rangePrompt.trim(),
        fallback_title: selectedDocument?.original_name || '未命名宫殿',
        import_options: pdfImportOptions,
      })
      if (!result.ok || !result.source_tree) {
        setError(formatMindMapImportError(result.error))
        return
      }
      setSourceTree(result.source_tree)
      setImportEditorDoc(result.editor_doc ?? null)
      setImagePreviewUrl(previewUrl)
      setPdfPreviewPageState(structurePage ?? selectedPdfPages[0] ?? null)
      setImportWarnings(result.warnings || [])
      setImportCanApply(result.can_apply !== false)
      setImportMatchMode(result.match_mode === 'approximate_match' ? 'approximate_match' : 'strict_match')
      const nextAnalyzedPages = uniqueSortedPages([...analyzedPdfPages, ...selectedPdfPages])
      setAnalyzedPdfPages(nextAnalyzedPages)
      persistAnalyzedPdfPages(selectedSubjectDocumentId, nextAnalyzedPages)
      saveImportHistoryItem({
        response: result,
        previewUrl,
        importMode: 'pdf',
        imageCount: selectedPdfPages.length,
      })
    } catch (nextError) {
      setError(formatMindMapImportError(nextError instanceof Error ? nextError.message : '网络异常，请检查网络后重试。'))
    } finally {
      setLoading(false)
    }
  }

  const applyImport = (applyMode: 'replace' | 'append') => {
    if (!importCanApply) {
      setError('当前结果是近似草稿预览，不能直接覆盖或追加到正式脑图。')
      return
    }
    setApplying(true)
    setError('')
    const applied = applyImportedEditorState({
      editorState,
      importedDoc: importEditorDoc,
      mode: applyMode,
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
    toast.success(applyMode === 'replace' ? '已覆盖当前脑图' : '已追加到选中节点')
  }

  const handleApplyReplace = () => applyImport('replace')
  const handleApplyAppend = () => applyImport('append')

  const handleSelectHistory = (item: ImportHistoryItem) => {
    setModeState('mindmap')
    setSourceKindState(item.importMode === 'batch' ? 'image-batch' : item.importMode === 'pdf' ? 'subject-pdf' : 'image-single')
    setMindMapWorkflowState(item.importMode === 'batch' ? 'batch' : 'single')
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

  const handleSubjectDocumentUpload = async (file: File) => {
    if (!selectedSubjectId) {
      throw new Error('请先选择学科。')
    }
    const document = await uploadSubjectDocumentApi(selectedSubjectId, file)
    await refreshSubjectDocuments(document.id)
    toast.success('PDF 资料已上传')
    return document
  }

  const handleSubjectDocumentDelete = async (documentId: number) => {
    if (!selectedSubjectId) return
    await deleteSubjectDocumentApi(selectedSubjectId, documentId)
    if (selectedSubjectDocumentId === documentId) {
      setSelectedSubjectDocumentId(null)
      setPdfPageMeta([])
      setSelectedPdfPages([])
      setPdfPageInputState('')
      setPdfSelectionError('')
      setStructurePage(null)
    }
    await refreshSubjectDocuments()
    toast.success('PDF 资料已删除')
  }

  return {
    importOpen: open,
    setImportOpen: handleOpenChange,
    importMode: mode,
    setImportMode,
    importSourceKind: sourceKind,
    setImportSourceKind,
    mindMapImportWorkflow: mindMapWorkflow,
    setMindMapImportWorkflow: handleMindMapWorkflowChange,
    importLoading: loading,
    importApplying: applying,
    importUndoing: undoing,
    importError: error,
    importSourceTree: sourceTree,
    importPreviewEditorDoc: importEditorDoc,
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
    importSubjectOptions: subjectOptions,
    importSelectedSubjectId: selectedSubjectId,
    setImportSelectedSubjectId: setSelectedSubjectId,
    importSubjectDocuments: subjectDocuments,
    importSubjectDocumentsLoading: subjectDocumentsLoading,
    importSelectedSubjectDocumentId: selectedSubjectDocumentId,
    setImportSelectedSubjectDocumentId: setSelectedSubjectDocumentId,
    importPdfPageMeta: pdfPageMeta,
    importPdfPagesLoading: pdfPagesLoading,
    importPdfPages: selectedPdfPages,
    importPdfPageInput: pdfPageInput,
    setImportPdfPageInput: setPdfPageInput,
    importPdfSelectionError: pdfSelectionError,
    importStructurePage: structurePage,
    setImportStructurePage: setStructurePage,
    importPdfPreviewPage: pdfPreviewPage,
    setImportPdfPreviewPage: setPdfPreviewPage,
    importAnalyzedPdfPages: analyzedPdfPages,
    importRangePrompt: rangePrompt,
    setImportRangePrompt: setRangePrompt,
    importPdfOptions: pdfImportOptions,
    setImportPdfOption,
    importWarnings,
    importCanApply,
    importMatchMode,
    handleSubjectDocumentUpload,
    handleSubjectDocumentDelete,
    refreshSubjectDocuments,
    toggleImportPdfPage: togglePdfPage,
    handleImportPaste: handlePaste,
    handleImportFileChange: handleFileChange,
    handleBatchImportStart,
    handlePdfImportStart,
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
