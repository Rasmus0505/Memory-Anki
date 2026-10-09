import { MindMapEditorSurface } from '@/modules/content/public'
import { MindMapImportDrawer, useMindMapImport } from '@/modules/produce/public'

interface FreestyleMindMapImportDrawerProps {
  mindMapImport: ReturnType<typeof useMindMapImport>
  targetNodeLabel: string
}

export function FreestyleMindMapImportDrawer({
  mindMapImport,
  targetNodeLabel,
}: FreestyleMindMapImportDrawerProps) {
  return (
    <MindMapImportDrawer
      open={mindMapImport.importOpen}
      onOpenChange={mindMapImport.setImportOpen}
      applying={mindMapImport.importApplying}
      undoing={mindMapImport.importUndoing}
      error={mindMapImport.importError}
      sourceTree={mindMapImport.importSourceTree}
      previewEditorDoc={mindMapImport.importPreviewEditorDoc}
      renderMindMapPreview={(editorState, version) => (
        <MindMapEditorSurface
          key={`freestyle-import-preview-${version}`}
          editorState={editorState}
          readonly
          syncOnPropChange
          forceSyncKey={`preview:${version}`}
          preserveViewOnSync={false}
          onEditorStateChange={() => {}}
          className="h-full w-full"
        />
      )}
      targetNodeLabel={targetNodeLabel}
      canAppend={mindMapImport.importCanAppend}
      canUndoLastImport={mindMapImport.importCanUndoLastImport}
      manualImportText={mindMapImport.manualImportText}
      onManualImportTextChange={mindMapImport.setManualImportText}
      manualImportFileName={mindMapImport.manualImportFileName}
      manualImportFormatPrompt={mindMapImport.manualImportFormatPrompt}
      onManualImportParse={mindMapImport.handleManualImportParse}
      onManualImportFileChange={(event) => void mindMapImport.handleManualImportFileChange(event)}
      onApplyReplace={mindMapImport.handleImportApplyReplace}
      onApplyAppend={mindMapImport.handleImportApplyAppend}
      onUndoLastImport={mindMapImport.handleUndoLastImport}
    />
  )
}
