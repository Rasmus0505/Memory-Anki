export interface FreestyleOverviewCounts {
  palaces: number
  units: number
  new: number
  review: number
  done: number
  remaining: number
}

export interface FreestyleOverviewRound {
  round_id: string
  version: number
  counts: FreestyleOverviewCounts
  by_subject: Array<{ subject_id: number | null; name: string; done: number; total: number }>
}

export interface FreestyleOverviewResponse {
  round: FreestyleOverviewRound | null
  today: { due_count: number; overdue_count: number; new_palace_count: number }
  yesterday: {
    date: string
    learned_units: number
    rated_count: number
    weak_units: Array<{ unit_id: string; name: string; palace_name: string; again_ratio: number }>
  }
  next_reviews: Array<{
    unit_id: string
    name: string
    palace_name: string
    due_date: string
    interval_days: number
  }>
}
