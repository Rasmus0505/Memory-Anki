export const MEMORY_LADDER_STAGE_COUNT = 10

export interface SubjectMemoryLadderPalace {
  palace_id: number
  title: string
  due_date: string
  overdue: boolean
  due_today: boolean
  unit_count: number
}

export interface SubjectMemoryLadderStage {
  stage_index: number
  interval_days: number
  palace_count: number
  unit_count: number
  overdue_palace_count: number
  palaces: SubjectMemoryLadderPalace[]
}

export interface SubjectMemoryLadderSubject {
  subject_id: number | null
  name: string
  color: string
  palace_count: number
  stages: SubjectMemoryLadderStage[]
}

export interface SubjectMemoryLadderResponse {
  ladder: number[]
  generated_at: string
  subjects: SubjectMemoryLadderSubject[]
}

export type SubjectMemoryLadderKey = number | 'unassigned'

export function stageLabel(intervalDays: number): string {
  if (intervalDays <= 0) return '刚学'
  if (intervalDays >= 365) return '1年'
  return `${intervalDays}天`
}

export function formatReviewDate(value: string, overdue: boolean, dueToday: boolean): string {
  if (dueToday) return '今天'
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  const shown = match ? `${Number(match[2])}月${Number(match[3])}日` : value
  return overdue ? `逾期 · ${shown}` : shown
}

export function defaultStageIndex(stages: readonly SubjectMemoryLadderStage[]): number {
  const overdue = stages.find((stage) => stage.overdue_palace_count > 0)
  if (overdue) return overdue.stage_index
  return stages.reduce(
    (best, stage) => (stage.palace_count > best.palace_count ? stage : best),
    stages[0] ?? { stage_index: 0, palace_count: 0 },
  ).stage_index
}

export function nodeScale(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0.42
  return 0.48 + 0.52 * (count / max)
}

export function subjectKeyFromProgressId(id: string): SubjectMemoryLadderKey | null {
  if (id === 'subject:unassigned') return 'unassigned'
  const match = /^subject:(\d+)$/.exec(id)
  if (!match) return null
  const subjectId = Number(match[1])
  return Number.isSafeInteger(subjectId) && subjectId > 0 ? subjectId : null
}

export function findSubjectLadder(
  response: SubjectMemoryLadderResponse | undefined,
  subjectKey: SubjectMemoryLadderKey,
): SubjectMemoryLadderSubject | null {
  if (!response) return null
  return response.subjects.find((subject) => (
    subjectKey === 'unassigned' ? subject.subject_id == null : subject.subject_id === subjectKey
  )) ?? null
}
