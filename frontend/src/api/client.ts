import { API_BASE } from '@/lib/utils'

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
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
  getReviews: () => request<any>('/review'),
  getReviewItem: (id: number) => request<any>(`/review/${id}`),
  submitReview: (id: number, data: any) => request<any>(`/review/${id}/submit`, { method: 'POST', body: JSON.stringify(data) }),
  getWeeklyStats: () => request<any>('/review/stats/weekly'),

  // Settings
  getSettings: () => request<any>('/settings'),
  updateSettings: (data: any) => request<any>('/settings', { method: 'PUT', body: JSON.stringify(data) }),

  // Archive & Master
  archivePalace: (id: number, archived: boolean) => request<any>(`/palaces/${id}/archive`, { method: 'PUT', body: JSON.stringify({ archived }) }),

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
  getSubjectTree: (id: number) => request<any>(`/subjects/${id}/tree`),
  getChapter: (id: number) => request<any>(`/chapters/${id}`),
  createChapter: (subjectId: number, data: any) => request<any>(`/subjects/${subjectId}/chapters`, { method: 'POST', body: JSON.stringify(data) }),
  updateChapter: (id: number, data: any) => request<any>(`/chapters/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteChapter: (id: number) => request<any>(`/chapters/${id}`, { method: 'DELETE' }),
  getPalaceChapters: (id: number) => request<any[]>(`/palaces/${id}/chapters`),
  linkPalaceChapters: (palaceId: number, chapterIds: number[]) => request<any>(`/palaces/${palaceId}/chapters`, { method: 'PUT', body: JSON.stringify({ chapter_ids: chapterIds }) }),

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
