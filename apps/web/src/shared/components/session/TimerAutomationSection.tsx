import * as React from 'react'
import { Button } from '@/shared/components/ui/button'
import type { TimerAutomationScene } from '@/shared/components/session/timer-automation-config'
import {
  DEFAULT_TIMER_AUTOMATION_CONFIG,
  TIMER_AUTOMATION_SCENE_LABELS,
} from '@/shared/components/session/timer-automation-config'
import type {
  ActionFieldKey,
  AutomationDraft,
  FieldKey,
} from '@/shared/components/session/timerAutomationDialogModel'
import { RuleEditor } from '@/shared/components/session/TimerAutomationRuleEditor'

export function TimerAutomationSection({
  draft,
  onModeChange,
  onFieldChange,
  onAutoStartChange,
  onActionChange,
}: {
  draft: AutomationDraft
  onModeChange: (mode: AutomationDraft['mode']) => void
  onFieldChange: (scene: 'shared' | TimerAutomationScene, field: FieldKey, value: string) => void
  onAutoStartChange: (scene: 'shared' | TimerAutomationScene, checked: boolean) => void
  onActionChange: (field: ActionFieldKey, checked: boolean) => void
}) {
  const scenes = Object.keys(TIMER_AUTOMATION_SCENE_LABELS) as TimerAutomationScene[]
  const sceneRuleEditors = scenes.map((scene) =>
    React.createElement(RuleEditor, {
      key: scene,
      label: TIMER_AUTOMATION_SCENE_LABELS[scene],
      description: `${TIMER_AUTOMATION_SCENE_LABELS[scene]}页面的专属自动化规则。`,
      value: draft[scene],
      onFieldChange: (field: FieldKey, value: string) => onFieldChange(scene, field, value),
      onAutoStartChange: (checked: boolean) => onAutoStartChange(scene, checked),
      defaults: DEFAULT_TIMER_AUTOMATION_CONFIG[scene],
      compact: true,
    }),
  )

  return (
    <>
      <div className="rounded-lg border border-border/70 bg-card/70 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-foreground">配置模式</div>
            <p className="mt-1 text-xs text-muted-foreground">全局模式共用一套阈值，单独模式则为每个场景分别配置。</p>
          </div>
          <div className="inline-flex rounded-full border border-border/70 bg-background/80 p-1">
            <Button
              type="button"
              size="sm"
              variant={draft.mode === 'global' ? 'default' : 'ghost'}
              className="rounded-full px-4"
              onClick={() => onModeChange('global')}
            >
              全局配置
            </Button>
            <Button
              type="button"
              size="sm"
              variant={draft.mode === 'scene' ? 'default' : 'ghost'}
              className="rounded-full px-4"
              onClick={() => onModeChange('scene')}
            >
              单独配置
            </Button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="flex items-start gap-3 rounded-xl border border-border/60 bg-background/50 px-3 py-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4"
              checked={draft.actions.autoResumeOnWindowReturn}
              onChange={(event) => onActionChange('autoResumeOnWindowReturn', event.target.checked)}
            />
            <span>
              <span className="block font-medium text-foreground">切回窗口自动恢复</span>
              <span className="text-xs text-muted-foreground">页面重新可见或窗口重新聚焦时，是否自动恢复计时。</span>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-xl border border-border/60 bg-background/50 px-3 py-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4"
              checked={draft.actions.countNodeSwitchAsActivity}
              onChange={(event) => onActionChange('countNodeSwitchAsActivity', event.target.checked)}
            />
            <span>
              <span className="block font-medium text-foreground">知识点切换算活动</span>
              <span className="text-xs text-muted-foreground">把脑图知识点激活、焦点切换等弱信号记为活动。</span>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-xl border border-border/60 bg-background/50 px-3 py-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4"
              checked={draft.actions.countEditOperationsAsActivity}
              onChange={(event) => onActionChange('countEditOperationsAsActivity', event.target.checked)}
            />
            <span>
              <span className="block font-medium text-foreground">实际编辑动作算活动</span>
              <span className="text-xs text-muted-foreground">包括脑图编辑、标题修改、附件与学习组操作等。</span>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-xl border border-border/60 bg-background/50 px-3 py-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4"
              checked={draft.actions.countPracticeInteractionsAsActivity}
              onChange={(event) => onActionChange('countPracticeInteractionsAsActivity', event.target.checked)}
            />
            <span>
              <span className="block font-medium text-foreground">练习交互算活动</span>
              <span className="text-xs text-muted-foreground">包括翻卡、重开、页内练习切换和正式练习交互。</span>
            </span>
          </label>
        </div>
      </div>

      {draft.mode === 'global' ? (
        <RuleEditor
          label="全局阈值"
          description="这套设置会统一应用到宫殿编辑、练习、复习、英语听力和英语阅读。"
          value={draft.shared}
          onFieldChange={(field, value) => onFieldChange('shared', field, value)}
          onAutoStartChange={(checked) => onAutoStartChange('shared', checked)}
          defaults={DEFAULT_TIMER_AUTOMATION_CONFIG.shared}
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {sceneRuleEditors}
        </div>
      )}
    </>
  )
}
