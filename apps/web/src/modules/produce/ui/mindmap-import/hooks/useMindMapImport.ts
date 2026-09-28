import { useState, type ChangeEvent } from 'react'
import type { MindMapEditorState, MindMapImportSourceTree } from '@/shared/api/contracts'
import type { ImportApplyContext } from '@/shared/api/contracts/imports'
import { useImportApplyController } from '@/modules/produce/ui/mindmap-import/hooks/useImportApplyController'
import {
  MANUAL_MINDMAP_JSON_PROMPT,
  parseManualMindMapImport,
  parseManualMindMapImportFile,
} from '@/modules/produce/ui/mindmap-import/model/manual-import'

interface UseMindMapImportOptions {
  entityKey: string | null
  editorState: MindMapEditorState | null
  setEditorState: (nextState: MindMapEditorState) => void
  applyEditorState?: (nextState: MindMapEditorState, context?: ImportApplyContext) => Promise<void> | void
  selectedNodeUid?: string | null
}

/** Clipboard read for 文字转脑图. Empty string means the user can still paste in the drawer. */
export async function readClipboardTextForMindMapImport(): Promise<string> {
  try {
    const readText = navigator.clipboard?.readText
    if (!readText) return ''
    return await readText.call(navigator.clipboard)
  } catch {
    return ''
  }
}

export function useMindMapImport({
  entityKey,
  editorState,
  setEditorState,
  applyEditorState,
  selectedNodeUid = null,
}: UseMindMapImportOptions) {
  const [importOpen, setImportOpen] = useState(false)
  const [error, setError] = useState('')
  const [sourceTree, setSourceTree] = useState<MindMapImportSourceTree | null>(null)
  const [previewEditorDoc, setPreviewEditorDoc] = useState<MindMapEditorState['editor_doc'] | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [manualImportText, setManualImportText] = useState('')
  const [manualImportFileName, setManualImportFileName] = useState('')

  const apply = useImportApplyController({
    entityKey,
    editorState,
    setEditorState,
    applyEditorState,
    selectedNodeUid,
    importEditorDoc: previewEditorDoc,
    sourceTitle: sourceTree?.title || '',
    currentJobId: null,
    sourceKind: 'manual-json',
    setImportOpen,
    setError,
  })

  const applyParsedManualImport = (parsed: ReturnType<typeof parseManualMindMapImport>) => {
    if (parsed.ok === false) {
      setSourceTree(null)
      setPreviewEditorDoc(null)
      setWarnings([])
      setError(parsed.error)
      return false
    }
    setError('')
    setSourceTree(parsed.sourceTree)
    setPreviewEditorDoc(parsed.editorDoc)
    setWarnings(parsed.warnings)
    return true
  }

  const handleManualImportParse = () => {
    applyParsedManualImport(parseManualMindMapImport(manualImportText))
  }

  const openManualJsonPreview = (text: string) => {
    const content = String(text ?? '')
    setManualImportText(content)
    setManualImportFileName('')
    setImportOpen(true)
    applyParsedManualImport(parseManualMindMapImport(content))
  }

  const handleManualImportFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const content = await file.text()
      setManualImportFileName(file.name)
      setManualImportText(content)
      applyParsedManualImport(parseManualMindMapImportFile(file.name, content))
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : '读取文件失败。'
      setSourceTree(null)
      setPreviewEditorDoc(null)
      setWarnings([])
      setError(message)
    }
  }

  return {
    manualImportText,
    setManualImportText,
    manualImportFileName,
    manualImportFormatPrompt: MANUAL_MINDMAP_JSON_PROMPT,
    handleManualImportParse,
    openManualJsonPreview,
    handleManualImportFileChange,
    importOpen,
    setImportOpen,
    importMode: 'mindmap' as const,
    importSourceKind: 'manual-json' as const,
    importLoading: false,
    importApplying: apply.applying,
    importUndoing: apply.undoing,
    importError: error,
    importSourceTree: sourceTree,
    importPreviewEditorDoc: previewEditorDoc,
    importCanAppend: Boolean(selectedNodeUid),
    importCanUndoLastImport: apply.canUndoLastImport,
    importExternalSyncKey: apply.externalSyncKey,
    importAppliedSyncVersion: apply.appliedSyncVersion,
    importWarnings: warnings,
    handleImportApplyReplace: apply.handleApplyReplace,
    handleImportApplyAppend: apply.handleApplyAppend,
    handleUndoLastImport: apply.handleUndoLastImport,
  }
}
