import { API_BASE, fetchWithMutationQueue, request } from '@/shared/api/http'
import type {
  AiRuntimeOptions,
  ImageTextPreviewResponse,
  MindMapBatchImportPreviewResponse,
  MindMapImportJob,
  MindMapImportJobListResponse,
  MindMapImportPreviewResponse,
} from '@/shared/api/contracts'
import {
  type ImportStreamHandlers,
  parseImportStreamResponse,
  readImportJson,
} from './importResponse'
import type { PdfDocument } from '../model/importTypes'

export async function previewMindMapImportApi(file: File, handlers?: ImportStreamHandlers) {
  const form = new FormData()
  form.append('file', file)
  const response = await fetch(`${API_BASE}/import/preview-mindmap`, {
    method: 'POST',
    body: form,
  })
  return parseImportStreamResponse<MindMapImportPreviewResponse>(response, handlers)
}

export async function previewImageTextApi(file: File, handlers?: ImportStreamHandlers) {
  const form = new FormData()
  form.append('file', file)
  const response = await fetch(`${API_BASE}/import/preview-text`, {
    method: 'POST',
    body: form,
  })
  return parseImportStreamResponse<ImageTextPreviewResponse>(response, handlers)
}

export async function previewMindMapBatchImportApi(
  files: File[],
  options?: {
    structureImageIndex?: number
    fallbackTitle?: string
  },
  handlers?: ImportStreamHandlers,
) {
  const form = new FormData()
  files.forEach((file) => form.append('files', file))
  if (typeof options?.structureImageIndex === 'number') {
    form.append('structure_image_index', String(options.structureImageIndex))
  }
  if (options?.fallbackTitle) {
    form.append('fallback_title', options.fallbackTitle)
  }
  const response = await fetch(`${API_BASE}/import/preview-mindmap-batch`, {
    method: 'POST',
    body: form,
  })
  return parseImportStreamResponse<MindMapBatchImportPreviewResponse>(response, handlers)
}

export async function createImageImportJobApi(
  file: File,
  options: {
    entityKey: string
    mode: 'mindmap' | 'text'
    fallbackTitle?: string
    ai_options?: AiRuntimeOptions
  },
) {
  const form = new FormData()
  form.append('entity_key', options.entityKey)
  form.append('mode', options.mode)
  if (options.fallbackTitle) {
    form.append('fallback_title', options.fallbackTitle)
  }
  if (options.ai_options) {
    form.append('ai_options', JSON.stringify(options.ai_options))
  }
  form.append('file', file)
  const response = await fetchWithMutationQueue(
    `${API_BASE}/import/jobs/image`,
    {
      method: 'POST',
      body: form,
    },
    {
      resourceKey: `import-job:image:${options.entityKey}:${file.name}`,
      description: `创建图片导入任务：${file.name}`,
      replayMode: 'manual',
    },
  )
  return readImportJson<MindMapImportJob>(response)
}

export async function createBatchImportJobApi(
  files: File[],
  options: {
    entityKey: string
    fallbackTitle?: string
    structureImageIndex?: number
    mode?: 'mindmap' | 'text'
    ai_options?: AiRuntimeOptions
    vision_ai_options?: AiRuntimeOptions
    formatter_ai_options?: AiRuntimeOptions
  },
) {
  const form = new FormData()
  form.append('entity_key', options.entityKey)
  if (options.fallbackTitle) {
    form.append('fallback_title', options.fallbackTitle)
  }
  form.append('mode', options.mode ?? 'mindmap')
  if (typeof options.structureImageIndex === 'number') {
    form.append('structure_image_index', String(options.structureImageIndex))
  }
  if (options.ai_options) form.append('ai_options', JSON.stringify(options.ai_options))
  if (options.vision_ai_options) form.append('vision_ai_options', JSON.stringify(options.vision_ai_options))
  if (options.formatter_ai_options) form.append('formatter_ai_options', JSON.stringify(options.formatter_ai_options))
  files.forEach((file) => form.append('files', file))
  const response = await fetchWithMutationQueue(
    `${API_BASE}/import/jobs/batch`,
    {
      method: 'POST',
      body: form,
    },
    {
      resourceKey: `import-job:batch:${options.entityKey}:${files.map((file) => file.name).join(',')}`,
      description: '创建批量导入任务',
      replayMode: 'manual',
    },
  )
  return readImportJson<MindMapImportJob>(response)
}

export async function listPdfDocumentsApi() {
  return request<{ items: PdfDocument[] }>('/pdf-library')
}

export async function uploadPdfDocumentApi(file: File) {
  const form = new FormData()
  form.append('file', file)
  const response = await fetchWithMutationQueue(
    `${API_BASE}/pdf-library`,
    { method: 'POST', body: form },
    {
      resourceKey: `pdf-library:upload:${file.name}:${file.size}`,
      description: `上传 PDF：${file.name}`,
      replayMode: 'manual',
    },
  )
  return readImportJson<PdfDocument>(response)
}

