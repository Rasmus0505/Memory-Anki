import { useEffect, useMemo, useState } from 'react'
import { toast } from '@/shared/feedback/toast'
import type {
  PdfImportMode,
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
import { formatMindMapImportError } from '@/features/palace-edit/model/mindmap-import'
import type { ImportSubjectOption } from '@/features/palace-edit/model/mindmap-import-types'
import {
  normalizePdfImportMode,
  parsePageSelectionInput,
  serializePageSelection,
  uniqueSortedPages,
} from '@/features/palace-edit/hooks/mindmap-import-utils'

const PDF_IMPORT_UI_STATE_PREFIX = 'mindmap_import_pdf_ui_'

interface PersistedPdfUiState {
  previewPageByDocument?: Record<string, number>
  analyzedPagesByDocument?: Record<string, number[]>
}

function pdfUiStateKey(entityKey: string | null) {
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

interface UsePdfImportControllerOptions {
  entityKey: string | null
  subjectOptions: ImportSubjectOption[]
  defaultSubjectId: number | null
  setError: (value: string) => void
}

export function usePdfImportController({
  entityKey,
  subjectOptions,
  defaultSubjectId,
  setError,
}: UsePdfImportControllerOptions) {
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
  const [pdfImportMode, setPdfImportModeState] = useState<PdfImportMode>('direct_generation')
  const [structurePage, setStructurePage] = useState<number | null>(null)
  const [pdfPreviewPage, setPdfPreviewPageState] = useState<number | null>(null)
  const [analyzedPdfPages, setAnalyzedPdfPages] = useState<number[]>([])
  const [rangePrompt, setRangePrompt] = useState('')
  const [pdfImportOptions, setPdfImportOptions] = useState<PdfImportOptions>({
    quote_original_text_only: true,
    mount_on_original_leaf_only: true,
    preserve_emphasis_marks: true,
    semantic_split_long_paragraphs: true,
    preserve_line_breaks: true,
  })

  const maxPdfPage = useMemo(
    () => (pdfPageMeta.length > 0 ? pdfPageMeta.length : null),
    [pdfPageMeta.length],
  )
  const selectedDocumentStorageKey = useMemo(
    () => (selectedSubjectDocumentId != null ? String(selectedSubjectDocumentId) : null),
    [selectedSubjectDocumentId],
  )

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
      setSelectedSubjectId((current) =>
        current === defaultSubjectId ? current : defaultSubjectId,
      )
      return
    }
    setSelectedSubjectId((current) =>
      current != null && validIds.has(current) ? current : subjectOptions[0]?.id ?? null,
    )
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
        setError(
          formatMindMapImportError(
            nextError instanceof Error ? nextError.message : '加载学科 PDF 资料失败。',
          ),
        )
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
  }, [selectedSubjectId, setError])

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
        setError(
          formatMindMapImportError(
            nextError instanceof Error ? nextError.message : '加载 PDF 页面失败。',
          ),
        )
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
  }, [entityKey, selectedSubjectDocumentId, selectedSubjectId, setError])

  useEffect(() => {
    setPdfPageInputState(serializePageSelection(selectedPdfPages))
    if (selectedPdfPages.length === 0) {
      setStructurePage(null)
      return
    }
    if (pdfImportMode !== 'structured_merge') {
      setStructurePage(null)
      return
    }
    setStructurePage((current) =>
      current != null && selectedPdfPages.includes(current) ? current : selectedPdfPages[0],
    )
  }, [pdfImportMode, selectedPdfPages])

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

  const setImportPdfOption = async (key: keyof PdfImportOptions, value: boolean) => {
    const nextOptions = { ...pdfImportOptions, [key]: value }
    setPdfImportOptions(nextOptions)
    try {
      await updateReviewSettingsApi({
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

  const setImportPdfMode = (nextMode: PdfImportMode) => {
    const normalizedMode = normalizePdfImportMode(nextMode)
    setPdfImportModeState(normalizedMode)
    setError('')
    if (normalizedMode !== 'structured_merge') {
      setStructurePage(null)
      return
    }
    setStructurePage((current) =>
      current != null && selectedPdfPages.includes(current) ? current : selectedPdfPages[0] ?? null,
    )
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
    subjectDocuments,
    subjectDocumentsLoading,
    selectedSubjectId,
    setSelectedSubjectId,
    selectedSubjectDocumentId,
    setSelectedSubjectDocumentId,
    pdfPageMeta,
    pdfPagesLoading,
    selectedPdfPages,
    setSelectedPdfPages,
    pdfPageInput,
    setPdfPageInput,
    pdfSelectionError,
    pdfImportMode,
    setPdfImportMode: setImportPdfMode,
    setPdfImportModeState,
    structurePage,
    setStructurePage,
    pdfPreviewPage,
    setPdfPreviewPage,
    analyzedPdfPages,
    setAnalyzedPdfPages,
    persistAnalyzedPdfPages,
    rangePrompt,
    setRangePrompt,
    pdfImportOptions,
    setImportPdfOption,
    refreshSubjectDocuments,
    togglePdfPage,
    handleSubjectDocumentUpload,
    handleSubjectDocumentDelete,
  }
}
