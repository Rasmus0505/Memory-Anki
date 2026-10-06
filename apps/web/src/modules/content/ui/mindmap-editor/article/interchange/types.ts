import type { MindMapDocumentV1 } from '@/modules/content/domain/mindmap-document-entity/model/document'

export interface ArticleInterchangeWarning {
  code: 'plain-markdown-lossy' | 'html-removed' | 'unsafe-url' | 'unsupported-content' | 'identity-unverified' | 'identity-ambiguous' | 'identity-missing' | 'assets-not-packaged' | 'quiz-not-packaged' | 'external-assets' | 'owner-mismatch'
  message: string
  nodeUid?: string
}
export interface ArticlePreview {
  document: MindMapDocumentV1
  warnings: ArticleInterchangeWarning[]
}
export interface MarkdownImportOptions {
  title?: string
  createUid?: () => string
}
export interface MarkdownExport {
  markdown: string
  warnings: ArticleInterchangeWarning[]
}
export interface ArticlePackageAsset {
  /** Exact reference used in document image src; backend adapter restores/remaps it. */
  source: string
  path: string
  bytes: Uint8Array
  mediaType: string
}
export interface ArticlePackageManifest {
  format: 'memory-anki-article'
  version: 1
  sourceOwner: string
  baseRevision: string | null
  document: 'document.json'
  baseDocument: 'base-document.json'
  content: 'content.md'
  assets: { source: string; path: string; mediaType: string }[]
  quiz: { path: 'quiz.json'; format: string } | null
}
export interface ArticlePackageOptions {
  sourceOwner: string
  baseRevision?: string | null
  assets?: ArticlePackageAsset[]
  /** Opaque backend-owned payload. Interchange never applies quiz bindings. */
  quiz?: { format: string; data: unknown }
}
export interface ArticlePackagePreview extends ArticlePreview {
  manifest: ArticlePackageManifest
  baseDocument: MindMapDocumentV1
  assets: ArticlePackageAsset[]
  quiz: { format: string; data: unknown } | null
  /** Caller must explicitly reconcile owner/revision and remap assets before applying. */
  requiresReconciliation: true
}
export const ARTICLE_PACKAGE_LIMITS = {
  compressedBytes: 16 * 1024 * 1024,
  expandedBytes: 32 * 1024 * 1024,
  entryBytes: 8 * 1024 * 1024,
  entries: 256,
  nodes: 5000,
  depth: 64,
  markdownChars: 2_000_000,
} as const
