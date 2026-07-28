import type { MindMapDoc, MindMapEditorState } from './mindmap'
export interface PalaceSegmentSummary {
  id: number
  palace_id: number
  name: string
  display_name?: string
  color: string
  created_at: string | null
  sort_order: number
  node_uids: string[]
  node_count: number
  is_empty: boolean
  is_virtual_default?: boolean
}
export interface PalaceListItem {
  id: number
  title: string
  description: string
  archived?: boolean
  created_at: string | null
  updated_at?: string | null
  next_review_at: string | null
  has_due_review: boolean
  review_status: 'marking_required' | 'due' | 'scheduled'
  review_unit_count: number
  due_review_unit_count: number
  permanent_mark_count: number
  next_review_date?: string | null
  segments?: PalaceSegmentSummary[]
  chapters?: Array<unknown>
}
export interface ChapterSummary {
  id: number
  name: string
  subject_id: number | null
  parent_id: number | null
  is_explicit?: boolean
}
export interface SubjectSummary {
  id: number
  name: string
  color: string
}
export interface PalaceGroupedItem extends PalaceListItem {
  resolved_title: string
  title_mode: string
  manual_title: string
  grouping_mode: string
  manual_group_chapter_id: number | null
  binding_status: string
  primary_chapter_id: number | null
  primary_chapter: ChapterSummary | null
  resolved_subject: SubjectSummary | null
  resolved_parent_chapter: ChapterSummary | null
  group_id: number | null
  group_sort_order: number
}
export interface PalaceEditorMeta {
  id: number
  title: string
  description: string
  archived?: boolean
  created_at?: string | null
  updated_at?: string | null
  primary_chapter_id?: number | null
  primary_chapter?: ChapterSummary | null
  subjects?: SubjectSummary[]
  explicit_chapter_ids?: number[]
  inherited_chapter_ids?: number[]
  binding_revision?: number
  chapters?: Array<ChapterSummary & {
    subject?: { id: number; name: string } | null
  }>
  pegs?: Array<{ id: number; name: string; content: string; children: unknown[] }>
  attachments: Array<{ id: number; filename?: string; original_name: string; file_size: number }>
  review_status?: 'marking_required' | 'due' | 'scheduled'
  review_unit_count?: number
  due_review_unit_count?: number
  permanent_mark_count?: number
  next_review_date?: string | null
  next_review_at?: string | null
  has_due_review?: boolean
  segments?: PalaceSegmentSummary[]
  editor_doc?: MindMapDoc | string | null
}
export interface PalaceEditorResponse extends MindMapEditorState {
  palace: PalaceEditorMeta
}
export interface PalaceGroupedSummaryItem {
  id: number
  title: string
  description: string
  archived?: boolean
  created_at: string | null
  updated_at?: string | null
  next_review_at: string | null
  has_due_review: boolean
  review_status: 'marking_required' | 'due' | 'scheduled'
  review_unit_count: number
  due_review_unit_count: number
  permanent_mark_count: number
  next_review_date: string | null
  title_mode: string
  manual_title: string
  resolved_title: string
  grouping_mode: string
  manual_group_chapter_id: number | null
  binding_status: string
  primary_chapter_id: number | null
  primary_chapter: ChapterSummary | null
  resolved_subject: SubjectSummary | null
  resolved_parent_chapter: ChapterSummary | null
  group_id: number | null
  group_sort_order: number
  chapter_count: number
  segment_count: number
}
export interface PalaceChapterGroup {
  source_chapter: ChapterSummary
  palaces: PalaceGroupedItem[]
}
export interface PalaceSummaryChapterGroup {
  source_chapter: ChapterSummary
  palaces: PalaceGroupedSummaryItem[]
}
export interface PalaceSubjectGroup {
  subject: SubjectSummary | null
  chapter_groups: PalaceChapterGroup[]
  ungrouped_palaces: PalaceGroupedItem[]
}
export interface PalaceSummarySubjectGroup {
  subject: SubjectSummary | null
  chapter_groups: PalaceSummaryChapterGroup[]
  ungrouped_palaces: PalaceGroupedSummaryItem[]
}
export interface PalaceSubjectShelfItem {
  subject: SubjectSummary | null
  palace_count: number
  chapter_count: number
  review_status: 'due_now' | 'due_later_today' | 'idle'
  has_due_review: boolean
  has_due_later_today: boolean
  due_now_count: number
  due_later_today_count: number
}
export interface PalaceSubjectShelfResponse {
  items: PalaceSubjectShelfItem[]
}
export interface PalaceGroupSummary {
  id: number
  name: string
  color: string
  sort_order: number
  source_chapter_id: number | null
  palaces: PalaceGroupedItem[]
}
export interface PalaceGroupedSummaryGroup {
  id: number
  name: string
  color: string
  sort_order: number
  source_chapter_id: number | null
  palaces: PalaceGroupedSummaryItem[]
}
export interface PalaceGroupedListResponse {
  groups: PalaceGroupSummary[]
  ungrouped: PalaceGroupedItem[]
  subjects: PalaceSubjectGroup[]
}
export interface PalaceGroupedSummaryListResponse {
  groups: PalaceGroupedSummaryGroup[]
  ungrouped: PalaceGroupedSummaryItem[]
  subjects: PalaceSummarySubjectGroup[]
}
export interface PalaceVersionSummary {
  id: number
  palace_id: number
  trigger_reason: string
  title: string
  created_at_value: string | null
  created_at: string | null
}
export interface PalaceVersionListResponse {
  palace_id: number
  palace_title: string
  removed_duplicates?: number
  versions: PalaceVersionSummary[]
}
export interface PalaceVersionDetail extends PalaceVersionSummary {
  editor_doc: Record<string, unknown> | string | null
  editor_config: Record<string, unknown> | string | null
  editor_local_config: Record<string, unknown> | string | null
}
export interface PalaceTemplateSummary {
  id: number
  name: string
  description: string
  source_palace_id: number | null
  created_at: string | null
}
export interface SessionProgressSnapshot {
  id: number
  session_kind: "practice"
  palace_id: number | null
  reveal_map: Record<string, "hidden" | "placeholder" | "revealed">
  red_node_ids: string[]
  completed: boolean
  updated_at: string | null
}
