import {
  Brain,
  Eye,
  FolderTree,  MoreHorizontal,
  PenLine,  Search,
  Target,
  Wand2,
} from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  useDropdownMenuActionCoordinator,
} from '@/shared/components/ui/dropdown-menu'
import { Input } from '@/shared/components/ui/input'
import { cn } from '@/shared/lib/utils'
import type { MindMapTask } from '@/shared/api/contracts'

interface MindMapToolbarSegmentOption { id: number; name: string }
interface MindMapToolbarSegmentControl {
  active: boolean; targetSegmentId: number | 'new' | null; options: MindMapToolbarSegmentOption[]; disabled?: boolean
  onToggle: () => void; onTargetChange: (targetSegmentId: number | 'new' | null) => void; onConfirm: () => void; onCancel: () => void
}
interface MindMapToolbarAction {
  label: string
  onClick: () => void
  disabled?: boolean
  opensOverlay?: boolean
}
interface MindMapToolbarModeControl { value: 'edit' | 'preview' | 'recall'; onChange: (value: 'edit' | 'preview' | 'recall') => void; disabled?: boolean }
interface MindMapToolbarToggleAction extends MindMapToolbarAction { active?: boolean }

export interface MindMapPageToolbarProps {
  compact?: boolean
  embedded?: boolean
  className?: string
  taskControl?: { value: MindMapTask; onChange: (value: MindMapTask) => void; disabled?: boolean } | null
  searchControl?: { value: string; onChange: (value: string) => void; placeholder?: string; resultCount?: number } | null
  focusAction?: MindMapToolbarAction | null
  fitAction?: MindMapToolbarAction | null
  moreActions?: Array<MindMapToolbarAction & { destructive?: boolean; separatorBefore?: boolean }>
  segmentControl?: MindMapToolbarSegmentControl | null
  modeControl?: MindMapToolbarModeControl | null
  modeToggle?: MindMapToolbarAction | null
  importMindMapAction?: MindMapToolbarAction | null
  importTextAction?: MindMapToolbarAction | null
  englishAction?: MindMapToolbarAction | null
  quizAction?: MindMapToolbarAction | null
  immersiveAction?: MindMapToolbarToggleAction | null
  nativeFullscreenAction?: MindMapToolbarToggleAction | null
  clearUiAction?: MindMapToolbarToggleAction | null
}

function resolveSegmentTargetLabel(control: MindMapToolbarSegmentControl) {
  if (!control.active) return '学习组'
  if (control.targetSegmentId === 'new' || control.targetSegmentId == null) return '学习组中 · 新学习组'
  return `学习组中 · ${control.options.find((item) => item.id === control.targetSegmentId)?.name || '当前学习组'}`
}

