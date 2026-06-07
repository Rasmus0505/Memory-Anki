import { API_BASE, request } from '@/shared/api/http'

export interface MindMapEditorState {
  editor_doc: Record<string, unknown> | string | null
  editor_config: Record<string, unknown>
  editor_local_config: Record<string, unknown>
  lang: string
}

export interface PalaceEditorSavePayload extends Partial<MindMapEditorState> {
  editor_source?:
    | 'palace_edit'
    | 'palace_edit_autosave'
    | 'host_bootstrap_sync'
    | 'version_restore'
    | 'backup_restore'
    | 'import_apply'
    | 'review_edit'
    | 'practice_edit'
    | 'unknown'
  sync_reason?: string | null
  allow_stale_overwrite?: boolean
  confirm_dangerous_change?: boolean
}

export interface MindMapNodeData {
  text?: string
  note?: string
  uid?: string
  memoryAnkiId?: number | null
  memoryAnkiNodeType?: string | null
  memoryAnkiRootKind?: string | null
  [key: string]: unknown
}

export interface MindMapDocNode {
  data?: MindMapNodeData
  children?: MindMapDocNode[]
  [key: string]: unknown
}

export interface MindMapDoc {
  root?: MindMapDocNode
  [key: string]: unknown
}

export interface ReviewQueueChapter {
  id: number
  name: string
  subject_id: number
  subject: { id: number; name: string } | null
}

export interface ReviewPalaceSummary {
  id: number
  title: string
  description: string
  archived: boolean
  mastered: boolean
  needs_practice?: boolean
  editor_doc: MindMapDoc | string | null
  pegs: Array<{ id: number; name: string; content: string; children: unknown[] }>
  attachments: Array<{ id: number; filename: string; original_name: string }>
  chapters: ReviewQueueChapter[]
}

export interface ReviewScheduleSummary {
  id: number
  palace_id: number
  scheduled_date: string
  interval_days: number
  algorithm_used: string
  completed: boolean
  review_number: number
  review_type: string
  schedule_count: number
  overdue_schedule_count: number
  next_due_date: string
  palace: ReviewPalaceSummary | null
}

export interface ReviewQueueResponse {
  due_count: number
  overdue_count: number
  smoothed_count: number
  stats: {
    total: number
    review_count: number
    review_duration_seconds: number
  }
  chapter: ReviewQueueChapter | null
  reviews: ReviewScheduleSummary[]
}

export interface PalaceReviewPlanItem {
  date: string | null
  representative_schedule_id: number
  schedule_count: number
  pending_count: number
  completed_count: number
  completed: boolean
  review_number: number
  interval_days: number
}

export interface PalaceReviewPlanResponse {
  palace_id: number
  palace_title: string
  plan: PalaceReviewPlanItem[]
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

export interface SessionProgressSnapshot {
  id: number
  session_kind: 'practice' | 'review'
  palace_id: number | null
  review_schedule_id: number | null
  reveal_map: Record<string, 'hidden' | 'placeholder' | 'revealed'>
  red_node_ids: string[]
  completed: boolean
  updated_at: string | null
}

export interface BackupSummary {
  kind: 'full' | 'rescue'
  name: string
  path: string
  created_at: string
  reason: string
  has_database: boolean
  has_attachments: boolean
}

export interface BackupListResponse {
  items: BackupSummary[]
}

export interface TimeRecordListResponse {
  items: Array<Record<string, unknown>>
}

export function buildAttachmentUrl(attachmentId: number) {
  return `${API_BASE}/attachments/${attachmentId}`
}

export const api = {
  getDashboard: () => request<any>('/dashboard'),
  getTimeRecords: (params?: { includeDeleted?: boolean; includeBelowThreshold?: boolean }) => {
    const search = new URLSearchParams()
    if (params?.includeDeleted) search.set('include_deleted', 'true')
    if (params?.includeBelowThreshold) search.set('include_below_threshold', 'true')
    const suffix = search.toString() ? `?${search.toString()}` : ''
    return request<TimeRecordListResponse>(`/time-records${suffix}`)
  },

  getPalaces: (params?: Record<string, string>) => {
    const q = params ? `?${new URLSearchParams(params).toString()}` : ''
    return request<any[]>(`/palaces${q}`)
  },
  getPalace: (id: number) => request<any>(`/palaces/${id}`),
  getPalaceReviewPlan: (id: number) =>
    request<PalaceReviewPlanResponse>(`/palaces/${id}/review-plan`),
  createPalace: (data: any) =>
    request<any>('/palaces', { method: 'POST', body: JSON.stringify(data) }),
  updatePalace: (id: number, data: any) =>
    request<any>(`/palaces/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePalace: (id: number) => request<any>(`/palaces/${id}`, { method: 'DELETE' }),

  uploadAttachment: async (palaceId: number, file: File) => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${API_BASE}/palaces/${palaceId}/upload`, {
      method: 'POST',
      body: form,
    })
    return res.json()
  },
  deleteAttachment: (id: number) => request<any>(`/attachments/${id}`, { method: 'DELETE' }),

