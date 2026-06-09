export interface SubjectDocumentSummary {
  id: number
  subject_id: number
  filename: string
  original_name: string
  mime_type: string
  file_size: number
  page_count: number
  created_at: string | null
}
export interface PdfPageSummary {
  page_number: number
  thumbnail_url: string
  preview_url: string
}
export interface BilinkSearchResult {
  type: 'node' | 'palace'
  palace_id: number
  palace_title: string
  node_uid: string | null
  node_text: string | null
  node_path: string[] | null
}
export interface BilinkSearchResponse {
  results: BilinkSearchResult[]
}
export interface BilinkItem {
  id: number
  direction: 'incoming' | 'outgoing' | null
  source_palace_id: number
  source_palace_title: string
  target_palace_id: number
  target_palace_title: string
  src_uid: string | null
  tgt_uid: string | null
  text: string
  source_node_text: string | null
  target_node_text: string | null
  source_node_path: string[] | null
  target_node_path: string[] | null
}
export interface BilinkListResponse {
  items: BilinkItem[]
}
export interface BilinkCountsResponse {
  counts: Record<string, number>
}
export interface BilinkNodeSummary {
  uid: string
  text: string
}
export interface BilinkNodeContext {
  palace_id: number
  palace_title: string
  node_uid: string | null
  node_text: string
  node_note: string
  node_path: string[]
  parent_text: string | null
  children: BilinkNodeSummary[]
  siblings: BilinkNodeSummary[]
}
