import { useEffect, useMemo, useState } from 'react'
import { Check, Keyboard, RotateCcw, ScanText, X } from 'lucide-react'
import {
  captureShortcutFromKeyboardEvent,
  DEFAULT_ENGLISH_PRACTICE_SETTINGS,
  ENGLISH_SHORTCUT_ACTIONS,
  getShortcutLabel,
  getShortcutSignature,
  type EnglishPracticeSettings,
  type EnglishShortcutActionId,
} from '@/modules/settings/public'
import { cn } from '@/shared/lib/utils'
import {
  LAYOUT_LABELS,
  LAYOUT_ORDER,
  PLAYBACK_SPEEDS,
  type MaskRect,
} from '../dictationLayout'

interface DictationShortcutPanelProps {
  open: boolean
  settings: EnglishPracticeSettings
  onClose: () => void
  onSave: (settings: EnglishPracticeSettings) => void
  onResetMask: () => void
  onFullWidthMask: () => void
  maskRect: MaskRect
}

const GROUP_LABELS = {
  playback: '播放与导航',
  typing: '拼写与提示',
  view: '画面与视图',
  system: '系统',
} as const

const GROUP_ORDER: Array<keyof typeof GROUP_LABELS> = ['playback', 'typing', 'view', 'system']

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={cn('ed-toggle', checked && 'is-on')}
      onClick={() => onChange(!checked)}
    >
      <span className="ed-toggle__copy">
        <span>{label}</span>
        {hint ? <small>{hint}</small> : null}
      </span>
      <span className="ed-toggle__track" aria-hidden>
        <span className="ed-toggle__thumb" />
      </span>
    </button>
  )
}