  getReviews: () => request<ReviewQueueResponse>('/review'),
  getReviewQueue: () => request<ReviewQueueResponse>('/review/queue'),
  getChapterReviewQueue: (chapterId: number) =>
    request<ReviewQueueResponse>(`/review/chapter/${chapterId}/queue`),
  getReviewItem: (id: number) => request<ReviewScheduleSummary>(`/review/${id}`),
  getReviewSession: (id: number) => request<ReviewScheduleSummary>(`/review/session/${id}`),
  getReviewSessionProgress: (id: number) =>
    request<{ progress: SessionProgressSnapshot | null }>(`/sessions/review/${id}/progress`),
  saveReviewSessionProgress: (
    id: number,
    data: {
      reveal_map: Record<string, 'hidden' | 'placeholder' | 'revealed'>
      red_node_ids: string[]
      completed: boolean
    },
  ) =>
    request<{ progress: SessionProgressSnapshot }>(`/sessions/review/${id}/progress`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  clearReviewSessionProgress: (id: number) =>
    request<{ ok: boolean }>(`/sessions/review/${id}/progress`, { method: 'DELETE' }),
  submitReview: (id: number, data: any) =>
    request<any>(`/review/${id}/submit`, { method: 'POST', body: JSON.stringify(data) }),
  submitReviewSession: (
    id: number,
    data: {
      chapter_id?: number
      duration_seconds?: number
      completion_mode?: 'manual_complete' | 'auto_complete'
      revealed_remaining?: boolean
      red_marked_count?: number
      needs_practice?: boolean
    },
  ) =>
    request<any>(`/review/session/${id}/submit`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getWeeklyStats: () => request<any>('/review/stats/weekly'),

  getSettings: () => request<any>('/settings'),
  updateSettings: (data: any) =>
    request<any>('/settings', { method: 'PUT', body: JSON.stringify(data) }),
  getReviewSettings: () => request<any>('/settings/review'),
  updateReviewSettings: (data: any) =>
    request<any>('/settings/review', { method: 'PUT', body: JSON.stringify(data) }),

  spreadOverdue: (days: number) =>
    request<any>('/review/spread-overdue', {
      method: 'POST',
      body: JSON.stringify({ days }),
    }),
  getOverdueCount: () => request<any>('/review/overdue-count'),

  exportJson: () => `${API_BASE}/export/json`,
  exportMarkdown: () => `${API_BASE}/export/markdown`,
  importFile: async (file: File, format: string) => {
    const form = new FormData()
    form.append('file', file)
    form.append('format', format)
    const res = await fetch(`${API_BASE}/import`, { method: 'POST', body: form })
    return res.json()
  },

  getSubjects: () => request<any[]>('/subjects'),
  createSubject: (data: any) =>
    request<any>('/subjects', { method: 'POST', body: JSON.stringify(data) }),
  updateSubject: (id: number, data: any) =>
    request<any>(`/subjects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteSubject: (id: number) => request<any>(`/subjects/${id}`, { method: 'DELETE' }),
  getSubjectTree: (id: number) => request<any>(`/subjects/${id}/tree`),
  getChapter: (id: number) => request<any>(`/chapters/${id}`),
  createChapter: (subjectId: number, data: any) =>
    request<any>(`/subjects/${subjectId}/chapters`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateChapter: (id: number, data: any) =>
    request<any>(`/chapters/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteChapter: (id: number) => request<any>(`/chapters/${id}`, { method: 'DELETE' }),
  getSubjectEditor: (id: number) =>
    request<{ subject: any } & MindMapEditorState>(`/subjects/${id}/editor`),
  saveSubjectEditor: (id: number, data: Partial<MindMapEditorState>) =>
    request<{ subject: any } & MindMapEditorState>(`/subjects/${id}/editor`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  getPalaceChapters: (id: number) => request<any[]>(`/palaces/${id}/chapters`),
  linkPalaceChapters: (
    palaceId: number,
    data: { chapter_ids: number[]; primary_chapter_id?: number | null },
  ) =>
    request<any>(`/palaces/${palaceId}/chapters`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  getPalaceEditor: (id: number) =>
    request<{ palace: any } & MindMapEditorState>(`/palaces/${id}/editor`),
  savePalaceEditor: (id: number, data: PalaceEditorSavePayload) =>
    request<{ palace: any } & MindMapEditorState>(`/palaces/${id}/editor`, {
      method: 'PUT',
      body: JSON.stringify({ editor_source: 'palace_edit_autosave', ...data }),
    }),
  savePalaceEditorWithOptions: (id: number, data: Record<string, unknown>) =>
    request<{ palace: any } & MindMapEditorState>(`/palaces/${id}/editor`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  getPracticeSessionProgress: (id: number) =>
    request<{ progress: SessionProgressSnapshot | null }>(`/sessions/practice/${id}/progress`),
  savePracticeSessionProgress: (
    id: number,
    data: {
      reveal_map: Record<string, 'hidden' | 'placeholder' | 'revealed'>
      red_node_ids: string[]
      completed: boolean
    },
  ) =>
    request<{ progress: SessionProgressSnapshot }>(`/sessions/practice/${id}/progress`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  clearPracticeSessionProgress: (id: number) =>
    request<{ ok: boolean }>(`/sessions/practice/${id}/progress`, { method: 'DELETE' }),
  getPalaceVersions: (id: number) =>
    request<PalaceVersionListResponse>(`/palaces/${id}/versions`),
  getPalaceVersionDetail: (palaceId: number, versionId: number) =>
    request<PalaceVersionDetail>(`/palaces/${palaceId}/versions/${versionId}`),
  restorePalaceVersion: (id: number, versionId: number) =>
    request<any>(`/palaces/${id}/restore-version`, {
      method: 'POST',
      body: JSON.stringify({ version_id: versionId }),
    }),

  getBackups: () => request<BackupListResponse>('/backups'),
  createBackup: (reason = 'manual') =>
    request<{ ok: boolean; path: string }>('/backups/create', {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  restoreBackup: (path: string) =>
    request<{ ok: boolean; rescue_path: string }>('/backups/restore-database', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  recoverPalacesFromCommit: (commit: string, palaceIds: number[]) =>
    request<any>('/backups/recover-palaces', {
      method: 'POST',
      body: JSON.stringify({ commit, palace_ids: palaceIds }),
    }),
  restorePalaceFromBackup: (path: string, palaceId: number) =>
    request<{
      ok: boolean
      restored: {
        palace_id: number
        source_backup_path: string
        restored_title: string
        restored_node_count: number
        restored_peg_count: number
        rescue_snapshot_path: string
      }
    }>('/backups/restore-palace-from-backup', {
      method: 'POST',
      body: JSON.stringify({ path, palace_id: palaceId }),
    }),

  getConnections: (params?: { source_type?: string; source_id?: number }) => {
    const q = params
      ? `?${new URLSearchParams(
          Object.entries(params)
            .filter(([, value]) => value != null)
            .map(([key, value]) => [key, String(value)]),
        ).toString()}`
      : ''
    return request<any[]>(`/connections${q}`)
  },
  createConnection: (data: {
    source_type: string
    source_id: number
    target_type: string
    target_id: number
    label?: string
    style?: string
  }) => request<any>('/connections', { method: 'POST', body: JSON.stringify(data) }),
  deleteConnection: (id: number) => request<any>(`/connections/${id}`, { method: 'DELETE' }),
}
