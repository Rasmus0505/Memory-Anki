import { request } from '@/shared/api/http'
import type { AiLearningRun, AiRunDraft, AiRunPreview } from '../model/types'
export function previewAiLearningRunApi(data: AiRunDraft) { return request<{ preview: AiRunPreview }>('/ai-learning/preview', { method: 'POST', body: JSON.stringify(data) }) }
export function executeAiLearningRunApi(data: AiRunDraft) { return request<{ item: AiLearningRun }>('/ai-learning/runs', { method: 'POST', body: JSON.stringify(data) }) }
export function listAiLearningRunsApi(filters: { reviewSessionId?: number; palaceId?: number; threadId?: string; includeDeleted?: boolean }) { const params = new URLSearchParams(); if(filters.reviewSessionId) params.set('review_session_id', String(filters.reviewSessionId)); if(filters.palaceId) params.set('palace_id', String(filters.palaceId)); if(filters.threadId) params.set('thread_id', filters.threadId); if(filters.includeDeleted) params.set('include_deleted', 'true'); return request<{ items: AiLearningRun[] }>(`/ai-learning/runs?${params}`) }
export function setAiLearningRunFeedbackApi(runId: string, feedback: AiLearningRun['feedback']) { return request<{ item: AiLearningRun }>(`/ai-learning/runs/${runId}/feedback`, { method: 'PATCH', body: JSON.stringify({ feedback }) }) }

export function setAiLearningRunApplicationApi(runId: string, status: AiLearningRun['application_status'], result: Record<string, unknown> = {}) { return request<{ item: AiLearningRun }>(`/ai-learning/runs/${runId}/application`, { method: 'PATCH', body: JSON.stringify({ status, result }) }) }
export function deleteAiLearningRunApi(runId: string) { return request<{ item: AiLearningRun }>(`/ai-learning/runs/${runId}`, { method: 'DELETE' }) }
export function restoreAiLearningRunApi(runId: string) { return request<{ item: AiLearningRun }>(`/ai-learning/runs/${runId}/restore`, { method: 'POST' }) }
export function purgeAiLearningRunApi(runId: string) { return request<void>(`/ai-learning/runs/${runId}/purge`, { method: 'DELETE' }) }

export function setAiLearningRunItemDecisionApi(runId: string, itemId: string, decision: 'accepted' | 'rejected' | 'pending') { return request<{ item: AiLearningRun }>(`/ai-learning/runs/${runId}/items/${itemId}`, { method: 'PATCH', body: JSON.stringify({ decision }) }) }
