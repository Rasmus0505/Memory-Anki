import { Check, Copy } from 'lucide-react'
import type { MindMapImportFooterModel } from '@/modules/produce/ui/mindmap-import/components/import-drawer/types'
import { Button } from '@/shared/components/ui/button'

interface MindMapImportFooterProps {
  model: MindMapImportFooterModel
  copied: boolean
  onCopyText: () => Promise<void>
}

export function MindMapImportFooter({ model, copied, onCopyText }: MindMapImportFooterProps) {
  const {
    onClose,
    mode,
    targetNodeLabel,
    canUndoLastImport,
    loading,
    applying,
    undoing,
    onUndoLastImport,
    onApplyAppend,
    onApplyReplace,
    sourceTree,
    canAppend,
    extractedText,
  } = model

  return (
    <div className="shrink-0 border-t px-6 py-4">
      {mode === 'mindmap' ? (
        <>
          <div className="mb-3 text-xs text-muted-foreground">
            追加目标：{targetNodeLabel || '请先在脑图中选中一个知识点'}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              variant="outline"
              onClick={onUndoLastImport}
              disabled={!canUndoLastImport || loading || applying || undoing}
            >
              {undoing ? '撤销中…' : '撤销最近一次导入'}
            </Button>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="ghost" onClick={onClose} disabled={loading || applying || undoing}>
                关闭窗口
              </Button>
              <Button
                variant="outline"
                onClick={onApplyAppend}
                disabled={!sourceTree || !canAppend || loading || applying || undoing}
              >
                {applying ? '应用中…' : '追加到选中知识点'}
              </Button>
              <Button onClick={onApplyReplace} disabled={!sourceTree || loading || applying || undoing}>
                {applying ? '应用中…' : '应用到宫殿（覆盖）'}
              </Button>
            </div>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 flex-1 text-xs text-muted-foreground">
            文字会保留在这里，复制后可直接回到脑图里继续编辑，不会自动关闭。
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={loading}>
              关闭窗口
            </Button>
            <Button variant="outline" onClick={() => void onCopyText()} disabled={!extractedText}>
              {copied ? <Check className="mr-2 size-4" /> : <Copy className="mr-2 size-4" />}
              {copied ? '已复制' : '复制全部'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
