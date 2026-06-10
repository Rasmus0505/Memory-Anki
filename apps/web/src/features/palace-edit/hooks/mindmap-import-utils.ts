import type { MindMapEditorState, MindMapImportJob, PdfImportMode } from '@/shared/api/contracts'
import { logAiCall } from '@/shared/logs/model/appLogs'
import {
  countSourceTreeNodes,
  parseMindMapDoc,
  type ImportHistoryItem,
} from '@/features/palace-edit/model/mindmap-import'
import type { ImportMode, ImportSourceKind } from '@/features/palace-edit/model/mindmap-import-types'

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.readAsDataURL(file)
  })
}

export function uniqueSortedPages(values: number[]) {
  return Array.from(new Set(values.filter((value) => Number.isInteger(value) && value > 0))).sort(
    (left, right) => left - right,
  )
}

export function serializePageSelection(values: number[]) {
  return uniqueSortedPages(values).join(', ')
}

export function normalizePdfImportMode(value: unknown): PdfImportMode {
  return value === 'structured_merge' ? 'structured_merge' : 'direct_generation'
}

export function describeImportFeature(sourceKind: ImportSourceKind, mode: ImportMode) {
  if (sourceKind === 'subject-pdf') {
    return mode === 'mindmap' ? '学科 PDF 转脑图' : '学科 PDF 转文字'
  }
  if (sourceKind === 'image-batch') {
    return '多图转脑图'
  }
  return mode === 'mindmap' ? '图片转脑图' : '图片转文字'
}

export function summarizePdfRequest(params: {
  pages: number[]
  rangePrompt: string
  pdfMode: PdfImportMode
  structurePage: number | null
}) {
  const selection = serializePageSelection(params.pages) || '未选择'
  const prompt = params.rangePrompt ? `；提示：${params.rangePrompt}` : ''
  if (params.pdfMode === 'structured_merge') {
    return `页码：${selection}；模式：结构页补全${params.structurePage ? `；结构页：${params.structurePage}` : ''}${prompt}`
  }
  return `页码：${selection}；模式：按范围直接生成${prompt}`
}

