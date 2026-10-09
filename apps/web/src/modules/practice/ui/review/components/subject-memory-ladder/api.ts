import { request } from '@/shared/api/http'
import {
  MEMORY_LADDER_STAGE_COUNT,
  type SubjectMemoryLadderResponse,
} from './model'

function fail(): never {
  throw new Error('记忆档位数据格式不兼容，请刷新后重试。')
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail()
  return value as Record<string, unknown>
}

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail()
  return value
}

export function decodeSubjectMemoryLadder(value: unknown): SubjectMemoryLadderResponse {
  const snapshot = object(value)
  if (!Array.isArray(snapshot.ladder) || snapshot.ladder.length !== MEMORY_LADDER_STAGE_COUNT) fail()
  if (!snapshot.ladder.every((item) => typeof item === 'number' && Number.isSafeInteger(item) && item >= 0)) fail()
  if (typeof snapshot.generated_at !== 'string' || !Array.isArray(snapshot.subjects)) fail()
  for (const rawSubject of snapshot.subjects) {
    const subject = object(rawSubject)
    if (subject.subject_id !== null && count(subject.subject_id) <= 0) fail()
    if (typeof subject.name !== 'string' || typeof subject.color !== 'string') fail()
    count(subject.palace_count)
    if (!Array.isArray(subject.stages) || subject.stages.length !== MEMORY_LADDER_STAGE_COUNT) fail()
    subject.stages.forEach((rawStage, index) => {
      const stage = object(rawStage)
      if (count(stage.stage_index) !== index || count(stage.interval_days) !== snapshot.ladder[index]) fail()
      count(stage.palace_count)
      count(stage.unit_count)
      count(stage.overdue_palace_count)
      if (!Array.isArray(stage.palaces)) fail()
      for (const rawPalace of stage.palaces) {
        const palace = object(rawPalace)
        if (count(palace.palace_id) <= 0 || typeof palace.title !== 'string') fail()
        if (typeof palace.due_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(palace.due_date)) fail()
        if (typeof palace.overdue !== 'boolean' || typeof palace.due_today !== 'boolean') fail()
        count(palace.unit_count)
      }
    })
  }
  return value as SubjectMemoryLadderResponse
}

export function getSubjectMemoryLadderApi(): Promise<SubjectMemoryLadderResponse> {
  return request<unknown>('/review/subject-ladder').then(decodeSubjectMemoryLadder)
}

export const SUBJECT_MEMORY_LADDER_QUERY_KEY = ['review', 'subject-ladder'] as const