export function MindMapPageToolbar(props: MindMapPageToolbarProps) {
  const {
    compact = false, embedded = false, className, taskControl = null, searchControl = null, focusAction = null, fitAction = null,
    moreActions = [], segmentControl = null, modeControl = null, modeToggle = null, importMindMapAction = null,
    importTextAction = null, englishAction = null, quizAction = null,
    immersiveAction = null, nativeFullscreenAction = null, clearUiAction = null,
  } = props
  const legacyActions = [importMindMapAction, importTextAction, englishAction, quizAction].filter(Boolean) as MindMapToolbarAction[]
  const overflowActions = [...moreActions, ...legacyActions, immersiveAction, nativeFullscreenAction, clearUiAction].filter(Boolean) as Array<MindMapToolbarAction & { destructive?: boolean; separatorBefore?: boolean }>
  const modern = Boolean(taskControl || searchControl || focusAction || fitAction || moreActions.length)
  const overflowMenu = useDropdownMenuActionCoordinator()

  return (
    <div className={cn(embedded ? 'flex shrink-0 flex-nowrap items-center gap-2' : 'rounded-2xl border border-border/70 bg-background/90 p-3', !embedded && (compact ? 'space-y-2.5' : 'space-y-3'), className)}>
      <div className="flex flex-nowrap items-center gap-2">
        {taskControl ? (
          <div className="inline-flex rounded-lg border border-border/70 bg-background p-1">
            {([{ value: 'build', label: '构建', icon: PenLine }, { value: 'learn', label: '学习', icon: Brain }] as const).map(({ value, label, icon: Icon }) => (
              <button key={value} type="button" disabled={taskControl.disabled} onClick={() => taskControl.onChange(value)} className={cn('inline-flex min-h-10 items-center gap-1.5 rounded-md px-3 text-sm font-medium', taskControl.value === value ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted')}>
                <Icon className="size-4" />{label}
              </button>
            ))}
          </div>
        ) : null}
        {searchControl ? (
          <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={searchControl.value} onChange={(event) => searchControl.onChange(event.target.value)} placeholder={searchControl.placeholder ?? '搜索标题和备注'} className="min-h-10 pl-9 pr-12" />
            {searchControl.value ? <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{searchControl.resultCount ?? 0}</span> : null}
          </div>
        ) : null}
        {focusAction ? <Button type="button" variant="outline" onClick={focusAction.onClick} disabled={focusAction.disabled}><Target className="size-4" />{focusAction.label}</Button> : null}
        {fitAction ? <Button type="button" variant="outline" onClick={fitAction.onClick} disabled={fitAction.disabled}>{fitAction.label}</Button> : null}
        {segmentControl ? <Button type="button" variant={segmentControl.active ? 'default' : 'outline'} onClick={segmentControl.onToggle}><FolderTree className="size-4" />{resolveSegmentTargetLabel(segmentControl)}</Button> : null}
        {segmentControl?.active ? (
          <>
            <select aria-label="学习组目标" className="min-h-10 shrink-0 rounded-md border bg-background px-2 text-sm" value={segmentControl.targetSegmentId === 'new' || segmentControl.targetSegmentId == null ? 'new' : String(segmentControl.targetSegmentId)} onChange={(event) => segmentControl.onTargetChange(event.target.value === 'new' ? 'new' : Number(event.target.value))}>
              <option value="new">新建学习组</option>{segmentControl.options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
            <Button size="sm" onClick={segmentControl.onConfirm}>确认</Button>
            <Button size="sm" variant="outline" onClick={segmentControl.onCancel}>取消</Button>
          </>
        ) : null}
        {!modern && modeControl ? (
          <div className="inline-flex rounded-lg border border-border/70 bg-background p-1">
            {([{ value: 'edit', label: '编辑模式', icon: PenLine }, { value: 'preview', label: '预览模式', icon: Eye }, { value: 'recall', label: '回忆模式', icon: Brain }] as const).map(({ value, label, icon: Icon }) => (
              <button key={value} type="button" onClick={() => modeControl.onChange(value)} className={cn('inline-flex min-h-10 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium', modeControl.value === value ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted')}><Icon className="size-3.5" />{label}</button>
            ))}
          </div>
        ) : null}
        {modeToggle ? <Button type="button" variant="outline" onClick={modeToggle.onClick}><Wand2 className="size-4" />{modeToggle.label}</Button> : null}
        {!modern ? legacyActions.map((action) => <Button key={action.label} type="button" variant="outline" disabled={action.disabled} onClick={action.onClick}>{action.label}</Button>) : null}
        {!modern && immersiveAction ? <Button type="button" variant="outline" onClick={immersiveAction.onClick}>{immersiveAction.label}</Button> : null}
        {!modern && nativeFullscreenAction ? <Button type="button" variant="outline" onClick={nativeFullscreenAction.onClick}>{nativeFullscreenAction.label}</Button> : null}
        {!modern && clearUiAction ? <Button type="button" variant="outline" onClick={clearUiAction.onClick}>{clearUiAction.label}</Button> : null}
        {modern && overflowActions.length ? (
          <DropdownMenu open={overflowMenu.open} onOpenChange={overflowMenu.setOpen}>
            <DropdownMenuTrigger asChild><Button type="button" variant="outline" size="icon" aria-label="更多脑图操作"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              {overflowActions.map((action, index) => <div key={`${action.label}-${index}`}>{action.separatorBefore ? <DropdownMenuSeparator /> : null}<DropdownMenuItem disabled={action.disabled} variant={action.destructive ? 'destructive' : 'default'} onSelect={(event) => { if (action.opensOverlay) event.preventDefault(); overflowMenu.runAction(action.onClick, action.opensOverlay) }}>{action.label}</DropdownMenuItem></div>)}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </div>
  )
}
