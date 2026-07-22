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

export interface PdfOcrCoveragePage {
  page_number: number
  reused_available: boolean
  model?: string | null
  source_job_id?: string | null
  updated_at?: string | null
  char_count?: number | null
}

export interface PdfOcrCoverage {
  document_id: string
  pages: PdfOcrCoveragePage[]
  page_numbers: number[]
  cached_page_count: number
}
