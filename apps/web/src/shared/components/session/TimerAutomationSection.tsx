import type { AutomationDraft, FieldKey } from '@/shared/components/session/timerAutomationDialogModel'
import { Input } from '@/shared/components/ui/input'

export function TimerAutomationSection({
  draft,
  onFieldChange,
  onAutoStartChange,
  onKeepScreenAwakeChange,
  variant = 'full',
}: {
  draft: AutomationDraft
  onFieldChange: (field: FieldKey, value: string) => void
  onAutoStartChange: (checked: boolean) => void
  onKeepScreenAwakeChange: (checked: boolean) => void
  /** `compact` is the in-session dialog: only the knobs worth changing mid-study. */
  variant?: 'full' | 'compact'
}) {
  const idleMinutes = Math.max(1, Math.round((Number(draft.idleTimeoutSeconds) || 120) / 60))
  const graceSeconds = Math.max(0, Math.round(Number(draft.idleGraceSeconds) || 0))
  const backgroundSeconds = Math.max(0, Math.round(Number(draft.backgroundGraceSeconds) || 0))

  return (
    <div className="rounded-lg border border-border/70 bg-card/70 p-4">
      <div>
        <div className="text-sm font-semibold text-foreground">自动计时</div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          所有学习页面共用同一套规则。只有主应用内容区内的鼠标点击会续活；无点击达到闲置阈值后会先提示「仍在学习吗」，宽限期内任意操作都会继续计时。
        </p>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="rounded-lg border border-border/60 bg-background/60 px-3 py-3 text-sm">
          <span className="block font-medium text-foreground">无点击自动暂停</span>
          <span className="mt-1 block text-xs text-muted-foreground">
            持续多少分钟没有点击主应用内容后进入预警。这段时间视为默读背诵，仍计入时长。
          </span>
          <div className="mt-3 flex items-center gap-2">
            <Input
              aria-label="无点击自动暂停分钟"
              type="number"
              min={1}
              max={180}
              value={idleMinutes}
              onChange={(event) => {
                const minutes = Math.max(1, Math.round(Number(event.target.value) || 1))
                onFieldChange('idleTimeoutSeconds', String(minutes * 60))
              }}
            />
            <span className="shrink-0 text-xs text-muted-foreground">分钟</span>
          </div>
        </label>

        {variant === 'full' ? (
        <label className="rounded-lg border border-border/60 bg-background/60 px-3 py-3 text-sm">
          <span className="block font-medium text-foreground">预警宽限</span>
          <span className="mt-1 block text-xs text-muted-foreground">
            「仍在学习吗」提示持续多久。无人理会则暂停，并回退这段时长。
          </span>
          <div className="mt-3 flex items-center gap-2">
            <Input
              aria-label="预警宽限秒数"
              type="number"
              min={0}
              max={600}
              value={graceSeconds}
              onChange={(event) => {
                const seconds = Math.max(0, Math.round(Number(event.target.value) || 0))
                onFieldChange('idleGraceSeconds', String(seconds))
              }}
            />
            <span className="shrink-0 text-xs text-muted-foreground">秒</span>
          </div>
        </label>
        ) : null}

        {variant === 'full' ? (
        <label className="rounded-lg border border-border/60 bg-background/60 px-3 py-3 text-sm">
          <span className="block font-medium text-foreground">切后台宽限</span>
          <span className="mt-1 block text-xs text-muted-foreground">
            切到其他窗口或锁屏后等待多久才暂停。手机下拉通知栏、接个电话不会打断计时。0 = 立即暂停。
          </span>
          <div className="mt-3 flex items-center gap-2">
            <Input
              aria-label="切后台宽限秒数"
              type="number"
              min={0}
              max={600}
              value={backgroundSeconds}
              onChange={(event) => {
                const seconds = Math.max(0, Math.round(Number(event.target.value) || 0))
                onFieldChange('backgroundGraceSeconds', String(seconds))
              }}
            />
            <span className="shrink-0 text-xs text-muted-foreground">秒</span>
          </div>
        </label>
        ) : null}

        {variant === 'full' ? (
        <label className="flex items-start gap-3 rounded-lg border border-border/60 bg-background/60 px-3 py-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4"
            checked={draft.autoStartOnPageEnter}
            onChange={(event) => onAutoStartChange(event.target.checked)}
          />
          <span>
            <span className="block font-medium text-foreground">进入学习页面自动开始</span>
            <span className="mt-1 block text-xs text-muted-foreground">所有编辑、练习、复习、测验与英语页面统一使用。</span>
          </span>
        </label>
        ) : null}

        {variant === 'full' ? (
        <label className="flex items-start gap-3 rounded-lg border border-border/60 bg-background/60 px-3 py-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4"
            checked={draft.keepScreenAwake}
            onChange={(event) => onKeepScreenAwakeChange(event.target.checked)}
          />
          <span>
            <span className="block font-medium text-foreground">计时中保持屏幕常亮</span>
            <span className="mt-1 block text-xs text-muted-foreground">
              手机背书时不会因为息屏而中断计时。会增加耗电，浏览器不支持时自动忽略。
            </span>
          </span>
        </label>
        ) : null}
      </div>
    </div>
  )
}
