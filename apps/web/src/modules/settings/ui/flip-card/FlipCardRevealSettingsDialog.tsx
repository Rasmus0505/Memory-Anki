import { useEffect, useState, type ReactNode } from 'react'
import { Keyboard, SlidersHorizontal } from 'lucide-react'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { ToggleGroup, ToggleGroupItem } from '@/shared/components/ui/toggle-group'
import { Button } from '@/shared/components/ui/button'
import { Switch } from '@/shared/components/ui/switch'
import { cn } from '@/shared/lib/utils'
import type { FlipCardEditScope, FlipCardRevealConfig, RevealGranularity, RevealStage } from '@/shared/preferences/flipCardRevealConfig'
import type { FreestyleFlipMode } from '@/modules/practice/public'
import { FlipCardShortcutSettings } from '@/modules/settings/ui/shortcuts/FlipCardShortcutSettings'

type FlipCardSettingsPage = 'reveal' | 'shortcuts'

export interface FlipCardRevealSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: FlipCardRevealConfig
  onChange: (value: FlipCardRevealConfig) => void
  freestyleFlipMode?: {
    value: FreestyleFlipMode
    onChange: (value: FreestyleFlipMode) => void
  }
}

function SettingRow({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 pt-0.5">
        <div className="text-[13px] font-medium leading-5">{label}</div>
        {hint ? <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function BinaryToggle<T extends string>({
  value,
  onChange,
  ariaLabel,
  options,
  className,
}: {
  value: T
  onChange: (value: T) => void
  ariaLabel: string
  options: Array<{ value: T; label: string }>
  className?: string
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next !== options[0].value && next !== options[1].value) return
        onChange(next as T)
      }}
      className={cn('grid w-[13.75rem] grid-cols-2', className)}
      aria-label={ariaLabel}
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value} className="h-7 px-2 text-[13px]">
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

export function FlipCardRevealSettingsDialog({
  open,
  onOpenChange,
  value,
  onChange,
  freestyleFlipMode,
}: FlipCardRevealSettingsDialogProps) {
  const [page, setPage] = useState<FlipCardSettingsPage>('reveal')

  useEffect(() => {
    if (open) setPage('reveal')
  }, [open])

  const pages: Array<{ key: FlipCardSettingsPage; label: string; icon: typeof Keyboard }> = [
    { key: 'reveal', label: '翻卡', icon: SlidersHorizontal },
    { key: 'shortcuts', label: '快捷键', icon: Keyboard },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md"
        floatingId="flip-card-reveal-settings"
        data-testid="flip-card-reveal-settings-dialog"
      >
        <DialogHeader>
          <DialogTitle>翻卡设置</DialogTitle>
          <DialogDescription>
            {page === 'shortcuts'
              ? '配置翻卡、收卡、批量翻卡和随心页翻页键。'
              : '点击揭示、Enter 翻卡、双击空白画布进入编辑，以及评分后是否翻页。'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 border-b px-5" role="tablist" aria-label="翻卡设置页面">
          {pages.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={page === key}
              onClick={() => setPage(key)}
              className={cn(
                '-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
                page === key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>

        {page === 'shortcuts' ? (
          <DialogBody className="space-y-4">
            <FlipCardShortcutSettings />
          </DialogBody>
        ) : (
        <DialogBody className="space-y-4">
          <section className="space-y-3">
            <SettingRow label="翻卡颗粒度">
              <BinaryToggle<RevealGranularity>
                value={value.granularity}
                onChange={(granularity) => onChange({ ...value, granularity })}
                ariaLabel="翻卡颗粒度"
                options={[
                  { value: 'single', label: '逐张' },
                  { value: 'level', label: '同层批量' },
                ]}
              />
            </SettingRow>
            <SettingRow label="揭示方式" hint="两阶段会先出待回忆占位符">
              <BinaryToggle<RevealStage>
                value={value.stage}
                onChange={(stage) => onChange({ ...value, stage })}
                ariaLabel="揭示方式"
                options={[
                  { value: 'two-step', label: '两阶段' },
                  { value: 'direct', label: '直接显示' },
                ]}
              />
            </SettingRow>
          </section>

          <section className="space-y-3 border-t border-border/60 pt-3">
            {freestyleFlipMode ? (
              <SettingRow label="可翻范围" hint="随心模式可翻整座宫殿">
                <BinaryToggle<FreestyleFlipMode>
                  value={freestyleFlipMode.value}
                  onChange={freestyleFlipMode.onChange}
                  ariaLabel="随心翻卡模式"
                  options={[
                    { value: 'free', label: '随心模式' },
                    { value: 'focused', label: '专线模式' },
                  ]}
                />
              </SettingRow>
            ) : null}
            {freestyleFlipMode ? (
              <SettingRow
                label="Enter 翻卡镜头追踪"
                hint="翻出的卡片自动移入视野；关闭后视角保持不动"
              >
                <Switch
                  checked={value.enterRevealFollow !== false}
                  onCheckedChange={(checked) => onChange({ ...value, enterRevealFollow: checked })}
                  aria-label="Enter 翻卡镜头追踪"
                />
              </SettingRow>
            ) : null}
            {freestyleFlipMode ? (
              <SettingRow
                label="评分后自动翻页"
                hint="评分保存后自动翻到最早还没评分的单元，留一点撤销时间；关闭则手动翻"
              >
                <Switch
                  checked={value.autoAdvanceOnRate === true}
                  onCheckedChange={(checked) => onChange({ ...value, autoAdvanceOnRate: checked })}
                  aria-label="评分后自动翻页"
                />
              </SettingRow>
            ) : null}
            <SettingRow label="进入编辑" hint="双击空白画布时的编辑范围">
              <BinaryToggle<FlipCardEditScope>
                value={value.editScope === 'palace' ? 'palace' : 'unit'}
                onChange={(editScope) => onChange({ ...value, editScope })}
                ariaLabel="进入编辑范围"
                options={[
                  { value: 'unit', label: '当前专线' },
                  { value: 'palace', label: '整座宫殿' },
                ]}
              />
            </SettingRow>
          </section>
        </DialogBody>
        )}

        <DialogFooter>
          <Button type="button" size="sm" variant="outline" onClick={() => onOpenChange(false)}>
            完成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
