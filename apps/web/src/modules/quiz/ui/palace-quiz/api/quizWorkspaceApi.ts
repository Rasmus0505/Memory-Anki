import { request, uploadWithFormData } from '@/shared/api/http'
import type {
  QuizGenerationJob,
  QuizMatchingItem,
  QuizPdfAsset,
  QuizSourceRole,
} from '@/shared/api/contracts'

export const listQuizPdfAssetsApi = (includeArchived = false) =>
  request<{ items: QuizPdfAsset[] }>(`/quiz-pdf-assets?include_archived=${includeArchived}`)

export function uploadQuizPdfAssetApi(file: File, name = '') {
  const form = new FormData()
  form.append('file', file)
  form.append('name', name)
  return uploadWithFormData<{ item: QuizPdfAsset }>('/quiz-pdf-assets', form, {
    resourceKey: 'quiz-pdf-asset:upload', description: '上传题库 PDF 资料',
  })
}

export const updateQuizPdfAssetApi = (assetId: number, data: { name?: string; archived?: boolean }) =>
  request<{ item: QuizPdfAsset }>(`/quiz-pdf-assets/${assetId}`, { method: 'PATCH', body: JSON.stringify(data) })

export const deleteQuizPdfAssetApi = (assetId: number) =>
  request<{ ok: boolean }>(`/quiz-pdf-assets/${assetId}`, { method: 'DELETE' })

export const createQuizGenerationJobApi = (palaceId: number, data: Record<string, unknown>) =>
  request<{ item: QuizGenerationJob }>(`/palaces/${palaceId}/quiz-generation-jobs`, { method: 'POST', body: JSON.stringify(data) })

export const listQuizGenerationJobsApi = (palaceId: number) =>
  request<{ items: QuizGenerationJob[] }>(`/palaces/${palaceId}/quiz-generation-jobs`)

export const deleteQuizGenerationJobApi = (jobId: string) =>
  request<{ ok: boolean }>(`/quiz-generation-jobs/${jobId}`, { method: 'DELETE' })

export const updateQuizGenerationJobApi = (jobId: string, data: Record<string, unknown>) =>
  request<{ item: QuizGenerationJob }>(`/quiz-generation-jobs/${jobId}`, { method: 'PATCH', body: JSON.stringify(data) })

export const addQuizTextSourceApi = (jobId: string, data: Record<string, unknown>) =>
  request(`/quiz-generation-jobs/${jobId}/sources/text`, { method: 'POST', body: JSON.stringify(data) })

export const addQuizPdfSourceApi = (jobId: string, data: Record<string, unknown>) =>
  request(`/quiz-generation-jobs/${jobId}/sources/pdf`, { method: 'POST', body: JSON.stringify(data) })

export function addQuizFileSourceApi(jobId: string, role: QuizSourceRole, file: File) {
  const form = new FormData()
  form.append('role', role)
  form.append('file', file)
  return uploadWithFormData(`/quiz-generation-jobs/${jobId}/sources/file`, form, {
    resourceKey: `quiz-generation-job:${jobId}:source-upload`, description: '上传题库生成素材',
  })
}

export const deleteQuizSourceApi = (jobId: string, sourceId: number) =>
  request<{ ok: boolean }>(`/quiz-generation-jobs/${jobId}/sources/${sourceId}`, { method: 'DELETE' })

export const reorderQuizSourcesApi = (jobId: string, sourceIds: number[]) =>
  request<{ item: QuizGenerationJob }>(`/quiz-generation-jobs/${jobId}/sources/order`, { method: 'PUT', body: JSON.stringify({ source_ids: sourceIds }) })

export const extractMatchQuizJobApi = (jobId: string, aiOptions?: unknown) =>
  request<{ item: QuizGenerationJob }>(`/quiz-generation-jobs/${jobId}/extract-match`, { method: 'POST', body: JSON.stringify({ ai_options: aiOptions }) })

export const updateQuizMatchingApi = (jobId: string, items: QuizMatchingItem[]) =>
  request<{ item: QuizGenerationJob }>(`/quiz-generation-jobs/${jobId}/matching`, { method: 'PUT', body: JSON.stringify({ items }) })

export const rematchQuizItemsApi = (jobId: string, itemIds: string[]) =>
  request<{ item: QuizGenerationJob }>(`/quiz-generation-jobs/${jobId}/matching/rematch`, { method: 'POST', body: JSON.stringify({ item_ids: itemIds }) })

export const generateQuizWorkspacePreviewApi = (jobId: string) =>
  request<{ item: QuizGenerationJob }>(`/quiz-generation-jobs/${jobId}/generate-preview`, { method: 'POST' })

export const markQuizGenerationJobSavedApi = (jobId: string) =>
  request<{ item: QuizGenerationJob }>(`/quiz-generation-jobs/${jobId}/mark-saved`, { method: 'POST' })
