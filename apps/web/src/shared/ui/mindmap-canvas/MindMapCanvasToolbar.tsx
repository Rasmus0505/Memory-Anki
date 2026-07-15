import {
  Maximize2,
  Minimize2,
  Redo2,
  RefreshCw,
  Undo2,
} from 'lucide-react'
import type { ReactNode } from 'react'

interface MindMapCanvasToolbarProps {
  focusMode: boolean
  focusModeLabel?: string
  canUndo: boolean
  canRedo: boolean
  showHistoryControls: boolean
  leadingContent?: ReactNode
  onRefreshHost: () => void
  onToggleFocusMode?: () => void
  onUndo?: () => void
  onRedo?: () => void
}

export function MindMapCanvasToolbar({
  focusMode,
  focusModeLabel = '网页内全屏',
  canUndo,
  canRedo,
  showHistoryControls,
  leadingContent,
  onRefreshHost,
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
        onClick={onRefreshHost}
        className="flex size-9 items-center justify-center rounded-xl border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-primary"
        title="刷新脑图"
      >
        <RefreshCw className="size-4" />
      </button>
      <button
        type="button"
        onClick={onToggleFocusMode}
        className={`flex size-9 items-center justify-center rounded-xl border transition-colors ${
          focusMode
            ? 'border-info/30 bg-info/5 text-info hover:border-info/50 hover:bg-info/10'
            : 'border-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-primary'
        }`}
        title={`${focusMode ? '退出' : '进入'}${focusModeLabel}`}
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
