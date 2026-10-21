/**
 * Public surface for module `content`.
 * Other modules may import only from this file.
 */
import { lazy } from 'react'

export * from './domain/knowledge-entity/api'
export * from './domain/mindmap-document-entity'
export * from './domain/palace-entity/api'
export * from './ui/mindmap-editor'
export * from './ui/mindmap-experience'
// Full pages are exported lazily: app-shell providers import this barrel, and a static page export would pull the
// whole palace-catalog and practice graph (editor, freestyle, katex/prosemirror) into the entry chunk.
export const PalaceListPage = lazy(() => import('./ui/palace-catalog/PalaceListPage'))
export const PalaceShelfPage = lazy(() => import('./ui/palace-catalog/PalaceShelfPage'))
export { buildPalaceParentQuestionTotals, usePalaceParentQuestionTotal } from './ui/palace-catalog/usePalaceParentQuestionTotal'
export * from './ui/palace-edit/components/PalaceAttachmentPanel'
export * from './ui/palace-edit/components/PalaceMetaPanel'
export * from './ui/palace-edit/components/PalaceTemplateDialog'
export * from './ui/palace-edit/hooks/usePalaceEditPage'
export { usePalacePracticeMode } from './ui/palace-edit/hooks/usePalacePracticeMode'
export * from './ui/palace-edit/hooks/usePalaceMindMapFileTransfer'
export * from './ui/palace-edit/model/palace-edit-format'