export function DictationShortcutPanel({
  open,
  settings,
  onClose,
  onSave,
  onResetMask,
  onFullWidthMask,
  maskRect,
}: DictationShortcutPanelProps) {
  const [draft, setDraft] = useState(settings)
  const [recordingId, setRecordingId] = useState<EnglishShortcutActionId | null>(null)
  const [captureError, setCaptureError] = useState('')

  useEffect(() => {
    if (!open) return
    setDraft(settings)
    setRecordingId(null)
    setCaptureError('')
  }, [open, settings])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !recordingId) {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open, recordingId, onClose])

  useEffect(() => {
    if (!recordingId) return
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape' && event.shiftKey) {
        setRecordingId(null)
        setCaptureError('')
        return
      }
      const captured = captureShortcutFromKeyboardEvent(event)
      if (!captured.value) {
        setCaptureError(captured.error || '这个按键不能使用。')
        return
      }
      const signature = getShortcutSignature(captured.value)
      const conflict = ENGLISH_SHORTCUT_ACTIONS.find(
        (action) =>
          action.id !== recordingId &&
          getShortcutSignature(draft.shortcuts[action.id]) === signature,
      )
      if (conflict) {
        setCaptureError(`与「${conflict.label}」冲突，请换一个键。`)
        return
      }
      setDraft((previous) => ({
        ...previous,
        shortcuts: { ...previous.shortcuts, [recordingId]: captured.value },
      }))
      setRecordingId(null)
      setCaptureError('')
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [recordingId, draft.shortcuts])

  const grouped = useMemo(
    () =>
      GROUP_ORDER.map((group) => ({
        group,
        label: GROUP_LABELS[group],
        actions: ENGLISH_SHORTCUT_ACTIONS.filter((action) => action.group === group),
      })),
    [],
  )

  if (!open) return null

  const patchStage = (patch: Partial<EnglishPracticeSettings['stage']>) => {
    setDraft((previous) => ({ ...previous, stage: { ...previous.stage, ...patch } }))
  }
  const patchPlayback = (patch: Partial<EnglishPracticeSettings['playback']>) => {
    setDraft((previous) => ({ ...previous, playback: { ...previous.playback, ...patch } }))
  }
  const patchMask = (patch: Partial<EnglishPracticeSettings['stage']['mask']>) => {
    setDraft((previous) => ({
      ...previous,
      stage: { ...previous.stage, mask: { ...previous.stage.mask, ...patch } },
    }))
  }

  return (
    <div className="ed-modal" role="dialog" aria-modal="true" aria-label="快捷键与练习设置">
      <button type="button" className="ed-modal__backdrop" aria-label="关闭设置" onClick={onClose} />
      <div className="ed-shortcut-panel">
        <header className="ed-shortcut-panel__head">
          <div>
            <span className="ed-panel-eyebrow">CONTROL ROOM</span>
            <h2>快捷键与练习设置</h2>
            <p>无修饰单键即可操作。点击「录制」后按下新键；Shift+Esc 取消录制。</p>
          </div>
          <button type="button" className="ed-icon-button" onClick={onClose} aria-label="关闭">
            <X className="size-4" />
          </button>
        </header>

        <div className="ed-shortcut-panel__body">
          <section className="ed-panel-section">
            <div className="ed-panel-section__title">
              <Keyboard className="size-4" />
              快捷键
            </div>
            {grouped.map(({ group, label, actions }) => (
              <div key={group} className="ed-shortcut-group">
                <div className="ed-shortcut-group__label">{label}</div>
                {actions.map((action) => {
                  const recording = recordingId === action.id
                  const labelValue = getShortcutLabel(draft.shortcuts[action.id])
                  return (
                    <div key={action.id} className={cn('ed-shortcut-row', recording && 'is-recording')}>
                      <span className="ed-shortcut-row__label">{action.label}</span>
                      <kbd className="ed-shortcut-row__key">{recording ? '按键中…' : labelValue}</kbd>
                      <button
                        type="button"
                        className="ed-mini-button"
                        onClick={() => {
                          setCaptureError('')
                          setRecordingId(recording ? null : action.id)
                        }}
                      >
                        {recording ? '取消' : '录制'}
                      </button>
                      <button
                        type="button"
                        className="ed-mini-button ed-mini-button--ghost"
                        disabled={!draft.shortcuts[action.id]}
                        onClick={() =>
                          setDraft((previous) => ({
                            ...previous,
                            shortcuts: { ...previous.shortcuts, [action.id]: null },
                          }))
                        }
                        aria-label={`清除 ${action.label} 快捷键`}
                      >
                        清除
                      </button>
                    </div>
                  )
                })}
              </div>
            ))}
            {captureError ? <div className="ed-capture-error">{captureError}</div> : null}
            <div className="ed-panel-actions">
              <button
                type="button"
                className="ed-cta ed-cta--small"
                onClick={() => {
                  setRecordingId(null)
                  setCaptureError('')
                  setDraft((previous) => ({
                    ...previous,
                    shortcuts: DEFAULT_ENGLISH_PRACTICE_SETTINGS.shortcuts,
                  }))
                }}
              >
                <RotateCcw className="size-3.5" /> 恢复默认快捷键
              </button>
            </div>
          </section>

          <section className="ed-panel-section">
            <div className="ed-panel-section__title">画面</div>
            <div className="ed-layout-choices" role="radiogroup" aria-label="布局">
              {LAYOUT_ORDER.map((layout) => (
                <button
                  key={layout}
                  type="button"
                  role="radio"
                  aria-checked={draft.stage.layout === layout}
                  className={cn('ed-choice', draft.stage.layout === layout && 'is-active')}
                  onClick={() => patchStage({ layout })}
                >
                  {LAYOUT_LABELS[layout]}
                  {draft.stage.layout === layout ? <Check className="size-3.5" /> : null}
                </button>
              ))}
            </div>

            <div className="ed-field">
              <span>播放模式</span>
              <div className="ed-layout-choices" role="radiogroup" aria-label="播放模式">
                {(
                  [
                    { id: 'single', label: '单句播放' },
                    { id: 'continuous', label: '连播整段' },
                  ] as const
                ).map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    role="radio"
                    aria-checked={draft.playback.mode === mode.id}
                    className={cn(
                      'ed-choice',
                      draft.playback.mode === mode.id && 'is-active',
                    )}
                    onClick={() => patchPlayback({ mode: mode.id })}
                  >
                    {mode.label}
                    {draft.playback.mode === mode.id ? <Check className="size-3.5" /> : null}
                  </button>
                ))}
              </div>
              <small className="ed-field-note">
                单句：每句结束暂停，适合逐句拼写。连播：跨句连续播放，适合跟读或通听。
              </small>
            </div>

            <div className="ed-field">
              <span>播放速度</span>
              <div className="ed-speed-choices">
                {PLAYBACK_SPEEDS.map((speed) => (
                  <button
                    key={speed}
                    type="button"
                    className={cn('ed-choice ed-choice--tiny', draft.stage.playbackSpeed === speed && 'is-active')}
                    onClick={() => patchStage({ playbackSpeed: speed })}
                  >
                    {speed}×
                  </button>
                ))}
              </div>
            </div>

            <Toggle
              checked={draft.stage.showFilmstrip}
              onChange={(showFilmstrip) => patchStage({ showFilmstrip })}
              label="显示句子胶片条"
              hint="底部显示所有句子，可点击跳转"
            />
          </section>

          <section className="ed-panel-section">
            <div className="ed-panel-section__title">
              <ScanText className="size-4" />
              遮挡板
            </div>
            <Toggle
              checked={draft.stage.mask.enabled}
              onChange={(enabled) => patchMask({ enabled })}
              label="默认开启遮挡板"
              hint="遮住视频里烧录的中文字幕；可拖动与缩放"
            />
            <label className="ed-field ed-field--range">
              <span>
                模糊 <strong>{Math.round(draft.stage.mask.blur)}px</strong>
              </span>
              <input
                type="range"
                min={0}
                max={40}
                step={1}
                value={draft.stage.mask.blur}
                onChange={(event) => patchMask({ blur: Number(event.target.value) })}
              />
            </label>
            <label className="ed-field ed-field--range">
              <span>
                不透明度 <strong>{Math.round(draft.stage.mask.opacity)}%</strong>
              </span>
              <input
                type="range"
                min={20}
                max={100}
                step={1}
                value={draft.stage.mask.opacity}
                onChange={(event) => patchMask({ opacity: Number(event.target.value) })}
              />
            </label>
            <p className="ed-field-note">
              播放时会自动改用实色遮挡以保持帧率；暂停时恢复模糊。
            </p>
            <div className="ed-panel-actions">
              <button type="button" className="ed-mini-button" onClick={onResetMask}>
                重置位置
              </button>
              <button type="button" className="ed-mini-button" onClick={onFullWidthMask}>
                全宽遮挡
              </button>
              <span className="ed-panel-note">
                当前 {Math.round(maskRect.x)},{Math.round(maskRect.y)} · {Math.round(maskRect.w)}×{Math.round(maskRect.h)}
              </span>
            </div>
          </section>

          <section className="ed-panel-section">
            <div className="ed-panel-section__title">声音与节奏</div>
            <Toggle
              checked={draft.sound.enabled}
              onChange={(enabled) =>
                setDraft((previous) => ({ ...previous, sound: { ...previous.sound, enabled } }))
              }
              label="按键与判定反馈音"
              hint="正确轻响、错误低音、完成提示音"
            />
            <label className="ed-field ed-field--range">
              <span>
                反馈音量 <strong>{Math.round(draft.sound.masterVolume * 100)}%</strong>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(draft.sound.masterVolume * 100)}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    sound: { ...previous.sound, masterVolume: Number(event.target.value) / 100 },
                  }))
                }
              />
            </label>
            <Toggle
              checked={draft.flow.autoAdvanceOnPass}
              onChange={(autoAdvanceOnPass) =>
                setDraft((previous) => ({ ...previous, flow: { ...previous.flow, autoAdvanceOnPass } }))
              }
              label="完成后自动下一句"
              hint="仅单句模式生效；默认关闭，让译文先留在屏幕上"
            />
            <Toggle
              checked={draft.replay.autoReplayOnPass}
              onChange={(autoReplayOnPass) =>
                setDraft((previous) => ({ ...previous, replay: { ...previous.replay, autoReplayOnPass } }))
              }
              label="完成后自动重播"
              hint="仅单句模式生效"
            />
            <Toggle
              checked={draft.replay.singleSentenceLoopEnabled}
              onChange={(singleSentenceLoopEnabled) =>
                setDraft((previous) => ({
                  ...previous,
                  replay: { ...previous.replay, singleSentenceLoopEnabled },
                }))
              }
              label="单句循环"
              hint="仅单句模式生效；播放到句尾后立即重播同一句"
            />
          </section>
        </div>

        <footer className="ed-shortcut-panel__foot">
          <span className="ed-panel-note">设置会保存在本机，并同步到你的客户端偏好。</span>
          <div className="ed-panel-actions">
            <button type="button" className="ed-cta" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="ed-cta ed-cta--primary"
              onClick={() => onSave(draft)}
              autoFocus
            >
              应用设置 <kbd>Enter</kbd>
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
