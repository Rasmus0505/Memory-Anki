export type ImportMode = 'mindmap' | 'text'
export type MindMapImportWorkflow = 'single' | 'batch'
export type ImportSourceKind = 'image-single' | 'image-batch'
export type BatchImportStatus = 'idle' | 'ready' | 'loading' | 'success' | 'error'

export interface BatchImportImageItem {
  id: string
  file: File
  previewUrl: string
  name: string
}

export interface BatchImportMeta {
  structureImageIndex: number | null
  imageCount: number
}
export interface ImportApplyContext {
  source: 'import'
  jobId: string | null
  applyMode: 'replace' | 'append'
  sourceTitle: string
  expectedFingerprint?: string | null
  expectedNodeCount?: number | null
}
