import { useEffect, useMemo, useState } from 'react'
import { Keyboard, RotateCcw, Save, Trash2 } from 'lucide-react'
import {
  captureShortcutFromKeyboardEvent,
  DEFAULT_MEMORY_ANKI_SHORTCUTS,
  FLIP_CARD_SHORTCUT_ACTION_IDS,
  getShortcutLabel,
  getShortcutSignature,
  MEMORY_ANKI_SHORTCUT_ACTIONS,
  readMemoryAnkiShortcuts,
  sanitizeMemoryAnkiShortcutMap,
  writeMemoryAnkiShortcuts,
  type MemoryAnkiShortcutActionId,
  type MemoryAnkiShortcutMap,
  type ShortcutScene,
} from '@/entities/preferences/model/memoryAnkiShortcuts'
import { Alert, AlertDescription } from '@/shared/components/ui/alert'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'

const SCENE_LABELS: Record<ShortcutScene, string> = {
  edit: '编辑',
  practice: '练习',
  review: '复习',
}

export interface FlipCardShortcutsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When set, only show actions for this flip scene (practice or review). */
  scene?: Extract<ShortcutScene, 'practice' | 'review'>
}

export function FlipCardShortcutsDialog({
  open,
  onOpenChange,
  scene,
}: FlipCardShortcutsDialogProps) {
  const [draftShortcuts, setDraftShortcuts] = useState<MemoryAnkiShortcutMap>(() =>
    readMemoryAnkiShortcuts(),
  )
  const [recordingActionId, setRecordingActionId] = useState<MemoryAnkiShortcutActionId | null>(
    null,
  )
  const [captureError, setCaptureError] = useState('')

  useEffect(() => {
    if (!open) return
    setDraftShortcuts(readMemoryAnkiShortcuts())
    setRecordingActionId(null)
    setCaptureError('')
  }, [open])

  const flipActions = useMemo(
    () =>
      MEMORY_ANKI_SHORTCUT_ACTIONS.filter((action) => {
        if (!FLIP_CARD_SHORTCUT_ACTION_IDS.includes(action.id)) return false
        if (!scene) return true
        return action.scene === scene
      }),
    [scene],
  )

  useEffect(() => {
    if (!open || !recordingActionId) return undefined
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
      const currentAction = MEMORY_ANKI_SHORTCUT_ACTIONS.find(
        (action) => action.id === recordingActionId,
      )
      const signature = getShortcutSignature(captured.value)
      const conflictingAction = MEMORY_ANKI_SHORTCUT_ACTIONS.find(
        (action) =>
          action.scene === currentAction?.scene &&
          action.id !== recordingActionId &&
          getShortcutSignature(draftShortcuts[action.id]) === signature,
      )
      if (conflictingAction) {
        setCaptureError(
          `与「${SCENE_LABELS[conflictingAction.scene]} / ${conflictingAction.label}」冲突，请换一个快捷键。`,
        )
        return
      }
      setDraftShortcuts((current) =>
        sanitizeMemoryAnkiShortcutMap({
          ...current,
          [recordingActionId]: captured.value,
        }),
      )
      setRecordingActionId(null)
      setCaptureError('')
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [draftShortcuts, open, recordingActionId])

  const handleSave = () => {
    setDraftShortcuts(writeMemoryAnkiShortcuts(draftShortcuts))
    onOpenChange(false)
  }

  const handleResetFlipDefaults = () => {
    setDraftShortcuts((current) => {
      const next = { ...current }
      for (const action of flipActions) {
        next[action.id] = DEFAULT_MEMORY_ANKI_SHORTCUTS[action.id]
      }
      return sanitizeMemoryAnkiShortcutMap(next)
    })
    setRecordingActionId(null)
    setCaptureError('')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" accessibleTitle="翻卡快捷键">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="size-4" />
            翻卡快捷键
          </DialogTitle>
          <DialogDescription>
            鼠标悬停在卡片上时生效；无悬停则使用当前选中卡片。第一次翻出占位符，再按一次翻出内容。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 px-1">
          <Alert variant="info">
            <AlertDescription>
              支持单独字母键（如 A / S）。录制时按下目标键即可；输入框中不会触发业务快捷键。
            </AlertDescription>
          </Alert>

          {flipActions.map((action, index) => (
            <div
              key={action.id}
              className={`grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-lg border border-border/70 px-3 py-3 ${
                index > 0 ? '' : ''
              }`}
            >
              <div>
                <div className="text-sm font-medium">{action.label}</div>
                <div className="text-xs text-muted-foreground">{action.description}</div>
                {recordingActionId === action.id && captureError ? (
                  <Alert variant="destructive" className="mt-2 px-3 py-2">
                    {captureError}
                  </Alert>
                ) : null}
              </div>
              <Badge variant="outline" className="justify-center px-3 py-1 font-mono text-xs">
                {recordingActionId === action.id
                  ? '按键录制中...'
                  : getShortcutLabel(draftShortcuts[action.id])}
              </Badge>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant={recordingActionId === action.id ? 'secondary' : 'outline'}
                  onClick={() => {
                    setRecordingActionId((current) =>
                      current === action.id ? null : action.id,
                    )
                    setCaptureError('')
                  }}
                >
                  {recordingActionId === action.id ? '取消' : '录制'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setDraftShortcuts((current) => ({
                      ...current,
                      [action.id]: null,
                    }))
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="ghost" onClick={handleResetFlipDefaults}>
            <RotateCcw className="size-4" />
            恢复默认 A / S
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="button" onClick={handleSave}>
              <Save className="size-4" />
              保存
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
