import { Input } from '@/shared/components/ui/input'
import { Switch } from '@/shared/components/ui/switch'
import {
  FEEDBACK_CONFETTI_PRESETS,
  FEEDBACK_CONFETTI_PRESET_LABELS,
  REVIEW_FEEDBACK_SCENE_BOOST_MAX,
  REVIEW_FEEDBACK_VOLUME_MAX,
  type ReviewFeedbackSceneSettings,
} from '@/shared/feedback/reviewFeedbackSettings'

export interface FeedbackSceneDescriptor {
  key: string
  title: string
  description: string
}

/**
 * One scene's sound and animation detail.
 *
 * Timer celebration used to have a parallel editor of its own with the same
 * five controls and a second set of Chinese labels for the same confetti
 * presets; both now go through this component.
 */
export function FeedbackSceneEditor({
  descriptor,
  scene,
  baseVolume,
  onChange,
  onPreview,
}: {
  descriptor: FeedbackSceneDescriptor
  scene: ReviewFeedbackSceneSettings
  baseVolume: number
  onChange: (patch: Partial<ReviewFeedbackSceneSettings>) => void
  onPreview?: () => void
}) {
  const boost = scene.volumeBoost ?? 1
  const effectivePercent = Math.round(baseVolume * boost * 100)

  return (
    <div className="rounded-lg border border-border/70 bg-card/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">{descriptor.title}</div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{descriptor.description}</p>
        </div>
        <Switch
          checked={scene.enabled}
          onCheckedChange={(enabled) => onChange({ enabled })}
          aria-label={`${descriptor.title}启用`}
        />
      </div>

      {scene.enabled ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={scene.soundEnabled}
                onChange={(event) => onChange({ soundEnabled: event.target.checked })}
                aria-label={`${descriptor.title}播放声音`}
              />
              播放声音
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={scene.animationEnabled}
                onChange={(event) => onChange({ animationEnabled: event.target.checked })}
                aria-label={`${descriptor.title}播放动画`}
              />
              播放动画
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1.5 text-sm">
              <span className="text-xs text-muted-foreground">烟花类型</span>
              <select
                className="h-9 w-full rounded-md border border-border/70 bg-background px-2 text-sm"
                value={scene.confettiPreset ?? FEEDBACK_CONFETTI_PRESETS[0]}
                onChange={(event) =>
                  onChange({
                    confettiPreset: event.target
                      .value as ReviewFeedbackSceneSettings['confettiPreset'],
                  })
                }
                aria-label={`${descriptor.title}烟花类型`}
              >
                {FEEDBACK_CONFETTI_PRESETS.map((preset) => (
                  <option key={preset} value={preset}>
                    {FEEDBACK_CONFETTI_PRESET_LABELS[preset]}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1.5 text-sm">
              <span className="text-xs text-muted-foreground">
                音量倍率（当前实际 {effectivePercent}%）
              </span>
              <Input
                type="number"
                min={0}
                max={REVIEW_FEEDBACK_SCENE_BOOST_MAX}
                step={0.05}
                value={boost}
                onChange={(event) => onChange({ volumeBoost: Number(event.target.value) })}
                aria-label={`${descriptor.title}音量倍率`}
              />
            </label>
          </div>

          <details className="rounded-lg border border-border/60 bg-background/50 p-3">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              高级：烟花量与冷却
            </summary>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="space-y-1.5 text-sm">
                <span className="text-xs text-muted-foreground">烟花量（0-3）</span>
                <Input
                  type="number"
                  min={0}
                  max={3}
                  step={0.05}
                  value={scene.confettiAmount}
                  onChange={(event) => onChange({ confettiAmount: Number(event.target.value) })}
                  aria-label={`${descriptor.title}烟花量`}
                />
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="text-xs text-muted-foreground">冷却（毫秒）</span>
                <Input
                  type="number"
                  min={0}
                  max={120000}
                  step={100}
                  value={scene.cooldownMs}
                  onChange={(event) => onChange({ cooldownMs: Number(event.target.value) })}
                  aria-label={`${descriptor.title}冷却毫秒`}
                />
              </label>
            </div>
          </details>

          {onPreview ? (
            <button
              type="button"
              onClick={onPreview}
              className="rounded-md border border-border/70 px-3 py-1.5 text-xs hover:bg-secondary/70"
            >
              预览
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export const FEEDBACK_SCENE_DESCRIPTORS: FeedbackSceneDescriptor[] = [
  { key: 'review', title: '翻卡与答题', description: '每次揭示或作答后的即时反馈。' },
  { key: 'milestone', title: '阶段成就', description: '连击与里程碑达成时的反馈。' },
  { key: 'completion', title: '最终完成', description: '一次训练全部完成时的结算庆祝。' },
  { key: 'timerInterval', title: '计时 · 阶段提醒', description: '专注轮次内每个阶段节点的轻提醒。' },
  { key: 'timerRound', title: '计时 · 整轮完成', description: '完成一整轮专注时的庆祝。' },
]

export const VOLUME_MAX = REVIEW_FEEDBACK_VOLUME_MAX
