export type ProgressionStampTier = 'paper' | 'silver' | 'gold'
export type ProgressionXpSource = 'rating' | 'conquer' | 'first_learn' | 'quiz' | 'time' | 'quest'

export interface ProgressionLevel {
  level: number
  xp: number
  level_floor: number
  next_level_xp: number
  progress: number
}

export interface ProgressionQuest {
  key: string
  title: string
  hint: string
  scope: 'daily' | 'weekly'
  progress: number
  target: number
  done: boolean
  xp: number
}

export interface ProgressionStamp {
  id: string
  title: string
  description: string
  group: string
  tier: ProgressionStampTier
  progress: number
  target: number
  unlocked_on: string | null
}

export interface StarmapSubject {
  id: number
  name: string
  color: string
}

export interface StarmapChapter {
  id: number
  subject_id: number
  parent_id: number | null
  name: string
  sort_order: number
  exam_stars: number | null
}

export interface StarmapPalace {
  id: number
  title: string
  subject_id: number | null
  chapter_id: number | null
  stars: 1 | 2 | 3
  unit_count: number
  learned_count: number
  mastery_ratio: number
  recall: number
  due_count: number
}

export interface ProgressionStarmap {
  subjects: StarmapSubject[]
  chapters: StarmapChapter[]
  palaces: StarmapPalace[]
}

export interface ProgressionOverview {
  today: string
  level: ProgressionLevel
  xp: { today: number; week: number; sources: Record<ProgressionXpSource, number> }
  quests: ProgressionQuest[]
  stamps: ProgressionStamp[]
  stats: Record<string, number>
  starmap: ProgressionStarmap
}
