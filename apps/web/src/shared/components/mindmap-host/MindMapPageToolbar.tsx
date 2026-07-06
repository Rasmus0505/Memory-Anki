import { Brain, Eye, FolderTree, Languages, ListChecks, Maximize, Minimize, PenLine, ScanSearch, Wand2 } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { cn } from '@/shared/lib/utils'

interface MindMapToolbarSegmentOption {
  id: number
  name: string
}

interface MindMapToolbarSegmentControl {
  active: boolean
  targetSegmentId: number | 'new' | null
  options: MindMapToolbarSegmentOption[]
  disabled?: boolean
  onToggle: () => void
  onTargetChange: (targetSegmentId: number | 'new' | null) => void
  onConfirm: () => void
  onCancel: () => void
}

interface MindMapToolbarAction {
  label: string
  onClick: () => void
  disabled?: boolean
}

interface MindMapToolbarModeControl {
  value: 'edit' | 'preview' | 'recall'
  onChange: (value: 'edit' | 'preview' | 'recall') => void
  disabled?: boolean
}

interface MindMapToolbarToggleAction extends MindMapToolbarAction {
  active?: boolean
}

export interface MindMapPageToolbarProps {
  compact?: boolean
  className?: string
  segmentControl?: MindMapToolbarSegmentControl | null
  modeControl?: MindMapToolbarModeControl | null
  modeToggle?: MindMapToolbarAction | null
  importMindMapAction?: MindMapToolbarAction | null
  importTextAction?: MindMapToolbarAction | null
  englishAction?: MindMapToolbarAction | null
  quizAction?: MindMapToolbarAction | null
  miniPalaceAction?: MindMapToolbarAction | null
  immersiveAction?: MindMapToolbarToggleAction | null
  nativeFullscreenAction?: MindMapToolbarToggleAction | null
  clearUiAction?: MindMapToolbarToggleAction | null
}

function resolveSegmentTargetLabel(segmentControl: MindMapToolbarSegmentControl) {
  if (!segmentControl.active) return '学习组'
  if (segmentControl.targetSegmentId === 'new' || segmentControl.targetSegmentId == null) {
    return '学习组中 · 新学习组'
  }
  const target = segmentControl.options.find((option) => option.id === segmentControl.targetSegmentId)
  return `学习组中 · ${target?.name || '当前学习组'}`
}

function parseSegmentTarget(value: string): number | 'new' | null {
  if (value === 'new') return 'new'
  if (!value.trim()) return null
  return Number(value)
}

