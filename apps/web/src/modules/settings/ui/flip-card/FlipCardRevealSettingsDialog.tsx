import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { RadioGroup, RadioGroupItem } from '@/shared/components/ui/radio-group'
import { Button } from '@/shared/components/ui/button'
import { Switch } from '@/shared/components/ui/switch'
import type { FlipCardRevealConfig } from '@/shared/preferences/flipCardRevealConfig'
import type { FreestyleFlipMode } from '@/modules/practice/public'

export interface FlipCardRevealSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: FlipCardRevealConfig
  onChange: (value: FlipCardRevealConfig) => void
  freestyleFlipMode?: {
    value: FreestyleFlipMode
    onChange: (value: FreestyleFlipMode) => void
  }
  /** Freestyle-only: advance after a passing rate. Formal review leaves this unset. */
  freestyleAutoAdvance?: {
    value: boolean
    onChange: (value: boolean) => void
  }
}

export function FlipCardRevealSettingsDialog({
  open,
  onOpenChange,
  value,
  onChange,
  freestyleFlipMode,
  freestyleAutoAdvance,
}: FlipCardRevealSettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="flip-card-reveal-settings-dialog">
        <DialogHeader>
          <DialogTitle>翻卡设置</DialogTitle>
          <DialogDescription>设置普通点击的揭示节奏。</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">翻卡颗粒度</legend>
            <RadioGroup
              value={value.granularity}
              onValueChange={(granularity) => {
                if (granularity !== 'single' && granularity !== 'level') return
                onChange({ ...value, granularity })
              }}
              className="grid gap-2"
              aria-label="翻卡颗粒度"
            >
              <label className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 hover:bg-accent">
                <RadioGroupItem value="single" />
                <span className="text-sm">逐张</span>
              </label>
              <label className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 hover:bg-accent">
                <RadioGroupItem value="level" />
                <span className="text-sm">同层批量</span>
              </label>
            </RadioGroup>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">揭示方式</legend>
            <RadioGroup
              value={value.stage}
              onValueChange={(stage) => {
                if (stage !== 'two-step' && stage !== 'direct') return
                onChange({ ...value, stage })
              }}
              className="grid gap-2"
              aria-label="揭示方式"
            >
              <label className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 hover:bg-accent">
                <RadioGroupItem value="two-step" />
                <span className="text-sm">两阶段（待回忆 → 内容）</span>
              </label>
              <label className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 hover:bg-accent">
                <RadioGroupItem value="direct" />
                <span className="text-sm">直接显示内容</span>
              </label>
            </RadioGroup>
          </fieldset>

          {freestyleFlipMode ? (
            <fieldset className="space-y-2 border-t pt-4">
              <legend className="text-sm font-medium">随心翻卡模式</legend>
              <RadioGroup
                value={freestyleFlipMode.value}
                onValueChange={(mode) => {
                  if (mode !== 'free' && mode !== 'focused') return
                  freestyleFlipMode.onChange(mode)
                }}
                className="grid gap-2"
                aria-label="随心翻卡模式"
              >
                <label className="flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 hover:bg-accent">
                  <RadioGroupItem value="free" className="mt-0.5" />
                  <span className="grid gap-0.5 text-sm">
                    <span>随心模式</span>
                    <span className="text-xs text-muted-foreground">整座宫殿的卡片都可以翻</span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 hover:bg-accent">
                  <RadioGroupItem value="focused" className="mt-0.5" />
                  <span className="grid gap-0.5 text-sm">
                    <span>专线模式</span>
                    <span className="text-xs text-muted-foreground">只允许当前复习单元及祖先路径</span>
                  </span>
                </label>
              </RadioGroup>
            </fieldset>
          ) : null}

          {freestyleAutoAdvance ? (
            <fieldset className="space-y-2 border-t pt-4">
              <legend className="text-sm font-medium">评分后自动进下一张</legend>
              <label className="flex cursor-pointer items-start justify-between gap-4 rounded-md border px-3 py-2.5 hover:bg-accent">
                <span className="grid gap-0.5 text-sm">
                  <span>记得 / 轻松后自动前进</span>
                  <span className="text-xs text-muted-foreground">
                    留出撤销时间后翻页；忘记 / 困难始终停在原卡
                  </span>
                </span>
                <Switch
                  checked={freestyleAutoAdvance.value}
                  onCheckedChange={freestyleAutoAdvance.onChange}
                  aria-label="评分后自动进下一张"
                />
              </label>
            </fieldset>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            完成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
