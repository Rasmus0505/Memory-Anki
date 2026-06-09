import { useEffect, useMemo, useState } from 'react'
import { Keyboard, RotateCcw, Save, Trash2 } from 'lucide-react'
import {
  captureShortcutFromKeyboardEvent,
  DEFAULT_MEMORY_ANKI_SHORTCUTS,
  getShortcutLabel,
  getShortcutSignature,
  MEMORY_ANKI_SHORTCUT_ACTIONS,
  readMemoryAnkiShortcuts,
  resetMemoryAnkiShortcuts,
  sanitizeMemoryAnkiShortcutMap,
  writeMemoryAnkiShortcuts,
  type MemoryAnkiShortcutActionId,
  type MemoryAnkiShortcutMap,
  type ShortcutScene,
} from '@/features/shortcuts/memoryAnkiShortcuts'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'

const SCENE_LABELS: Record<ShortcutScene, string> = {
  edit: '编辑',
  practice: '练习',
  review: '复习',
}

export function MemoryAnkiShortcutsSettings() {
  const [draftShortcuts, setDraftShortcuts] = useState<MemoryAnkiShortcutMap>(() =>
    readMemoryAnkiShortcuts(),
  )
  const [recordingActionId, setRecordingActionId] = useState<MemoryAnkiShortcutActionId | null>(null)
  const [captureError, setCaptureError] = useState('')

  useEffect(() => {
    setDraftShortcuts(readMemoryAnkiShortcuts())
  }, [])

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
      const currentAction = MEMORY_ANKI_SHORTCUT_ACTIONS.find((action) => action.id === recordingActionId)
      const signature = getShortcutSignature(captured.value)
      const conflictingAction = MEMORY_ANKI_SHORTCUT_ACTIONS.find(
        (action) =>
          action.scene === currentAction?.scene &&
          action.id !== recordingActionId &&
          getShortcutSignature(draftShortcuts[action.id]) === signature,
      )
      if (conflictingAction) {
        setCaptureError(`与「${SCENE_LABELS[conflictingAction.scene]} / ${conflictingAction.label}」冲突，请换一个快捷键。`)
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
  }, [draftShortcuts, recordingActionId])

  const groupedActions = useMemo(
    () =>
      (['edit', 'practice', 'review'] as ShortcutScene[]).map((scene) => ({
        scene,
        actions: MEMORY_ANKI_SHORTCUT_ACTIONS.filter((action) => action.scene === scene),
      })),
    [],
  )

  const handleSave = () => {
    setDraftShortcuts(writeMemoryAnkiShortcuts(draftShortcuts))
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Keyboard className="h-4 w-4" />
            快捷键
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-2xl border border-sky-200 bg-sky-50/80 px-4 py-3 text-sm text-sky-800">
            快捷键保存在当前浏览器。录制时按下组合键即可覆盖；输入框、文本编辑和录制状态中不会触发业务快捷键。
          </div>

          {groupedActions.map(({ scene, actions }) => (
            <section key={scene} className="rounded-2xl border border-border/70">
              <div className="border-b border-border/70 px-4 py-3">
                <div className="text-sm font-semibold">{SCENE_LABELS[scene]}场景</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  仅在当前脑图处于对应模式时生效。
                </div>
              </div>
              {actions.map((action, index) => (
                <div
                  key={action.id}
                  className={`grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-3 ${
                    index < actions.length - 1 ? 'border-b border-border/70' : ''
                  }`}
                >
                  <div>
                    <div className="text-sm font-medium">{action.label}</div>
                    <div className="text-xs text-muted-foreground">{action.description}</div>
                    {recordingActionId === action.id && captureError ? (
                      <div className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                        {captureError}
                      </div>
                    ) : null}
                  </div>
                  <Badge variant="outline" className="justify-center px-3 py-1 font-mono text-xs">
                    {recordingActionId === action.id ? '按键录制中...' : getShortcutLabel(draftShortcuts[action.id])}
                  </Badge>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={recordingActionId === action.id ? 'secondary' : 'outline'}
                      onClick={() => {
                        setRecordingActionId((current) => (current === action.id ? null : action.id))
                        setCaptureError('')
                      }}
                    >
                      {recordingActionId === action.id ? '取消录制' : '录制'}
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
                      <Trash2 className="h-4 w-4" />
                      清除
                    </Button>
                  </div>
                </div>
              ))}
            </section>
          ))}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setDraftShortcuts(resetMemoryAnkiShortcuts())
                setRecordingActionId(null)
                setCaptureError('')
              }}
            >
              <RotateCcw className="h-4 w-4" />
              恢复默认
            </Button>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setDraftShortcuts(DEFAULT_MEMORY_ANKI_SHORTCUTS)
                  setRecordingActionId(null)
                  setCaptureError('')
                }}
              >
                使用默认值
              </Button>
              <Button type="button" onClick={handleSave}>
                <Save className="h-4 w-4" />
                保存快捷键
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
