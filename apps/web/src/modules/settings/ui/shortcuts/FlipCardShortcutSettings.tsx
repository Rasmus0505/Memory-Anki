import { useEffect, useMemo, useState } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import {
  captureShortcutFromKeyboardEvent,
  getShortcutLabel,
  getShortcutSignature,
  MEMORY_ANKI_SHORTCUTS_UPDATED_EVENT,
  MEMORY_ANKI_SHORTCUT_ACTIONS,
  readMemoryAnkiShortcuts,
  resetMemoryAnkiShortcuts,
  RESERVED_FLIP_SHORTCUT_CODES,
  sanitizeMemoryAnkiShortcutMap,
  writeMemoryAnkiShortcuts,
  type MemoryAnkiShortcutActionId,
  type MemoryAnkiShortcutMap,
} from '@/modules/settings/domain/preferences-entity/model/memoryAnkiShortcuts'
import { Alert, AlertDescription } from '@/shared/components/ui/alert'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { cn } from '@/shared/lib/utils'

const FLIP_ACTION_IDS: MemoryAnkiShortcutActionId[] = [
  'flip_current_card',
  'retract_current_card',
  'flip_subtree_cards',
  'flip_direct_child_cards',
  'hide_child_cards',
]
const PAGE_ACTION_IDS: MemoryAnkiShortcutActionId[] = [
  'page_previous_card',
  'page_next_card',
]

// The feed owns these keys: Space / PageUp / PageDown and ←/→ always page.
const RESERVED_KEY_CODES = new Set<string>(RESERVED_FLIP_SHORTCUT_CODES)

function actionById(id: MemoryAnkiShortcutActionId) {
  const action = MEMORY_ANKI_SHORTCUT_ACTIONS.find((item) => item.id === id)
  if (!action) throw new Error(`Unknown flip shortcut action: ${id}`)
  return action
}

export interface FlipCardShortcutSettingsProps {
  className?: string
}

/**
 * The 翻卡设置 → 快捷键 page. Every successful capture is written immediately:
 * the learner can close the dialog and keep studying without a save step.
 */
export function FlipCardShortcutSettings({ className }: FlipCardShortcutSettingsProps) {
  const [shortcuts, setShortcuts] = useState<MemoryAnkiShortcutMap>(() =>
    readMemoryAnkiShortcuts(),
  )
  const [recordingActionId, setRecordingActionId] = useState<MemoryAnkiShortcutActionId | null>(
    null,
  )
  const [captureError, setCaptureError] = useState('')

  useEffect(() => {
    const handleUpdate = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : null
      setShortcuts(sanitizeMemoryAnkiShortcutMap(detail ?? readMemoryAnkiShortcuts()))
    }
    window.addEventListener(MEMORY_ANKI_SHORTCUTS_UPDATED_EVENT, handleUpdate)
    window.addEventListener('storage', handleUpdate)
    return () => {
      window.removeEventListener(MEMORY_ANKI_SHORTCUTS_UPDATED_EVENT, handleUpdate)
      window.removeEventListener('storage', handleUpdate)
    }
  }, [])

  const applyShortcuts = (next: MemoryAnkiShortcutMap) => {
    setShortcuts(writeMemoryAnkiShortcuts(next))
  }

  useEffect(() => {
    if (!recordingActionId) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setRecordingActionId(null)
        setCaptureError('')
        return
      }
      const captured = captureShortcutFromKeyboardEvent(event)
      if (!captured.value) {
        setCaptureError(captured.error)
        return
      }
      if (RESERVED_KEY_CODES.has(captured.value.code)) {
        setCaptureError('空格 / ← / → / PageUp / PageDown 保留给随心页翻页，请换一个按键。')
        return
      }
      const signature = getShortcutSignature(captured.value)
      const conflictingAction = MEMORY_ANKI_SHORTCUT_ACTIONS.find(
        (action) =>
          action.id !== recordingActionId
          && getShortcutSignature(shortcuts[action.id]) === signature,
      )
      if (conflictingAction) {
        setCaptureError(`与「${conflictingAction.label}」冲突，请换一个快捷键。`)
        return
      }
      applyShortcuts({ ...shortcuts, [recordingActionId]: captured.value })
      setRecordingActionId(null)
      setCaptureError('')
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [recordingActionId, shortcuts])

  const sections = useMemo(
    () => [
      { title: '翻卡', ids: FLIP_ACTION_IDS },
      { title: '翻页（随心页）', ids: PAGE_ACTION_IDS },
    ],
    [],
  )

  const renderRow = (id: MemoryAnkiShortcutActionId, isLast: boolean) => {
    const action = actionById(id)
    const recording = recordingActionId === id
    return (
      <div
        key={action.id}
        className={cn(
          'grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-3',
          !isLast && 'border-b border-border/70',
        )}
      >
        <div>
          <div className="text-sm font-medium">{action.label}</div>
          <div className="text-xs text-muted-foreground">{action.description}</div>
          {recording && captureError ? (
            <Alert variant="destructive" className="mt-2 px-3 py-2">
              {captureError}
            </Alert>
          ) : null}
        </div>
        <Badge variant="outline" className="justify-center px-3 py-1 font-mono text-xs">
          {recording ? '按键录制中...' : getShortcutLabel(shortcuts[id])}
        </Badge>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant={recording ? 'secondary' : 'outline'}
            onClick={() => {
              setRecordingActionId((current) => (current === id ? null : id))
              setCaptureError('')
            }}
          >
            {recording ? '取消' : '录制'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`清除${action.label}快捷键`}
            onClick={() => {
              setRecordingActionId(null)
              setCaptureError('')
              applyShortcuts({ ...shortcuts, [id]: null })
            }}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <Alert variant="info">
        <AlertDescription>
          录制时直接按下目标按键即可，支持单独字母键（如 A / S）和 Backspace；输入框、弹窗和录制中不会触发业务快捷键。改动即时生效。
        </AlertDescription>
      </Alert>

      {sections.map(({ title, ids }) => (
        <section key={title} className="rounded-lg border border-border/70">
          <div className="border-b border-border/70 px-4 py-2.5 text-sm font-semibold">{title}</div>
          {ids.map((id, index) => renderRow(id, index === ids.length - 1))}
        </section>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          固定键：PageUp / PageDown / 空格 翻页，← / → 也可翻页。
        </p>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setShortcuts(resetMemoryAnkiShortcuts())
            setRecordingActionId(null)
            setCaptureError('')
          }}
        >
          <RotateCcw data-icon="inline-start" />
          恢复默认
        </Button>
      </div>
    </div>
  )
}
