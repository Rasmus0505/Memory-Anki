import type { AutomationDraft } from '@/shared/components/session/timerAutomationDialogModel'

export function TimerAutomationSection({
  draft,
  onAutoStartChange,
  onKeepScreenAwakeChange,
}: {
  draft: AutomationDraft
  onAutoStartChange: (checked: boolean) => void
  onKeepScreenAwakeChange: (checked: boolean) => void
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/70 p-4">
      <div>
        <div className="text-sm font-semibold text-foreground">自动计时</div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          所有学习页面共用同一套规则。切到后台或窗口失焦会立即暂停，回到前台后自动恢复系统暂停。
        </p>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
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
      </div>
    </div>
  )
}
