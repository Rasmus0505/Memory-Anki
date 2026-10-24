import { request } from '@/shared/api/http'
import type {
  ExamOverview,
  ExamSettings,
  ExamStarsWriteResult,
  MilestoneBoard,
  StudyMilestone,
} from '@/shared/api/contracts'

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

export function getMilestonesApi() {
  return request<MilestoneBoard>('/exam/milestones')
}

export function saveMilestonesApi(items: StudyMilestone[]) {
  return request<MilestoneBoard>('/exam/milestones', {
    method: 'PUT',
    body: JSON.stringify({
      items: items.map((item) => ({
        id: item.id,
        date: item.date,
        title: item.title,
        category: item.category,
        detail: item.detail,
        notify_days_before: item.notify_days_before,
        enabled: item.enabled,
        done: item.done,
      })),
    }),
  })
}
