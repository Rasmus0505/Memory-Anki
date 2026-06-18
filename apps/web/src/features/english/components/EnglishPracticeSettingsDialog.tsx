import { useEffect, useMemo, useState } from 'react'
import { Keyboard, RotateCcw, Save, Trash2, Volume2 } from 'lucide-react'
import {
  captureShortcutFromKeyboardEvent,
  DEFAULT_ENGLISH_PRACTICE_SETTINGS,
  ENGLISH_SHORTCUT_ACTIONS,
  getShortcutLabel,
  getShortcutSignature,
  sanitizeEnglishPracticeSettings,
  type EnglishPracticeSettings,
  type ShortcutActionId,
} from '@/entities/preferences/model/englishPracticeSettings'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'

interface EnglishPracticeSettingsDialogProps {
  open: boolean
  settings: EnglishPracticeSettings
  onOpenChange: (open: boolean) => void
  onSave: (settings: EnglishPracticeSettings) => void
}

function ToggleButton({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      data-english-control-focus="true"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? 'border-success/30 bg-success/5 text-success'
          : 'border-border bg-background text-muted-foreground hover:text-foreground'
      }`}
    >
      <span
        className={`h-2.5 w-2.5 rounded-full ${active ? 'bg-success' : 'bg-muted-foreground/40'}`}
      />
      {label}
    </button>
  )
}

export function EnglishPracticeSettingsDialog({
  open,
  settings,
  onOpenChange,
  onSave,
}: EnglishPracticeSettingsDialogProps) {
  const [draftSettings, setDraftSettings] = useState<EnglishPracticeSettings>(settings)
  const [recordingActionId, setRecordingActionId] = useState<ShortcutActionId | null>(null)
  const [captureError, setCaptureError] = useState('')

  useEffect(() => {
    if (!open) return
    setDraftSettings(settings)
    setRecordingActionId(null)
    setCaptureError('')
  }, [open, settings])

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

      const signature = getShortcutSignature(captured.value)
      const conflictingAction = ENGLISH_SHORTCUT_ACTIONS.find(
        (action) =>
          action.id !== recordingActionId &&
          getShortcutSignature(draftSettings.shortcuts[action.id]) === signature,
      )
      if (conflictingAction) {
        setCaptureError(`与「${conflictingAction.label}」冲突，请换一个快捷键。`)
        return
      }

      setDraftSettings((current) =>
        sanitizeEnglishPracticeSettings({
          ...current,
          shortcuts: {
            ...current.shortcuts,
            [recordingActionId]: captured.value,
          },
        }),
      )
      setRecordingActionId(null)
      setCaptureError('')
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [draftSettings.shortcuts, open, recordingActionId])

  const shortcutSummary = useMemo(
    () =>
      ENGLISH_SHORTCUT_ACTIONS.map((action) => `${action.label}: ${getShortcutLabel(draftSettings.shortcuts[action.id])}`),
    [draftSettings.shortcuts],
  )

  const handleSave = () => {
    onSave(sanitizeEnglishPracticeSettings(draftSettings))
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-english-control-focus="true"
        className="max-h-[90vh] max-w-4xl overflow-hidden"
      >
        <DialogHeader>
          <div className="space-y-1">
            <DialogTitle>英语听力设置</DialogTitle>
            <p className="text-sm text-muted-foreground">
              快捷键会保存在当前浏览器。本页默认保留沉浸输入，避免与答题按键冲突。
            </p>
          </div>
          <DialogClose onClick={() => onOpenChange(false)} />
        </DialogHeader>

        <div className="space-y-6 overflow-y-auto px-6 py-5">
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Volume2 className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">练习偏好</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              <ToggleButton
                active={draftSettings.sound.enabled}
                label={draftSettings.sound.enabled ? '声音已开启' : '声音已关闭'}
                onClick={() =>
                  setDraftSettings((current) => ({
                    ...current,
                    sound: { ...current.sound, enabled: !current.sound.enabled },
                  }))
                }
              />
              <div className="flex w-full max-w-xs items-center gap-3 pl-1">
                <label htmlFor="master-volume" className="text-xs text-muted-foreground">
                  总音量
                </label>
                <input
                  id="master-volume"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={draftSettings.sound.masterVolume}
                  onChange={(event) =>
                    setDraftSettings((current) => ({
                      ...current,
                      sound: { ...current.sound, masterVolume: Number(event.target.value) },
                    }))
                  }
                  data-english-control-focus="true"
                  className="h-1.5 w-28 cursor-pointer appearance-none rounded-full bg-border accent-success [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-success"
                />
                <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">
                  {Math.round(draftSettings.sound.masterVolume * 100)}%
                </span>
              </div>
              <ToggleButton
                active={draftSettings.flow.autoAdvanceOnPass}
                label={draftSettings.flow.autoAdvanceOnPass ? '自动下一句开启' : '自动下一句关闭'}
                onClick={() =>
                  setDraftSettings((current) => ({
                    ...current,
                    flow: {
                      ...current.flow,
                      autoAdvanceOnPass: !current.flow.autoAdvanceOnPass,
                    },
                  }))
                }
              />
              <ToggleButton
                active={draftSettings.replay.autoReplayOnPass}
                label={draftSettings.replay.autoReplayOnPass ? '答后重播开启' : '答后重播关闭'}
                onClick={() =>
                  setDraftSettings((current) => ({
                    ...current,
                    replay: {
                      ...current.replay,
                      autoReplayOnPass: !current.replay.autoReplayOnPass,
                    },
                  }))
                }
              />
              <ToggleButton
                active={draftSettings.replay.singleSentenceLoopEnabled}
                label={draftSettings.replay.singleSentenceLoopEnabled ? '单句循环开启' : '单句循环关闭'}
                onClick={() =>
                  setDraftSettings((current) => ({
                    ...current,
                    replay: {
                      ...current.replay,
                      singleSentenceLoopEnabled: !current.replay.singleSentenceLoopEnabled,
                    },
                  }))
                }
              />
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Keyboard className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">快捷键</h3>
            </div>
            <div className="rounded-2xl border border-info/30 bg-info/5 px-4 py-3 text-sm text-info">
              支持带 Shift / Ctrl / Alt / Meta 的组合键，也支持方向键和功能键。单字母会被当作答题输入键拦截，避免和拼写练习冲突。
            </div>
            <div className="rounded-2xl border border-border/70">
              <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 border-b border-border/70 px-4 py-3 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                <span>动作</span>
                <span>当前绑定</span>
                <span>操作</span>
              </div>
              {ENGLISH_SHORTCUT_ACTIONS.map((action, index) => (
                <div
                  key={action.id}
                  className={`grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-3 ${
                    index < ENGLISH_SHORTCUT_ACTIONS.length - 1 ? 'border-b border-border/70' : ''
                  }`}
                >
                  <div>
                    <div className="text-sm font-medium">{action.label}</div>
                    <div className="text-xs text-muted-foreground">录制时按下新组合键即可覆盖。</div>
                    {recordingActionId === action.id && captureError ? (
                      <div className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                        {captureError}
                      </div>
                    ) : null}
                  </div>
                  <Badge variant="outline" className="justify-center px-3 py-1 font-mono text-xs">
                    {recordingActionId === action.id ? '按键录制中…' : getShortcutLabel(draftSettings.shortcuts[action.id])}
                  </Badge>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={recordingActionId === action.id ? 'secondary' : 'outline'}
                      data-english-control-focus="true"
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
                      data-english-control-focus="true"
                      onClick={() =>
                        setDraftSettings((current) => ({
                          ...current,
                          shortcuts: {
                            ...current.shortcuts,
                            [action.id]: null,
                          },
                        }))
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                      清除
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-2 rounded-2xl border border-border/70 bg-background/70 px-4 py-4">
            <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              当前摘要
            </div>
            <div className="flex flex-wrap gap-2">
              {shortcutSummary.map((item) => (
                <Badge key={item} variant="secondary" className="px-3 py-1">
                  {item}
                </Badge>
              ))}
            </div>
          </section>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-6 py-4">
          <Button
            type="button"
            variant="ghost"
            data-english-control-focus="true"
            onClick={() => {
              setDraftSettings(DEFAULT_ENGLISH_PRACTICE_SETTINGS)
              setRecordingActionId(null)
              setCaptureError('')
            }}
          >
            <RotateCcw className="h-4 w-4" />
            恢复默认
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" data-english-control-focus="true" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="button" data-english-control-focus="true" onClick={handleSave}>
              <Save className="h-4 w-4" />
              保存设置
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
