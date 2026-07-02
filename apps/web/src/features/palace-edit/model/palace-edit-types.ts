import type { PalaceSegmentSummary } from '@/shared/api/contracts'

export interface PalaceMeta {
  id: number
  title: string
  description: string
  created_at: string | null
  focus_node_uids?: string[]
  focus_count?: number
  attachments: Array<{ id: number; original_name: string; file_size: number }>
  chapters: Array<{
    id: number
    name: string
    parent_id?: number | null
    is_explicit?: boolean
    subject?: { id: number; name: string } | null
  }>
  primary_chapter_id?: number | null
  segments?: PalaceSegmentSummary[]
}

export interface ChapterOption {
  id: number
  name: string
  depth: number
  subjectId: number | null
  subjectName: string
  parentId: number | null
  children: ChapterOption[]
}

export type StatusBadgeState = {
  variant: 'secondary' | 'destructive'
  label: string
}
