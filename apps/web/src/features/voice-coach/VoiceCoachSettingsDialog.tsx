import * as React from 'react'
import { Bell, PencilLine, Play, RotateCcw, Volume2 } from 'lucide-react'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { cn } from '@/shared/lib/utils'
import {
  DEFAULT_VOICE_COACH_SETTINGS,
  readVoiceCoachSettings,
  VOICE_COACH_SETTINGS_UPDATED_EVENT,
  writeVoiceCoachSettings,
  type VoiceCoachSettings,
} from '@/entities/preferences/model/voiceCoachSettings'
import type { VoiceCoachEvent } from '@/features/voice-coach/api'

interface VoiceCoachSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onTest?: (event?: VoiceCoachEvent) => Promise<unknown> | unknown
}

function ToggleRow({
  active,
  title,
  description,
  icon: Icon,
  onClick,
}: {
  active: boolean
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-start justify-between gap-4 rounded-xl border px-4 py-3 text-left transition-colors',
        active ? 'border-success/30 bg-success/5' : 'border-border/70 bg-background/80',
      )}
    >
      <span className="flex min-w-0 gap-3">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <span>
          <span className="block text-sm font-medium">{title}</span>
          <span className="mt-1 block text-xs text-muted-foreground">{description}</span>
        </span>
      </span>
      <Badge variant={active ? 'secondary' : 'outline'}>{active ? '开启' : '关闭'}</Badge>
    </button>
  )
}

export function VoiceCoachSettingsDialog({
  open,
  onOpenChange,
  onTest,
}: VoiceCoachSettingsDialogProps) {
  const [settings, setSettings] = React.useState<VoiceCoachSettings>(() =>
    readVoiceCoachSettings(),
  )
  const [testState, setTestState] = React.useState<'idle' | 'running' | 'error'>('idle')

  React.useEffect(() => {
    const sync = () => setSettings(readVoiceCoachSettings())
    window.addEventListener(VOICE_COACH_SETTINGS_UPDATED_EVENT, sync)
    return () => window.removeEventListener(VOICE_COACH_SETTINGS_UPDATED_EVENT, sync)
  }, [])

  const updateSettings = React.useCallback(
    (
      nextSettings:
        | VoiceCoachSettings
        | ((current: VoiceCoachSettings) => VoiceCoachSettings),
    ) => {
      setSettings((current) => {
        const candidate =
          typeof nextSettings === 'function' ? nextSettings(current) : nextSettings
        return writeVoiceCoachSettings(candidate)
      })
    },
    [],
  )

  const handleTest = async () => {
    setTestState('running')
    try {
      await onTest?.('session_start')
      setTestState('idle')
    } catch {
      setTestState('error')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <div>
            <DialogTitle>语音教练</DialogTitle>
            <div className="mt-1 text-sm text-muted-foreground">
              默认关闭；开启后只在关键节奏点播放短句。
            </div>
          </div>
          <DialogClose onClick={() => onOpenChange(false)} />
        </DialogHeader>
        <div className="max-h-[78vh] space-y-5 overflow-y-auto px-6 py-5">
          <ToggleRow
            active={settings.enabled}
            title={settings.enabled ? '语音教练已开启' : '语音教练已关闭'}
            description="关闭时不会请求百炼，也不会播放本地缓存语音。"
            icon={Volume2}
            onClick={() =>
              updateSettings((current) => ({
                ...current,
                enabled: !current.enabled,
              }))
            }
          />

          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { key: 'review', label: '复习', icon: Bell },
              { key: 'practice', label: '练习', icon: Play },
              { key: 'edit', label: '编辑', icon: PencilLine },
            ].map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() =>
                  updateSettings((current) => ({
                    ...current,
                    scenes: {
                      ...current.scenes,
                      [key]: !current.scenes[key as keyof VoiceCoachSettings['scenes']],
                    },
                  }))
                }
                className={cn(
                  'flex min-h-16 items-center justify-between rounded-xl border px-3 py-2 text-sm',
                  settings.scenes[key as keyof VoiceCoachSettings['scenes']]
                    ? 'border-success/30 bg-success/5'
                    : 'border-border/70 bg-background/80',
                )}
              >
                <span className="inline-flex items-center gap-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  {label}
                </span>
                <Badge
                  variant={
                    settings.scenes[key as keyof VoiceCoachSettings['scenes']]
                      ? 'secondary'
                      : 'outline'
                  }
                >
                  {settings.scenes[key as keyof VoiceCoachSettings['scenes']] ? '开' : '关'}
                </Badge>
              </button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="voice-coach-volume">音量</Label>
              <Input
                id="voice-coach-volume"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={settings.volume}
                onChange={(event) =>
                  updateSettings((current) => ({
                    ...current,
                    volume: Number(event.currentTarget.value),
                  }))
                }
              />
              <div className="text-xs text-muted-foreground">
                {Math.round(settings.volume * 100)}%
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="voice-coach-cooldown">同类提示冷却秒数</Label>
              <Input
                id="voice-coach-cooldown"
                type="number"
                min="30"
                max="1800"
                value={settings.cooldownSeconds}
                onChange={(event) =>
                  updateSettings((current) => ({
                    ...current,
                    cooldownSeconds: Number(event.currentTarget.value),
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="voice-coach-idle">复习/练习空闲提醒</Label>
              <Input
                id="voice-coach-idle"
                type="number"
                min="15"
                max="600"
                value={settings.idleNudgeSeconds}
                onChange={(event) =>
                  updateSettings((current) => ({
                    ...current,
                    idleNudgeSeconds: Number(event.currentTarget.value),
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="voice-coach-edit-idle">编辑空闲提醒</Label>
              <Input
                id="voice-coach-edit-idle"
                type="number"
                min="15"
                max="900"
                value={settings.editIdleNudgeSeconds}
                onChange={(event) =>
                  updateSettings((current) => ({
                    ...current,
                    editIdleNudgeSeconds: Number(event.currentTarget.value),
                  }))
                }
              />
            </div>
          </div>

          <div className="grid gap-3">
            <ToggleRow
              active={settings.milestoneEnabled}
              title="阶段提示"
              description="复习或练习推进到一段节奏后播放一次。"
              icon={Bell}
              onClick={() =>
                updateSettings((current) => ({
                  ...current,
                  milestoneEnabled: !current.milestoneEnabled,
                }))
              }
            />
            <ToggleRow
              active={settings.completionEnabled}
              title="结算提示"
              description="完成前后播放一次收束提醒。"
              icon={Play}
              onClick={() =>
                updateSettings((current) => ({
                  ...current,
                  completionEnabled: !current.completionEnabled,
                }))
              }
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => updateSettings(DEFAULT_VOICE_COACH_SETTINGS)}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              恢复默认
            </Button>
            <div className="flex items-center gap-2">
              {testState === 'error' ? (
                <span className="text-xs text-destructive">测试失败，请检查 API Key。</span>
              ) : null}
              <Button type="button" onClick={handleTest} disabled={testState === 'running'}>
                <Play className="mr-2 h-4 w-4" />
                {testState === 'running' ? '测试中' : '测试播放'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
