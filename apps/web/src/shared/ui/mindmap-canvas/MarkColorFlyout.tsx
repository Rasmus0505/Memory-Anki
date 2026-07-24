import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import {
  addMarkColorLabel,
  DEFAULT_MARK_COLOR_PRESETS,
  deleteMarkColorLabel,
  readMarkColorLabelsSettings,
  renameMarkColorLabel,
  type MarkColorLabel,
  type MarkColorLabelsSettings,
  MARK_COLOR_LABELS_UPDATED_EVENT,
} from '@/shared/preferences/markColorLabels'

export interface MarkColorFlyoutProps {
  x: number
  y: number
  targetCount: number
  currentColor?: string | null
  onPick: (color: string) => void
  onClear: () => void
  onClose: () => void
}

export function MarkColorFlyout({
  x,
  y,
  targetCount,
  currentColor,
  onPick,
  onClear,
  onClose,
}: MarkColorFlyoutProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const colorInputRef = useRef<HTMLInputElement>(null)
  const [position, setPosition] = useState({ x, y })
  const [settings, setSettings] = useState<MarkColorLabelsSettings>(() =>
    readMarkColorLabelsSettings(),
  )
  const [draftColor, setDraftColor] = useState(currentColor || '#fecaca')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  const refreshSettings = useCallback(() => {
    setSettings(readMarkColorLabelsSettings())
  }, [])

  useEffect(() => {
    refreshSettings()
    const handler = () => refreshSettings()
    window.addEventListener(MARK_COLOR_LABELS_UPDATED_EVENT, handler)
    return () => window.removeEventListener(MARK_COLOR_LABELS_UPDATED_EVENT, handler)
  }, [refreshSettings])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const onDocClick = (event: MouseEvent) => {
      if (!panelRef.current) return
      if (panelRef.current.contains(event.target as Node)) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDocClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDocClick)
    }
  }, [onClose])

  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const margin = 8
    const rect = panel.getBoundingClientRect()
    setPosition({
      x: Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin)),
      y: Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin)),
    })
  }, [x, y, settings.labels.length, renamingId])

  const pick = (color: string) => {
    onPick(color)
    onClose()
  }

  const handleSaveLabel = () => {
    const next = addMarkColorLabel(draftColor)
    setSettings(next)
  }

  const startRename = (label: MarkColorLabel, event: ReactMouseEvent) => {
    event.stopPropagation()
    setRenamingId(label.id)
    setRenameDraft(label.name)
  }

  const commitRename = (id: string) => {
    const next = renameMarkColorLabel(id, renameDraft)
    setSettings(next)
    setRenamingId(null)
  }

  const handleRenameKey = (id: string, event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitRename(id)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setRenamingId(null)
    }
  }

  const handleDeleteLabel = (id: string, event: ReactMouseEvent) => {
    event.stopPropagation()
    setSettings(deleteMarkColorLabel(id))
    if (renamingId === id) setRenamingId(null)
  }

  const countLabel = targetCount > 1 ? `（${targetCount} 张）` : ''

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="标记颜色"
      className="fixed z-[150] w-[240px] rounded-xl border bg-popover p-2.5 shadow-xl"
      style={{ left: position.x, top: position.y }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-foreground">标记颜色{countLabel}</div>
        <button
          type="button"
          aria-label="关闭"
          className="rounded-md p-1 text-muted-foreground hover:bg-secondary"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {settings.labels.length > 0 ? (
        <div className="mb-2 space-y-1">
          <div className="px-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            已保存标签
          </div>
          {settings.labels.map((label) => {
            const active = currentColor?.toLowerCase() === label.color.toLowerCase()
            return (
              <div
                key={label.id}
                className={`group flex items-center gap-1.5 rounded-lg px-1.5 py-1 ${
                  active ? 'bg-secondary' : 'hover:bg-secondary/70'
                }`}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  onClick={() => pick(label.color)}
                >
                  <span
                    className="h-3.5 w-3.5 shrink-0 rounded border border-black/10"
                    style={{ backgroundColor: label.color }}
                  />
                  {renamingId === label.id ? (
                    <input
                      autoFocus
                      value={renameDraft}
                      onChange={(event) => setRenameDraft(event.target.value)}
                      onBlur={() => commitRename(label.id)}
                      onKeyDown={(event) => handleRenameKey(label.id, event)}
                      onClick={(event) => event.stopPropagation()}
                      className="min-w-0 flex-1 rounded border bg-background px-1 py-0.5 text-xs outline-none"
                    />
                  ) : (
                    <span className="truncate text-xs">{label.name}</span>
                  )}
                  {active ? <Check className="h-3 w-3 shrink-0 text-foreground" /> : null}
                </button>
                {renamingId === label.id ? null : (
                  <>
                    <button
                      type="button"
                      aria-label={`重命名 ${label.name}`}
                      className="rounded p-1 text-muted-foreground opacity-70 hover:bg-background hover:opacity-100"
                      onClick={(event) => startRename(label, event)}
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      aria-label={`删除 ${label.name}`}
                      className="rounded p-1 text-destructive opacity-70 hover:bg-destructive/10 hover:opacity-100"
                      onClick={(event) => handleDeleteLabel(label.id, event)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </>
                )}
              </div>
            )
          })}
        </div>
      ) : null}

      <div className="mb-2">
        <div className="mb-1 px-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          预设
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {DEFAULT_MARK_COLOR_PRESETS.map((color) => {
            const active = currentColor?.toLowerCase() === color.toLowerCase()
            return (
              <button
                key={color}
                type="button"
                title={color}
                aria-label={`使用颜色 ${color}`}
                className={`h-6 w-6 rounded-md border border-black/10 ${
                  active ? 'ring-2 ring-sky-500 ring-offset-1' : ''
                }`}
                style={{ backgroundColor: color }}
                onClick={() => pick(color)}
              />
            )
          })}
        </div>
      </div>

      <div className="mb-2 rounded-lg border bg-secondary/40 p-2">
        <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          自定义
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={colorInputRef}
            type="color"
            value={/^#[0-9a-f]{6}$/i.test(draftColor) ? draftColor : '#fecaca'}
            onChange={(event) => setDraftColor(event.target.value)}
            className="h-8 w-10 cursor-pointer rounded border bg-transparent p-0.5"
            aria-label="选择自定义颜色"
          />
          <button
            type="button"
            className="flex-1 rounded-md border bg-background px-2 py-1.5 text-xs hover:bg-secondary"
            onClick={() => pick(draftColor)}
          >
            应用
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1.5 text-xs hover:bg-secondary"
            title="保存为标签"
            onClick={handleSaveLabel}
          >
            <Plus className="h-3 w-3" />
            标签
          </button>
        </div>
      </div>

      <button
        type="button"
        className="flex w-full items-center justify-center rounded-lg px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10"
        onClick={() => {
          onClear()
          onClose()
        }}
      >
        清除颜色
      </button>
    </div>
  )
}
