import { request } from '@/shared/api/http'
import type { ExamOverview, ExamSettings, ExamStarsWriteResult } from '@/shared/api/contracts'

export function getExamOverviewApi() {
  return request<ExamOverview>('/exam/overview')
}

export function saveExamSettingsApi(settings: Partial<ExamSettings>) {
  return request<ExamSettings>('/exam/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  })
}

export function setPalaceStarsApi(palaceId: number, stars: number | null) {
  return request<ExamStarsWriteResult>(`/exam/palaces/${palaceId}/stars`, {
    method: 'PUT',
    body: JSON.stringify({ stars, source: 'manual' }),
  })
}

export function setChapterStarsApi(chapterId: number, stars: number | null) {
  return request<ExamStarsWriteResult>(`/exam/chapters/${chapterId}/stars`, {
    method: 'PUT',
    body: JSON.stringify({ stars, source: 'manual' }),
  })
}

export function setSubjectShareApi(subjectId: number, share: number | null) {
  return request<{ id: number; exam_share: number | null }>(`/exam/subjects/${subjectId}/share`, {
    method: 'PUT',
    body: JSON.stringify({ share }),
  })
}
