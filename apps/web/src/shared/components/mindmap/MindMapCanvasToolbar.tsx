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
    <div className="flex h-[54px] shrink-0 flex-wrap items-center gap-1 border-b border-slate-200/80 bg-white px-3 py-2">
      <button
        type="button"
        onClick={onReflow}
        className="flex h-9 items-center justify-center gap-2 rounded-xl border border-transparent px-3 text-slate-600 transition-colors hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900"
        title="手动整理画布"
      >
        <RotateCcw className="h-4 w-4" />
        <span className="text-xs font-medium">整理画布</span>
      </button>
      <div className="mx-1 h-5 w-px bg-slate-200" />
      <button
        type="button"
        onClick={onZoomOut}
        className="flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-slate-600 transition-colors hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900"
        title="缩小"
      >
        <ZoomOut className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onZoomIn}
        className="flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-slate-600 transition-colors hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900"
        title="放大"
      >
        <ZoomIn className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onToggleFocusMode}
        className={`flex h-9 w-9 items-center justify-center rounded-xl border transition-colors ${
          focusMode
            ? 'border-blue-200 bg-blue-50 text-blue-700 hover:border-blue-300 hover:bg-blue-100'
            : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900'
        }`}
        title={focusMode ? '退出画布专注模式' : '进入画布专注模式'}
      >
        {focusMode ? (
          <Minimize2 className="h-4 w-4" />
        ) : (
          <Maximize2 className="h-4 w-4" />
        )}
      </button>
      {showHistoryControls ? <div className="mx-1 h-5 w-px bg-slate-200" /> : null}
      {onUndo ? (
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-slate-600 transition-colors hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-30"
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
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-slate-600 transition-colors hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-30"
          title="重做"
        >
          <Redo2 className="h-4 w-4" />
        </button>
      ) : null}
      <div className="ml-auto text-[11px] font-medium tracking-wide text-slate-500">
        拖拽时会即时预演落点，只有点击“整理画布”才会全局重排
      </div>
    </div>
  )
}
