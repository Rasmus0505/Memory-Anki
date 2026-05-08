import { API_BASE } from '@/lib/utils'

export interface MindMapEditorState {
  editor_doc: Record<string, unknown>
  editor_config: Record<string, unknown>
  editor_local_config: Record<string, unknown>
  lang: string
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
  editor_doc: MindMapDoc | string | null
  pegs: Array<{ id: number; name: string; content: string; children: any[] }>
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
  palace: ReviewPalaceSummary | null
}

export interface ReviewQueueResponse {
  due_count: number
  overdue_count: number
  smoothed_count: number
  stats: {
    total: number
    completed: number
    completion_rate: number
    avg_score: number
  }
  chapter: ReviewQueueChapter | null
  reviews: ReviewScheduleSummary[]
}

export interface PalaceReviewPlanItem {
  id: number
  scheduled_date: string | null
  completed: boolean
  review_number: number
  algorithm_used: string
  review_type: string
  interval_days: number
}

export interface PalaceReviewPlanResponse {
  palace_id: number
  palace_title: string
  plan: PalaceReviewPlanItem[]
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(body || `HTTP ${res.status}`)
  }
  const ct = res.headers.get('content-type')
  if (ct?.includes('application/json')) return res.json()
  return res.text() as unknown as T
}

// Palace API
export const api = {
  // Dashboard
  getDashboard: () => request<any>('/dashboard'),

  // Palaces
  getPalaces: (params?: Record<string, string>) => {
    const q = params ? '?' + new URLSearchParams(params).toString() : ''
    return request<any[]>(`/palaces${q}`)
  },
  getPalace: (id: number) => request<any>(`/palaces/${id}`),
  getPalaceReviewPlan: (id: number) => request<PalaceReviewPlanResponse>(`/palaces/${id}/review-plan`),
  createPalace: (data: any) => request<any>('/palaces', { method: 'POST', body: JSON.stringify(data) }),
  updatePalace: (id: number, data: any) => request<any>(`/palaces/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePalace: (id: number) => request<any>(`/palaces/${id}`, { method: 'DELETE' }),

  // Attachments
  uploadAttachment: async (palaceId: number, file: File) => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${API_BASE}/palaces/${palaceId}/upload`, { method: 'POST', body: form })
    return res.json()
  },
  deleteAttachment: (id: number) => request<any>(`/attachments/${id}`, { method: 'DELETE' }),

  // Review
  getReviews: () => request<ReviewQueueResponse>('/review'),
  getReviewQueue: () => request<ReviewQueueResponse>('/review/queue'),
  getChapterReviewQueue: (chapterId: number) => request<ReviewQueueResponse>(`/review/chapter/${chapterId}/queue`),
  getReviewItem: (id: number) => request<ReviewScheduleSummary>(`/review/${id}`),
  getReviewSession: (id: number) => request<ReviewScheduleSummary>(`/review/session/${id}`),
  submitReview: (id: number, data: any) => request<any>(`/review/${id}/submit`, { method: 'POST', body: JSON.stringify(data) }),
  submitReviewSession: (id: number, data: { rating: 'forgot' | 'fuzzy' | 'remembered'; chapter_id?: number; duration_seconds?: number }) =>
    request<any>(`/review/session/${id}/submit`, { method: 'POST', body: JSON.stringify(data) }),
  getWeeklyStats: () => request<any>('/review/stats/weekly'),

  // Settings
  getSettings: () => request<any>('/settings'),
  updateSettings: (data: any) => request<any>('/settings', { method: 'PUT', body: JSON.stringify(data) }),
  getReviewSettings: () => request<any>('/profile/review-settings'),
  updateReviewSettings: (data: any) => request<any>('/profile/review-settings', { method: 'PUT', body: JSON.stringify(data) }),

  // Overdue
  spreadOverdue: (days: number) => request<any>('/review/spread-overdue', { method: 'POST', body: JSON.stringify({ days }) }),
  getOverdueCount: () => request<any>('/review/overdue-count'),

  // Import/Export
  exportJson: () => `${API_BASE}/export/json`,
  exportMarkdown: () => `${API_BASE}/export/markdown`,
  importFile: async (file: File, format: string) => {
    const form = new FormData()
    form.append('file', file)
    form.append('format', format)
    const res = await fetch(`${API_BASE}/import`, { method: 'POST', body: form })
    return res.json()
  },

  // Knowledge (Subjects & Chapters)
  getSubjects: () => request<any[]>('/subjects'),
  createSubject: (data: any) => request<any>('/subjects', { method: 'POST', body: JSON.stringify(data) }),
  updateSubject: (id: number, data: any) => request<any>(`/subjects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteSubject: (id: number) => request<any>(`/subjects/${id}`, { method: 'DELETE' }),
  getSubjectTree: (id: number) => request<any>(`/subjects/${id}/tree`),
  getChapter: (id: number) => request<any>(`/chapters/${id}`),
  createChapter: (subjectId: number, data: any) => request<any>(`/subjects/${subjectId}/chapters`, { method: 'POST', body: JSON.stringify(data) }),
  updateChapter: (id: number, data: any) => request<any>(`/chapters/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteChapter: (id: number) => request<any>(`/chapters/${id}`, { method: 'DELETE' }),
  getSubjectEditor: (id: number) => request<{ subject: any } & MindMapEditorState>(`/subjects/${id}/editor`),
  saveSubjectEditor: (id: number, data: Partial<MindMapEditorState>) =>
    request<{ subject: any } & MindMapEditorState>(`/subjects/${id}/editor`, { method: 'PUT', body: JSON.stringify(data) }),
  getPalaceChapters: (id: number) => request<any[]>(`/palaces/${id}/chapters`),
  linkPalaceChapters: (palaceId: number, chapterIds: number[]) => request<any>(`/palaces/${palaceId}/chapters`, { method: 'PUT', body: JSON.stringify({ chapter_ids: chapterIds }) }),
  getPalaceEditor: (id: number) => request<{ palace: any } & MindMapEditorState>(`/palaces/${id}/editor`),
  savePalaceEditor: (id: number, data: Partial<MindMapEditorState>) =>
    request<{ palace: any } & MindMapEditorState>(`/palaces/${id}/editor`, { method: 'PUT', body: JSON.stringify(data) }),

  // Node Connections
  getConnections: (params?: { source_type?: string; source_id?: number }) => {
    const q = params ? '?' + new URLSearchParams(
      Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])
    ).toString() : ''
    return request<any[]>(`/connections${q}`)
  },
  createConnection: (data: { source_type: string; source_id: number; target_type: string; target_id: number; label?: string; style?: string }) =>
    request<any>('/connections', { method: 'POST', body: JSON.stringify(data) }),
  deleteConnection: (id: number) => request<any>(`/connections/${id}`, { method: 'DELETE' }),
}
