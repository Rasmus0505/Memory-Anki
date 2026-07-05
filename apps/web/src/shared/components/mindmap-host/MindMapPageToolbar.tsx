import { FolderTree, Languages, ListChecks, Maximize, Minimize, ScanSearch, Wand2 } from 'lucide-react'
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

interface MindMapToolbarToggleAction extends MindMapToolbarAction {
  active?: boolean
}

export interface MindMapPageToolbarProps {
  compact?: boolean
  className?: string
  segmentControl?: MindMapToolbarSegmentControl | null
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
  if (!segmentControl.active) return '分块'
  if (segmentControl.targetSegmentId === 'new' || segmentControl.targetSegmentId == null) {
    return '分块中 · 新分块'
  }
  const target = segmentControl.options.find((option) => option.id === segmentControl.targetSegmentId)
  return `分块中 · ${target?.name || '当前分块'}`
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
            disabled={segmentControl.disabled}
            onClick={segmentControl.onToggle}
          >
            <FolderTree className="h-4 w-4" />
            {resolveSegmentTargetLabel(segmentControl)}
          </Button>
        ) : null}
        {modeToggle ? (
          <Button
            type="button"
            size={actionButtonSize}
            variant="outline"
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
            aria-label="分块目标"
            className="h-8 min-w-[140px] rounded-md border border-input bg-background px-2 text-sm"
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
            <option value="new">新建分块</option>
            {segmentControl.options.map((option) => (
              <option key={option.id} value={String(option.id)}>
                {option.name || `分块 ${option.id}`}
              </option>
            ))}
          </select>
          <Button
            type="button"
            size="sm"
            disabled={segmentControl.disabled}
            onClick={segmentControl.onConfirm}
          >
            确认
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
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