export function parsePageSelectionInput(
  value: string,
  maxPage: number | null,
): { pages: number[]; error: string } {
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

export function buildHistoryItemFromJob(job: MindMapImportJob): ImportHistoryItem | null {
  const sourceTree = job.result?.source_tree
  if (job.mode !== 'mindmap' || !sourceTree) return null
  return {
    id: job.id,
    jobId: job.id,
    jobStatus: job.status,
    jobStage: job.stage,
    title: sourceTree.title || '',
    nodeCount: countSourceTreeNodes(sourceTree.children || []),
    sourceTree,
    editorDoc: job.result?.editor_doc ?? null,
    imagePreviewUrl: '',
    importMode: job.source_kind === 'image-batch' ? 'batch' : job.source_kind === 'subject-pdf' ? 'pdf' : 'single',
    imageCount:
      job.result?.image_count ??
      (Array.isArray(job.result?.selected_pages) ? job.result?.selected_pages.length : undefined),
    createdAt: job.created_at || new Date().toISOString(),
  }
}

export function describeJobProgress(
  job: MindMapImportJob | null,
): { phase: string; message: string; step: number | null; total: number | null } {
  if (!job) {
    return { phase: '', message: '', step: null, total: null }
  }
  if (job.progress) {
    return {
      phase: job.progress.phase || '',
      message: job.progress.message || '',
      step: job.progress.step ?? null,
      total: job.progress.total_steps ?? null,
    }
  }
  const isTextMode = job.mode === 'text'
  const isDirectPdfMindmap =
    job.source_kind === 'subject-pdf' &&
    job.mode === 'mindmap' &&
    normalizePdfImportMode(job.source_meta?.pdf_mode) === 'direct_generation'
  const total = isTextMode ? 3 : isDirectPdfMindmap ? 3 : 4
  if (job.status === 'completed') {
    return {
      phase: 'completed',
      message: '识别完成，可继续预览或应用。',
      step: total,
      total,
    }
  }
  if (job.status === 'failed') {
    return {
      phase: job.stage,
      message: '识别中断，可继续识别。',
      step: null,
      total,
    }
  }
  if (job.status === 'interrupted') {
    return {
      phase: job.stage,
      message: '任务已中断，可继续识别。',
      step: null,
      total,
    }
  }
  if (job.status === 'paused') {
    return {
      phase: job.stage,
      message: '识别已暂停，可继续识别。',
      step: null,
      total,
    }
  }
  if (job.stage === 'prepared') {
    return {
      phase: 'prepared',
      message: '输入已准备完成，正在等待识别。',
      step: 1,
      total,
    }
  }
  if (job.stage === 'structure') {
    return {
      phase: 'structure',
      message: '结构已提取。',
      step: isTextMode ? 1 : 2,
      total,
    }
  }
  if (job.stage === 'ocr') {
    return {
      phase: 'ocr',
      message: '正文 OCR 已完成。',
      step: 3,
      total,
    }
  }
  if (job.stage === 'merge') {
    return {
      phase: 'merge',
      message: '正在合并并生成草稿。',
      step: total - 1,
      total,
    }
  }
  if (job.stage === 'text') {
    return {
      phase: 'text',
      message: '文字提取已完成。',
      step: total,
      total,
    }
  }
  return {
    phase: job.stage,
    message: '正在识别中…',
    step: null,
    total,
  }
}

export function countDocNodes(value: MindMapEditorState['editor_doc']): number {
  const doc = parseMindMapDoc(value)
  const visit = (node: { children?: unknown[] } | null | undefined): number => {
    if (!node || typeof node !== 'object') return 0
    const children = Array.isArray(node.children) ? node.children : []
    return 1 + children.reduce<number>((total, child) => total + visit(child as { children?: unknown[] }), 0)
  }
  return visit(doc?.root as { children?: unknown[] } | null | undefined)
}

export function hasNodeUid(
  value: MindMapEditorState['editor_doc'],
  targetUid: string | null | undefined,
): boolean {
  if (!targetUid) return false
  const doc = parseMindMapDoc(value)
  const visit = (
    node: { data?: Record<string, unknown>; children?: unknown[] } | null | undefined,
  ): boolean => {
    if (!node || typeof node !== 'object') return false
    if (typeof node.data?.uid === 'string' && node.data.uid === targetUid) {
      return true
    }
    const children = Array.isArray(node.children) ? node.children : []
    return children.some((child) =>
      visit(child as { data?: Record<string, unknown>; children?: unknown[] }),
    )
  }
  return visit(doc?.root as { data?: Record<string, unknown>; children?: unknown[] } | null | undefined)
}

export function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

const IMPORT_LAST_JOB_PREFIX = 'mindmap_import_last_job_'

const lastJobKey = (entityKey: string | null) => `${IMPORT_LAST_JOB_PREFIX}${entityKey}`

export function loadLastJobId(entityKey: string | null): string | null {
  if (!entityKey) return null
  try {
    return localStorage.getItem(lastJobKey(entityKey))
  } catch {
    return null
  }
}

export function persistLastJobId(entityKey: string | null, jobId: string | null) {
  if (!entityKey) return
  try {
    if (jobId) localStorage.setItem(lastJobKey(entityKey), jobId)
    else localStorage.removeItem(lastJobKey(entityKey))
  } catch {
    // Ignore persistence failures.
  }
}

export function getRequestId(value: unknown) {
  return value instanceof Error && 'requestId' in value && typeof value.requestId === 'string'
    ? value.requestId
    : ''
}

export function logImportFailure(params: {
  entityKey: string | null
  feature: string
  requestSummary: string
  error: unknown
  jobId?: string
  meta?: Record<string, unknown>
}) {
  const requestId = getRequestId(params.error)
  logAiCall({
    feature: params.feature,
    stage: 'failure',
    requestSummary: params.requestSummary,
    errorMessage:
      params.error instanceof Error ? params.error.message : '网络异常，请检查网络后重试。',
    jobId: params.jobId,
    requestId,
    meta: {
      entityKey: params.entityKey,
      requestId,
      ...(params.meta || {}),
    },
  })
}
