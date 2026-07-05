import type { MindMapEditorState, MindMapImportJob } from '@/shared/api/contracts'
import { logAiCall } from '@/shared/logs/model/appLogs'
import {
  countSourceTreeNodes,
  parseMindMapDoc,
  type ImportHistoryItem,
} from '@/features/mindmap-import/model/mindmap-import'
import type { ImportMode, ImportSourceKind } from '@/features/mindmap-import/model/mindmap-import-types'

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.readAsDataURL(file)
  })
}

export function describeImportFeature(sourceKind: ImportSourceKind, mode: ImportMode) {
  if (sourceKind === 'image-batch') {
    return '多图转脑图'
  }
  return mode === 'mindmap' ? '图片转脑图' : '图片转文字'
}

export function buildHistoryItemFromJob(job: MindMapImportJob): ImportHistoryItem | null {
  const sourceTree = job.result?.source_tree
  if (job.mode !== 'mindmap' || !sourceTree) return null
  if (job.source_kind !== 'image-single' && job.source_kind !== 'image-batch') return null
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
    importMode: job.source_kind === 'image-batch' ? 'batch' : 'single',
    imageCount: job.result?.image_count,
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
  const total = isTextMode ? 3 : 4
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
    message: '正在识别中。',
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
