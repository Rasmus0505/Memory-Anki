import {
  Maximize2,
  Minimize2,
  Redo2,
  RotateCcw,
  Undo2,
} from 'lucide-react'
import type { ReactNode } from 'react'

interface MindMapCanvasToolbarProps {
  focusMode: boolean
  canUndo: boolean
  canRedo: boolean
  showHistoryControls: boolean
  leadingContent?: ReactNode
  onReflow: () => void
  onToggleFocusMode?: () => void
  onUndo?: () => void
  onRedo?: () => void
}

export function MindMapCanvasToolbar({
  focusMode,
  canUndo,
  canRedo,
  showHistoryControls,
  leadingContent,
  onReflow,
  onToggleFocusMode,
  onUndo,
  onRedo,
}: MindMapCanvasToolbarProps) {
  return (
    <div className="flex h-[62px] shrink-0 flex-nowrap items-center gap-2 overflow-x-auto border-b border-border bg-background px-3 py-2">
      {leadingContent}
      {leadingContent ? <div className="h-5 w-px shrink-0 bg-border" /> : null}
      <button
        type="button"
        onClick={onReflow}
        className="flex h-9 items-center justify-center gap-2 rounded-xl border border-transparent px-3 text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-primary"
        title="手动整理画布"
      >
        <RotateCcw className="size-4" />
        <span className="text-xs font-medium">整理画布</span>
      </button>
      <button
        type="button"
        onClick={onToggleFocusMode}
        className={`flex size-9 items-center justify-center rounded-xl border transition-colors ${
          focusMode
            ? 'border-info/30 bg-info/5 text-info hover:border-info/50 hover:bg-info/10'
            : 'border-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-primary'
        }`}
        title={focusMode ? '退出画布专注模式' : '进入画布专注模式'}
      >
        {focusMode ? (
          <Minimize2 className="size-4" />
        ) : (
          <Maximize2 className="size-4" />
        )}
      </button>
      {showHistoryControls ? <div className="mx-1 h-5 w-px bg-border" /> : null}
      {onUndo ? (
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          className="flex size-9 items-center justify-center rounded-xl border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-primary disabled:opacity-30"
          title="撤销"
        >
          <Undo2 className="size-4" />
        </button>
      ) : null}
      {onRedo ? (
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          className="flex size-9 items-center justify-center rounded-xl border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-primary disabled:opacity-30"
          title="重做"
        >
          <Redo2 className="size-4" />
        </button>
      ) : null}
    </div>
  )
}
