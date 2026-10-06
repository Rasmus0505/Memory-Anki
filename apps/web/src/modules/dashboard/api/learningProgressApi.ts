import { request } from '@/shared/api/http'
import type { LearningProgressResponse } from '@/shared/api/contracts/learningProgress'

/** Reject incompatible snapshots instead of displaying plausible but false zeros. */
export function decodeLearningProgress(value: unknown): LearningProgressResponse {
  const fail = (): never => { throw new Error('学习进度数据格式不兼容，请刷新后重试。') }
  const object = (item: unknown): Record<string, unknown> => item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : fail()
  const validateMetrics = (value: unknown) => {
    const item = object(value)
    for (const key of ['memory_total', 'memory_reviewed', 'memory_due', 'quiz_total', 'quiz_answered']) {
      if (typeof item[key] !== 'number' || !Number.isSafeInteger(item[key]) || item[key] < 0) fail()
    }
    if ((item.memory_reviewed as number) > (item.memory_total as number) || (item.memory_due as number) > (item.memory_total as number) || (item.quiz_answered as number) > (item.quiz_total as number)) fail()
  }
  const snapshot = object(value)
  if (!Array.isArray(snapshot.roots) || !Array.isArray(snapshot.notes) || !snapshot.notes.every((note) => typeof note === 'string') || typeof snapshot.generated_at !== 'string') return fail()
  validateMetrics(snapshot.metrics)
  const queue: unknown[] = [...snapshot.roots]
  const ids = new Set<string>()
  while (queue.length) {
    const item = object(queue.pop())
    if (typeof item.id !== 'string' || !item.id || ids.has(item.id) || typeof item.name !== 'string' || !Array.isArray(item.children)) return fail()
    if (!['subject', 'palace', 'chapter', 'unit', 'memory_point'].includes(String(item.kind))) fail()
    if (item.palace_id !== null && (typeof item.palace_id !== 'number' || !Number.isSafeInteger(item.palace_id) || item.palace_id <= 0)) fail()
    ids.add(item.id)
    validateMetrics(item.metrics)
    for (const child of item.children) queue.push(child)
  }
  return value as LearningProgressResponse
}

export async function getLearningProgress(): Promise<LearningProgressResponse> {
  return decodeLearningProgress(await request<unknown>('/dashboard/learning-progress'))
}
