export interface ImportSubjectOption {
  id: number
  name: string
}

export interface PdfDocument {
  id: string
  original_name: string
  mime_type: string
  file_size: number
  page_count: number
  created_at?: string | null
}