export async function deletePdfDocumentApi(documentId: string) {
  return request<{ ok: boolean }>(`/pdf-library/${documentId}`, { method: 'DELETE' })
}

export async function createPdfImportJobApi(options: {
  entityKey: string
  documentId: string
  pageSelection: string
  mode: 'mindmap' | 'text'
  fallbackTitle?: string
  ai_options?: AiRuntimeOptions
  vision_ai_options?: AiRuntimeOptions
  formatter_ai_options?: AiRuntimeOptions
}) {
  const form = new FormData()
  form.append('entity_key', options.entityKey)
  form.append('document_id', options.documentId)
  form.append('page_selection', options.pageSelection)
  form.append('mode', options.mode)
  if (options.fallbackTitle) form.append('fallback_title', options.fallbackTitle)
  if (options.ai_options) form.append('ai_options', JSON.stringify(options.ai_options))
  if (options.vision_ai_options) form.append('vision_ai_options', JSON.stringify(options.vision_ai_options))
  if (options.formatter_ai_options) form.append('formatter_ai_options', JSON.stringify(options.formatter_ai_options))
  const response = await fetchWithMutationQueue(
    `${API_BASE}/import/jobs/pdf`,
    { method: 'POST', body: form },
    {
      resourceKey: `import-job:pdf:${options.entityKey}:${options.documentId}:${options.pageSelection}`,
      description: '创建 PDF 导入任务',
      replayMode: 'manual',
    },
  )
  return readImportJson<MindMapImportJob>(response)
}

export async function retryVisionImportJobApi(jobId: string) {
  const response = await fetchWithMutationQueue(
    `${API_BASE}/import/jobs/${jobId}/retry-vision`,
    { method: 'POST' },
    {
      resourceKey: `import-job:${jobId}:retry-vision`,
      description: '重试视觉识别',
      replayMode: 'manual',
    },
  )
  return readImportJson<MindMapImportJob>(response)
}

export async function reformatImportJobFromOcrApi(jobId: string) {
  const response = await fetchWithMutationQueue(
    `${API_BASE}/import/jobs/${jobId}/reformat-ocr`,
    { method: 'POST' },
    {
      resourceKey: `import-job:${jobId}:reformat-ocr`,
      description: '使用 OCR 原文重新整理',
      replayMode: 'manual',
    },
  )
  return readImportJson<MindMapImportJob>(response)
}

export async function completeImportJobFromPreviewApi(
  jobId: string,
  data: {
    result: Record<string, unknown>
    usage?: Record<string, number>
  },
) {
  const response = await fetchWithMutationQueue(
    `${API_BASE}/import/jobs/${jobId}/complete-from-preview`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
    {
      resourceKey: `import-job:${jobId}:complete-from-preview`,
      description: '完成导入预览任务',
      replayMode: 'manual',
    },
  )
  return readImportJson<MindMapImportJob>(response)
}

export async function runImportJobApi(jobId: string) {
  const response = await fetchWithMutationQueue(
    `${API_BASE}/import/jobs/${jobId}/run`,
    {
      method: 'POST',
    },
    {
      resourceKey: `import-job:${jobId}:run`,
      description: '运行导入任务',
      replayMode: 'manual',
    },
  )
  return readImportJson<MindMapImportJob>(response)
}

export async function pauseImportJobApi(jobId: string) {
  const response = await fetchWithMutationQueue(
    `${API_BASE}/import/jobs/${jobId}/pause`,
    {
      method: 'POST',
    },
    {
      resourceKey: `import-job:${jobId}:pause`,
      description: '暂停导入任务',
      replayMode: 'manual',
    },
  )
  return readImportJson<MindMapImportJob>(response)
}

export async function getImportJobApi(jobId: string) {
  return request<MindMapImportJob>(`/import/jobs/${jobId}`)
}

export async function listImportJobsApi(entityKey: string) {
  const query = new URLSearchParams({ entity_key: entityKey }).toString()
  return request<MindMapImportJobListResponse>(`/import/jobs?${query}`)
}

export async function deleteImportJobApi(jobId: string) {
  const response = await fetchWithMutationQueue(
    `${API_BASE}/import/jobs/${jobId}`,
    {
      method: 'DELETE',
    },
    {
      resourceKey: `import-job:${jobId}:delete`,
      description: '删除导入任务',
      replayMode: 'manual',
    },
  )
  return readImportJson<{ ok: boolean; job: MindMapImportJob }>(response)
}

export async function rerunImportJobApi(jobId: string) {
  const response = await fetchWithMutationQueue(
    `${API_BASE}/import/jobs/${jobId}/rerun`,
    { method: 'POST' },
    {
      resourceKey: `import-job:${jobId}:rerun`,
      description: '复跑导入任务',
      replayMode: 'manual',
    },
  )
  return readImportJson<MindMapImportJob>(response)
}
