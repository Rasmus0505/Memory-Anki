import {
  ArrowLeft,
  CircleDot,
  Eye,
  EyeOff,
  Keyboard,
  LayoutPanelTop,
  Repeat,
  Volume2,
  VolumeX,
} from 'lucide-react'
import {
  getShortcutLabel,
  type EnglishPlaybackMode,
  type EnglishPracticeSettings,
} from '@/modules/settings/public'
import { cn } from '@/shared/lib/utils'
import { LAYOUT_LABELS } from '../dictationLayout'
import type { EnglishDictationLayout } from '@/modules/settings/public'

interface DictationHeaderProps {
  title: string
  sentenceNumber: number
  sentenceCount: number
  completedCount: number
  layout: EnglishDictationLayout
  playbackMode: EnglishPlaybackMode
  playbackShortcutLabel: string
  maskEnabled: boolean
  soundEnabled: boolean
  onBack: () => void
  onCycleLayout: () => void
  onTogglePlaybackMode: () => void
  onToggleMask: () => void
  onToggleSound: () => void
  onOpenShortcuts: () => void
  shortcutsLabel: string
}

export function DictationHeader({
  title,
  sentenceNumber,
  sentenceCount,
  completedCount,
  layout,
  playbackMode,
  playbackShortcutLabel,
  maskEnabled,
  soundEnabled,
  onBack,
  onCycleLayout,
  onTogglePlaybackMode,
  onToggleMask,
  onToggleSound,
  onOpenShortcuts,
  shortcutsLabel,
}: DictationHeaderProps) {
  const progress = sentenceCount > 0 ? Math.min(1, completedCount / sentenceCount) : 0
  return (
    <header className="ed-header" data-testid="english-dictation-header">
      <div className="ed-header__left">
        <button type="button" className="ed-icon-button" onClick={onBack} aria-label="返回英语片库">
          <ArrowLeft className="size-4" />
        </button>
        <div className="ed-header__title">
          <span className="ed-header__eyebrow">DICTATION · 逐句拼写</span>
          <h1 title={title}>{title}</h1>
        </div>
      </div>

      <div className="ed-header__progress" aria-label={`已完成 ${completedCount} / ${sentenceCount} 句`}>
        <span className="ed-header__counter">
          <strong>{String(Math.max(0, sentenceNumber)).padStart(2, '0')}</strong>
          <span>/ {String(sentenceCount).padStart(2, '0')}</span>
        </span>
        <span className="ed-progress-track" aria-hidden>
          <span className="ed-progress-fill" style={{ width: `${progress * 100}%` }} />
        </span>
      </div>

      <div className="ed-header__actions">
        <button
          type="button"
          className="ed-icon-button"
          onClick={onCycleLayout}
          title={`切换布局 · ${LAYOUT_LABELS[layout]}`}
          aria-label={`切换布局，当前${LAYOUT_LABELS[layout]}`}
        >
          <LayoutPanelTop className="size-4" />
        </button>
        <button
          type="button"
          className={cn('ed-icon-button', maskEnabled && 'ed-icon-button--on')}
          onClick={onToggleMask}
          title={maskEnabled ? '关闭遮挡板' : '开启遮挡板'}
          aria-pressed={maskEnabled}
          aria-label={maskEnabled ? '关闭遮挡板' : '开启遮挡板'}
        >
          {maskEnabled ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
        <button
          type="button"
          className={cn('ed-icon-button', !soundEnabled && 'ed-icon-button--muted')}
          onClick={onToggleSound}
          title={soundEnabled ? '关闭反馈音' : '开启反馈音'}
          aria-pressed={soundEnabled}
          aria-label={soundEnabled ? '关闭反馈音' : '开启反馈音'}
        >
          {soundEnabled ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
        </button>
        <button
          type="button"
          className="ed-icon-button ed-icon-button--wide"
          onClick={onOpenShortcuts}
          title="快捷键与练习设置"
          aria-label="快捷键与练习设置"
        >
          <Keyboard className="size-4" />
          <span>{shortcutsLabel}</span>
        </button>
        <button
          type="button"
          className={cn(
            'ed-icon-button ed-icon-button--wide ed-icon-button--mode',
            playbackMode === 'continuous' && 'ed-icon-button--on',
          )}
          onClick={onTogglePlaybackMode}
          title={`播放模式：${playbackMode === 'continuous' ? '连播' : '单句'} · ${playbackShortcutLabel}`}
          aria-label={`播放模式：${playbackMode === 'continuous' ? '连播' : '单句'}`}
          data-playback-mode={playbackMode}
        >
          {playbackMode === 'continuous' ? (
            <Repeat className="size-4" />
          ) : (
            <CircleDot className="size-4" />
          )}
          <span>{playbackMode === 'continuous' ? '连播' : '单句'}</span>
        </button>
      </div>
    </header>
  )
}

interface DictationHintBarProps {
  settings: EnglishPracticeSettings
  onOpenShortcuts: () => void
  className?: string
}

export function DictationHintBar({ settings, onOpenShortcuts, className }: DictationHintBarProps) {
  const entries: Array<{ action: keyof typeof settings.shortcuts; label: string }> = [
    { action: 'replay_sentence', label: '重播' },
    { action: 'reveal_letter', label: '揭示字母' },
    { action: 'reveal_word', label: '揭示单词' },
    { action: 'reset_sentence', label: '清空重输' },
    { action: 'previous_sentence', label: '上一句' },
    { action: 'next_sentence', label: '下一句' },
    { action: 'toggle_translation', label: '译文' },
    { action: 'toggle_mask', label: '遮挡板' },
    { action: 'cycle_layout', label: '布局' },
    { action: 'toggle_playback_mode', label: '单句/连播' },
  ]
  return (
    <div className={cn('ed-hints', className)} data-testid="english-dictation-hints">
      {entries.map((entry) => {
        const binding = settings.shortcuts[entry.action]
        if (!binding) return null
        return (
          <span key={entry.action} className="ed-hint">
            <kbd>{getShortcutLabel(binding)}</kbd>
            <span>{entry.label}</span>
          </span>
        )
      })}
      <button type="button" className="ed-hint ed-hint--button" onClick={onOpenShortcuts}>
        <kbd>{getShortcutLabel(settings.shortcuts.open_shortcuts) || 'F1'}</kbd>
        <span>全部</span>
      </button>
    </div>
  )
}
