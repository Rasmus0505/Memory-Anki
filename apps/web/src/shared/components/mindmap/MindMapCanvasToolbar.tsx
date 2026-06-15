import {
  Maximize2,
  Minimize2,
  Redo2,
  RotateCcw,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'

interface MindMapCanvasToolbarProps {
  focusMode: boolean
  canUndo: boolean
  canRedo: boolean
  showHistoryControls: boolean
  onReflow: () => void
  onZoomOut: () => void
  onZoomIn: () => void
  onToggleFocusMode?: () => void
  onUndo?: () => void
  onRedo?: () => void
}

export function MindMapCanvasToolbar({
  focusMode,
  canUndo,
  canRedo,
  showHistoryControls,
  onReflow,
  onZoomOut,
  onZoomIn,
  onToggleFocusMode,
  onUndo,
  onRedo,
}: MindMapCanvasToolbarProps) {
  return (
    <div className="flex h-[54px] shrink-0 flex-wrap items-center gap-1 border-b border-border bg-background px-3 py-2">
      <button
        type="button"
        onClick={onReflow}
        className="flex h-9 items-center justify-center gap-2 rounded-xl border border-transparent px-3 text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-primary"
        title="手动整理画布"
      >
        <RotateCcw className="h-4 w-4" />
        <span className="text-xs font-medium">整理画布</span>
      </button>
      <div className="mx-1 h-5 w-px bg-border" />
      <button
        type="button"
        onClick={onZoomOut}
        className="flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-primary"
        title="缩小"
      >
        <ZoomOut className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onZoomIn}
        className="flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-primary"
        title="放大"
      >
        <ZoomIn className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onToggleFocusMode}
        className={`flex h-9 w-9 items-center justify-center rounded-xl border transition-colors ${
          focusMode
            ? 'border-info/30 bg-info/5 text-info hover:border-info/50 hover:bg-info/10'
            : 'border-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-primary'
        }`}
        title={focusMode ? '退出画布专注模式' : '进入画布专注模式'}
      >
        {focusMode ? (
          <Minimize2 className="h-4 w-4" />
        ) : (
          <Maximize2 className="h-4 w-4" />
        )}
      </button>
      {showHistoryControls ? <div className="mx-1 h-5 w-px bg-border" /> : null}
      {onUndo ? (
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-primary disabled:opacity-30"
          title="撤销"
        >
          <Undo2 className="h-4 w-4" />
        </button>
      ) : null}
      {onRedo ? (
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-primary disabled:opacity-30"
          title="重做"
        >
          <Redo2 className="h-4 w-4" />
        </button>
      ) : null}
      <div className="ml-auto text-[11px] font-medium tracking-wide text-muted-foreground/70">
        拖拽时会即时预演落点，只有点击“整理画布”才会全局重排
      </div>
    </div>
  )
}
