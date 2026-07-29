import {
  ChevronsDownUp,
  ChevronsUpDown,
  Expand,
  Focus,
  GitBranchPlus,
  Maximize2,
  Minimize2,
  Redo2,
  RefreshCw,
  Scan,
  Shrink,
  Undo2,
} from 'lucide-react'
import type { ReactNode } from 'react'

interface MindMapCanvasToolbarProps {
  /** True when either system or webpage fullscreen presentation is active. */
  focusMode: boolean
  /** Presentation mode for dual-button active styling. */
  presentationMode?: 'embedded' | 'native' | 'viewport'
  /**
   * When true, show both system fullscreen and webpage fullscreen controls
   * (desktop). When false, only webpage/viewport fullscreen is shown (PWA).
   */
  showSystemFullscreenControl?: boolean
  canUndo: boolean
  canRedo: boolean
  showHistoryControls: boolean
  leadingContent?: ReactNode
  /**
   * Fills remaining toolbar width after canvas tools (e.g. palace ladder progress).
   * Hosts inject product UI; generic canvas stays free of palace/stage fields.
   */
  centerContent?: ReactNode
  /** Remount host and fit the tree after ready. */
  onRefreshHost: () => void
  /** Fit the whole currently visible (collapse-aware) tree into the viewport. */
  onFitWholeTree?: () => void
  /** Fit the selected branch (or root) into the viewport. */
  onFitSelectionBranch?: () => void
  /** Expand selected node and all of its descendants; leave other branches alone. */
  onExpandSelectionSubtree?: () => void
  onExpandAllBranches?: () => void
  onCollapseDeepBranches?: () => void
  onToggleSystemFullscreen?: () => void
  onToggleWebpageFullscreen?: () => void
  /** @deprecated Prefer dual toggles; kept for single-control callers. */
  onToggleFocusMode?: () => void
  onUndo?: () => void
  onRedo?: () => void
}

function toolbarButtonClass(active: boolean) {
  return `flex size-9 items-center justify-center rounded-xl border transition-colors ${
    active
      ? 'border-info/30 bg-info/5 text-info hover:border-info/50 hover:bg-info/10'
      : 'border-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-primary'
  }`
}

export function MindMapCanvasToolbar({
  focusMode,
  presentationMode = 'embedded',
  showSystemFullscreenControl = false,
  canUndo,
  canRedo,
  showHistoryControls,
  leadingContent,
  centerContent,
  onRefreshHost,
  onFitWholeTree,
  onFitSelectionBranch,
  onExpandSelectionSubtree,
  onExpandAllBranches,
  onCollapseDeepBranches,
  onToggleSystemFullscreen,
  onToggleWebpageFullscreen,
  onToggleFocusMode,
  onUndo,
  onRedo,
}: MindMapCanvasToolbarProps) {
  const systemActive = presentationMode === 'native'
  const webpageActive = presentationMode === 'viewport' || (!showSystemFullscreenControl && focusMode)
  const handleSystemToggle = onToggleSystemFullscreen ?? onToggleFocusMode
  const handleWebpageToggle = onToggleWebpageFullscreen ?? onToggleFocusMode

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
      {onFitWholeTree ? (
        <button
          type="button"
          onClick={onFitWholeTree}
          className="flex size-9 items-center justify-center rounded-xl border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-primary"
          title="适应整树"
        >
          <Scan className="size-4" />
        </button>
      ) : null}
      {onFitSelectionBranch ? (
        <button
          type="button"
          onClick={onFitSelectionBranch}
          className="flex size-9 items-center justify-center rounded-xl border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-primary"
          title="适应当前分支"
        >
          <Focus className="size-4" />
        </button>
      ) : null}
      {onExpandSelectionSubtree ? (
        <button
          type="button"
          onClick={onExpandSelectionSubtree}
          className="flex size-9 items-center justify-center rounded-xl border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-primary"
          title="展开本支整树"
        >
          <GitBranchPlus className="size-4" />
        </button>
      ) : null}
      {onExpandAllBranches ? (
        <button
          type="button"
          onClick={onExpandAllBranches}
          className="flex size-9 items-center justify-center rounded-xl border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-primary"
          title="展开全部"
        >
          <ChevronsUpDown className="size-4" />
        </button>
      ) : null}
      {onCollapseDeepBranches ? (
        <button
          type="button"
          onClick={onCollapseDeepBranches}
          className="flex size-9 items-center justify-center rounded-xl border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-primary"
          title="折叠深层"
        >
          <ChevronsDownUp className="size-4" />
        </button>
      ) : null}
      {showSystemFullscreenControl ? (
        <button
          type="button"
          onClick={handleSystemToggle}
          className={toolbarButtonClass(systemActive)}
          title={systemActive ? '退出系统全屏' : '进入系统全屏'}
        >
          {systemActive ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </button>
      ) : null}
      <button
        type="button"
        onClick={handleWebpageToggle}
        className={toolbarButtonClass(webpageActive)}
        title={
          showSystemFullscreenControl
            ? webpageActive
              ? '退出网页全屏'
              : '进入网页全屏'
            : webpageActive
              ? '退出全屏'
              : '进入全屏'
        }
      >
        {webpageActive ? <Shrink className="size-4" /> : <Expand className="size-4" />}
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
      {centerContent ? (
        <>
          <div className="mx-1 h-5 w-px shrink-0 bg-border" />
          <div className="flex min-w-0 flex-1 items-center">{centerContent}</div>
        </>
      ) : null}
    </div>
  )
}