export function MindMapPageToolbar({
  compact = false,
  className,
  segmentControl = null,
  modeControl = null,
  modeToggle = null,
  importMindMapAction = null,
  importTextAction = null,
  englishAction = null,
  quizAction = null,
  miniPalaceAction = null,
  immersiveAction = null,
  nativeFullscreenAction = null,
  clearUiAction = null,
}: MindMapPageToolbarProps) {
  const actionButtonSize = compact ? 'sm' : 'default'
  const actionButtonClassName = 'min-h-11'

  return (
    <div
      className={cn(
        'rounded-2xl border border-border/70 bg-background/90 p-3',
        compact ? 'space-y-2.5' : 'space-y-3',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {segmentControl ? (
          <Button
            type="button"
            size={actionButtonSize}
            variant={segmentControl.active ? 'default' : 'outline'}
            className={actionButtonClassName}
            disabled={segmentControl.disabled}
            onClick={segmentControl.onToggle}
          >
            <FolderTree className="h-4 w-4" />
            {resolveSegmentTargetLabel(segmentControl)}
          </Button>
        ) : null}
        {modeControl ? (
          <div className="inline-flex rounded-lg border border-border/70 bg-background p-1">
            {[
              { value: 'edit' as const, label: '编辑模式', icon: PenLine },
              { value: 'preview' as const, label: '预览模式', icon: Eye },
              { value: 'recall' as const, label: '回忆模式', icon: Brain },
            ].map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                disabled={modeControl.disabled}
                onClick={() => modeControl.onChange(value)}
                className={cn(
                  'inline-flex min-h-11 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors sm:h-8 sm:min-h-8',
                  modeControl.value === value
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
        ) : null}
        {modeToggle ? (
          <Button
            type="button"
            size={actionButtonSize}
            variant="outline"
            className={actionButtonClassName}
            disabled={modeToggle.disabled}
            onClick={modeToggle.onClick}
          >
            <Wand2 className="h-4 w-4" />
            {modeToggle.label}
          </Button>
        ) : null}
        {importMindMapAction ? (
          <Button
            type="button"
            size={actionButtonSize}
            variant="outline"
            className={actionButtonClassName}
            disabled={importMindMapAction.disabled}
            onClick={importMindMapAction.onClick}
          >
            <ScanSearch className="h-4 w-4" />
            {importMindMapAction.label}
          </Button>
        ) : null}
        {importTextAction ? (
          <Button
            type="button"
            size={actionButtonSize}
            variant="outline"
            className={actionButtonClassName}
            disabled={importTextAction.disabled}
            onClick={importTextAction.onClick}
          >
            <ScanSearch className="h-4 w-4" />
            {importTextAction.label}
          </Button>
        ) : null}
        {englishAction ? (
          <Button
            type="button"
            size={actionButtonSize}
            variant="outline"
            className={actionButtonClassName}
            disabled={englishAction.disabled}
            onClick={englishAction.onClick}
          >
            <Languages className="h-4 w-4" />
            {englishAction.label}
          </Button>
        ) : null}
        {quizAction ? (
          <Button
            type="button"
            size={actionButtonSize}
            variant="outline"
            className={actionButtonClassName}
            disabled={quizAction.disabled}
            onClick={quizAction.onClick}
          >
            <ListChecks className="h-4 w-4" />
            {quizAction.label}
          </Button>
        ) : null}
        {miniPalaceAction ? (
          <Button
            type="button"
            size={actionButtonSize}
            variant="outline"
            className={actionButtonClassName}
            disabled={miniPalaceAction.disabled}
            onClick={miniPalaceAction.onClick}
          >
            {miniPalaceAction.label}
          </Button>
        ) : null}
        {immersiveAction ? (
          <Button
            type="button"
            size={actionButtonSize}
            variant={immersiveAction.active ? 'default' : 'outline'}
            className={actionButtonClassName}
            disabled={immersiveAction.disabled}
            onClick={immersiveAction.onClick}
          >
            <Minimize className="h-4 w-4" />
            {immersiveAction.label}
          </Button>
        ) : null}
        {nativeFullscreenAction ? (
          <Button
            type="button"
            size={actionButtonSize}
            variant={nativeFullscreenAction.active ? 'default' : 'outline'}
            className={actionButtonClassName}
            disabled={nativeFullscreenAction.disabled}
            onClick={nativeFullscreenAction.onClick}
          >
            <Maximize className="h-4 w-4" />
            {nativeFullscreenAction.label}
          </Button>
        ) : null}
        {clearUiAction ? (
          <Button
            type="button"
            size={actionButtonSize}
            variant={clearUiAction.active ? 'default' : 'outline'}
            className={actionButtonClassName}
            disabled={clearUiAction.disabled}
            onClick={clearUiAction.onClick}
          >
            {clearUiAction.label}
          </Button>
        ) : null}
      </div>

      {segmentControl?.active ? (
        <div
          className={cn(
            'flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-background/80 px-3 py-2',
            compact && 'text-sm',
          )}
        >
          <span className="text-sm text-muted-foreground">当前目标</span>
          <select
            aria-label="学习组目标"
            className="min-h-11 min-w-[140px] rounded-md border border-input bg-background px-2 text-sm sm:h-8 sm:min-h-8"
            disabled={segmentControl.disabled}
            value={
              segmentControl.targetSegmentId === 'new' || segmentControl.targetSegmentId == null
                ? 'new'
                : String(segmentControl.targetSegmentId)
            }
            onChange={(event) => {
              segmentControl.onTargetChange(parseSegmentTarget(event.currentTarget.value))
            }}
          >
            <option value="new">新建学习组</option>
            {segmentControl.options.map((option) => (
              <option key={option.id} value={String(option.id)}>
                {option.name || `学习组 ${option.id}`}
              </option>
            ))}
          </select>
          <Button
            type="button"
            size="sm"
            className="min-h-11 sm:h-8 sm:min-h-8"
            disabled={segmentControl.disabled}
            onClick={segmentControl.onConfirm}
          >
            确认
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-h-11 sm:h-8 sm:min-h-8"
            disabled={segmentControl.disabled}
            onClick={segmentControl.onCancel}
          >
            取消
          </Button>
        </div>
      ) : null}
    </div>
  )
}
