import type { PalaceSegmentSummary, SubjectSummary } from '@/shared/api/contracts'

export interface PalaceMeta {
  id: number
  title: string
  description: string
  created_at: string | null
  attachments: Array<{ id: number; original_name: string; file_size: number }>
  chapters: Array<{
    id: number
    name: string
    parent_id?: number | null
    is_explicit?: boolean
    subject?: { id: number; name: string } | null
  }>
  primary_chapter_id?: number | null
  subjects?: SubjectSummary[]
  explicit_chapter_ids?: number[]
  inherited_chapter_ids?: number[]
  binding_revision?: number
  segments?: PalaceSegmentSummary[]
}

export type StatusBadgeState = {
  variant: 'secondary' | 'destructive'
  label: string
}
