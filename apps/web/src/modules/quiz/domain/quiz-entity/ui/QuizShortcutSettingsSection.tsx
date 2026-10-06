import { useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import {
  beginQuizShortcutRecording,
  captureQuizShortcutFromKeyboardEvent,
  formatQuizShortcutLabel,
  getShortcutSignature,
  QUIZ_SHORTCUT_ACTIONS,
  QUIZ_SHORTCUT_GROUPS,
  type QuizShortcutActionId,
  type QuizShortcutMap,
} from '@/modules/quiz/domain/quiz-entity/model/quizShortcuts'
import {
  QUIZ_SHORTCUTS_UPDATED_EVENT,
  readQuizShortcuts,
  resetQuizShortcuts,
  writeQuizShortcuts,
} from '@/modules/quiz/domain/quiz-entity/model/quizShortcutSettings'
import { sanitizeQuizShortcutMap } from '@/modules/quiz/domain/quiz-entity/model/quizShortcuts'

export function QuizShortcutSettingsSection() {
  const [shortcuts, setShortcuts] = useState<QuizShortcutMap>(() => readQuizShortcuts())
  const [recordingActionId, setRecordingActionId] = useState<QuizShortcutActionId | null>(null)
  const [captureError, setCaptureError] = useState('')

  useEffect(() => {
    const handleUpdate = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : null
      setShortcuts(sanitizeQuizShortcutMap(detail ?? readQuizShortcuts()))
      setRecordingActionId(null)
      setCaptureError('')
    }
    window.addEventListener(QUIZ_SHORTCUTS_UPDATED_EVENT, handleUpdate)
    return () => window.removeEventListener(QUIZ_SHORTCUTS_UPDATED_EVENT, handleUpdate)
  }, [])

  useEffect(() => {
    if (!recordingActionId) return undefined
    const endRecording = beginQuizShortcutRecording()
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setRecordingActionId(null)
        setCaptureError('')
        return
      }
      const captured = captureQuizShortcutFromKeyboardEvent(event)
      if (!captured.value) {
        setCaptureError(captured.error)
        return
      }
      const signature = getShortcutSignature(captured.value)
      const conflict = QUIZ_SHORTCUT_ACTIONS.find(
        (action) =>
          action.id !== recordingActionId
          && getShortcutSignature(shortcuts[action.id]) === signature,
      )
      if (conflict) {
        setCaptureError(`与「${conflict.label}」冲突，请换一个快捷键。`)
        return
      }
      const next = writeQuizShortcuts({
        ...shortcuts,
        [recordingActionId]: captured.value,
      })
      setShortcuts(next)
      setRecordingActionId(null)
      setCaptureError('')
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      endRecording()
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [recordingActionId, shortcuts])

  return (
    <section aria-label="快捷键" data-quiz-shortcut-settings="" className="space-y-3">
      <div>
        <p className="text-sm font-medium">快捷键</p>
        <p className="mt-1 text-xs text-muted-foreground">
          随心做题和关联题目共用，改完即保存。方向上键按一次切换标记，再按一次取消。答案出来后，提交键（默认 Enter）切到下一题。Backspace 打开删除确认。输入框里不会触发，也不会翻动底下的卡片。
        </p>
      </div>
      {QUIZ_SHORTCUT_GROUPS.map((group) => (
        <div key={group.id} className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">{group.label}</p>
          {QUIZ_SHORTCUT_ACTIONS.filter((action) => action.group === group.id).map((action) => (
            <div
              key={action.id}
              className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-lg border border-border/70 px-2.5 py-1.5"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium">{action.label}</div>
                <div className="text-xs text-muted-foreground">{action.description}</div>
                {recordingActionId === action.id && captureError ? (
                  <p className="mt-1 text-xs text-destructive">{captureError}</p>
                ) : null}
              </div>
              <span className="min-w-8 text-center font-mono text-xs text-foreground">
                {recordingActionId === action.id ? '请按键' : formatQuizShortcutLabel(shortcuts[action.id])}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant={recordingActionId === action.id ? 'secondary' : 'outline'}
                  aria-label={`录制${action.label}`}
                  onClick={() => {
                    setCaptureError('')
                    setRecordingActionId((current) => (current === action.id ? null : action.id))
                  }}
                >
                  录制
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`清除${action.label}`}
                  onClick={() => {
                    setShortcuts(writeQuizShortcuts({ ...shortcuts, [action.id]: null }))
                    setRecordingActionId(null)
                    setCaptureError('')
                  }}
                >
                  清除
                </Button>
              </div>
            </div>
          ))}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setShortcuts(resetQuizShortcuts())
          setRecordingActionId(null)
          setCaptureError('')
        }}
      >
        <RotateCcw className="size-3.5" />
        恢复默认
      </Button>
    </section>
  )
}
