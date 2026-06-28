import type { PalaceQuizQuestion, PalaceQuizQuestionType } from './quiz'

export type FreestyleRange =
  | 'all'
  | 'due'
  | 'needs_practice'
  | 'specific_palaces'

export type FreestyleContentType =
  | 'quiz_question'
  | 'review'
  | 'segment_review'
  | 'mini_review'
  | 'practice'
  | 'english'
  | 'english_reading'

export type FreestyleActionKind =
  | 'review'
  | 'segment_review'
  | 'mini_review'
  | 'practice'
  | 'focus_practice'
  | 'mini_practice'
  | 'english'
  | 'english_reading'

export interface FreestyleChapterContext {
  id: number
  name: string
  subject_id: number | null
  parent_id?: number | null
  subject?: {
    id: number
    name: string
    color?: string
  } | null
}

export interface FreestylePalaceContext {
  id: number
  title: string
  resolved_title?: string
  subject?: {
    id: number
    name: string
    color?: string
  } | null
  primary_chapter?: FreestyleChapterContext | null
  parent_chapter?: FreestyleChapterContext | null
  needs_practice?: boolean
  focus_count?: number
}

export interface FreestyleMiniPalaceContext {
  id: number
  palace_id: number
  name: string
  sort_order?: number
  needs_practice?: boolean
}

export interface FreestyleQuizCard {
  id: string
  type: 'quiz_question'
  content_type: 'quiz_question'
  question: PalaceQuizQuestion
  palace_context: FreestylePalaceContext
  mini_palace_context?: FreestyleMiniPalaceContext | null
  chapter_context?: FreestyleChapterContext | null
  group_key: string
}

export interface FreestyleActionCard {
  id: string
  type: 'action'
  content_type: Exclude<FreestyleContentType, 'quiz_question'>
  action_kind: FreestyleActionKind
  title: string
  subtitle: string
  href: string
  priority: number
  reason: string
  palace_context?: FreestylePalaceContext | null
  schedule_id?: number
  segment_id?: number
  segment_name?: string
  mini_palace_id?: number
  mini_palace_name?: string
  course?: Record<string, unknown>
  material?: Record<string, unknown>
}

export type FreestyleCard = FreestyleQuizCard | FreestyleActionCard

export interface FreestyleFeedResponse {
  cards: FreestyleCard[]
  counts: Record<FreestyleContentType, number>
  generated_at: string
}

export type FreestyleQuestionTypeFilter = PalaceQuizQuestionType | 'all'
