import type { ChangeEvent, ReactNode, RefObject } from 'react'
import type { MindMapEditorState, MindMapImportSourceTree } from '@/shared/api/contracts'

export interface MindMapImportDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  applying: boolean
  undoing: boolean
  error: string
  sourceTree: MindMapImportSourceTree | null
  previewEditorDoc: MindMapEditorState['editor_doc'] | null
  renderMindMapPreview: (editorState: MindMapEditorState, version: number) => ReactNode
  targetNodeLabel: string
  canAppend: boolean
  canUndoLastImport: boolean
  manualImportText: string
  onManualImportTextChange: (value: string) => void
  manualImportFileName: string
  manualImportFormatPrompt: string
  onManualImportParse: () => void
  onManualImportFileChange: (event: ChangeEvent<HTMLInputElement>) => void
  onApplyReplace: () => void
  onApplyAppend: () => void
  onUndoLastImport: () => void
  className?: string
  overlayClassName?: string
}

export type MindMapImportFooterModel = {
  applying: boolean
  canAppend: boolean
  canUndoLastImport: boolean
  extractedText: string
  loading: boolean
  mode: 'mindmap'
  onApplyAppend: () => void
  onApplyReplace: () => void
  onClose: () => void
  onUndoLastImport: () => void
  sourceTree: MindMapImportSourceTree | null
  targetNodeLabel: string
  undoing: boolean
}

export type MindMapImportResultsModel = {
  previewFrameVersion: number
  previewMindMapState: MindMapEditorState | null
  previewSectionRef: RefObject<HTMLElement | null>
  renderMindMapPreview: MindMapImportDrawerProps['renderMindMapPreview']
  sourceTree: MindMapImportSourceTree | null
}

export type MindMapImportSourceConfigModel = {
  applying: boolean
  error: string
  manualImportFileName: string
  manualImportFormatPrompt: string
  manualImportText: string
  nodeCount: number
  onManualImportFileChange: MindMapImportDrawerProps['onManualImportFileChange']
  onManualImportParse: () => void
  onManualImportTextChange: (value: string) => void
  sourceTree: MindMapImportSourceTree | null
  undoing: boolean
}
