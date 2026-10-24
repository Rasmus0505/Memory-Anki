export type ExamStarSource = 'manual' | 'ai' | 'chapter' | 'derived'

export interface ExamSettings {
  exam_name: string
  exam_date: string | null
  subject_ids: number[]
  /** Cap every interval at ~20% of the remaining horizon so nothing is booked past the exam. */
  sprint_mode: boolean
}

export interface ExamTotals {
  unit_count: number
  learned_count: number
  learned_ratio: number
  mastery_ratio: number
  predicted_ratio: number
  predicted_if_idle_ratio: number
  pace_per_day: number
  needed_per_day: number
  due_today: number
  reviewed_today: number
  study_days: number
}

export interface ExamSubjectRow {
  id: number
  name: string
  color: string
  exam_share: number | null
  unit_count: number
  learned_ratio: number
  mastery_ratio: number
  predicted_ratio: number
}

export interface ExamStarRow {
  stars: 1 | 2 | 3
  palace_count: number
  unit_count: number
  mastery_ratio: number
}

export interface ExamPalaceRow {
  id: number
  title: string
  subject_id: number | null
  chapter_id: number | null
  stars: 1 | 2 | 3
  stars_source: ExamStarSource
  own_stars: number | null
  question_count: number
  subjective_count: number
  unit_count: number
  learned_count: number
  mastery_ratio: number
  recall: number
  priority: number
}

export interface ExamChapterRow {
  id: number
  subject_id: number
  parent_id: number | null
  name: string
  sort_order: number
  exam_stars: number | null
  exam_stars_source: ExamStarSource | null
}

export interface ExamOverview {
  settings: ExamSettings
  today: string
  days_left: number | null
  totals: ExamTotals
  subjects: ExamSubjectRow[]
  stars: ExamStarRow[]
  palaces: ExamPalaceRow[]
  chapters: ExamChapterRow[]
  weak: ExamPalaceRow[]
  retention: {
    projected: { date: string; recall: number }[]
    observed: { date: string; reviews: number; pass_rate: number | null }[]
  }
  star_rule: { source_derived: string; description: string }
}

export interface ExamStarsWriteResult {
  id: number
  exam_stars: number | null
  exam_stars_source: ExamStarSource | null
}

export type MilestoneStatus = 'done' | 'overdue' | 'due_soon' | 'upcoming'

export interface StudyMilestone {
  id: string
  date: string
  title: string
  category: string
  detail: string
  notify_days_before: number
  enabled: boolean
  done: boolean
  days_left: number
  status: MilestoneStatus
}

export interface SprintState {
  active: boolean
  sprint_mode: boolean
  exam_date: string | null
  days_left: number | null
  max_interval_days: number | null
  last_due: string | null
}

export interface MilestoneBoard {
  today: string
  items: StudyMilestone[]
  counts: { total: number; done: number; overdue: number; due_soon: number }
  sprint: SprintState
}
