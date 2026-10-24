export interface FreestyleOverviewCounts {
  palaces: number
  units: number
  new: number
  review: number
  done: number
  remaining: number
  remaining_palaces: number
  remaining_units: number
}

export interface FreestyleOverviewRound {
  round_id: string
  version: number
  counts: FreestyleOverviewCounts
  by_subject: Array<{ subject_id: number | null; name: string; done: number; total: number }>
}

export interface FreestyleMilestoneItem {
  id: string
  title: string
  category: string
  detail: string
}

export interface FreestyleMilestoneDay {
  date: string
  days_left: number
  /** Every milestone on that day (10/31 carries both 中教史 and 马原). */
  items: FreestyleMilestoneItem[]
}

export interface FreestyleMilestoneUpcoming {
  today: string
  /** Only the nearest two milestone days; the start page is a glance. */
  groups: FreestyleMilestoneDay[]
  overdue_count: number
}

export interface FreestyleOverviewResponse {
  round: FreestyleOverviewRound | null
  milestones: FreestyleMilestoneUpcoming
  today: {
    due_count: number
    due_palace_count: number
    overdue_count: number
    new_unit_count: number
    new_palace_count: number
  }
  yesterday: {
    date: string
    learned_units: number
    learned_palace_count: number
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
