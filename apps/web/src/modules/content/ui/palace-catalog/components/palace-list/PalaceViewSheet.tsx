import { SlidersHorizontal, type List } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/shared/components/ui/sheet'
import { cn } from '@/shared/lib/utils'

export interface PalaceViewOption<T extends string = string> {
  value: T
  label: string
  icon?: typeof List
}

interface PalaceViewGroup<T extends string> {
  label: string
  options: Array<PalaceViewOption<T>>
  value: T
  onChange: (value: T) => void
}

interface PalaceViewSheetProps {
  /** e.g. 书架视图 / 宫殿视图 */
  title: string
  /** One-line "封面 · 双列 · 标准" summary shown under the title. */
  summary: string
  display?: PalaceViewGroup<string>
  layout: PalaceViewGroup<string>
  density: PalaceViewGroup<string>
  onReset: () => void
  triggerTestId: string
}

function OptionButton({ option, active, onClick }: {
  option: PalaceViewOption
  active: boolean
  onClick: () => void
}) {
  const Icon = option.icon
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border px-3 text-sm font-medium transition-colors',
        active
          ? 'border-primary/40 bg-primary-soft text-primary-strong'
          : 'border-border/70 bg-background/70 text-muted-foreground hover:bg-accent',
      )}
    >
      {Icon ? <Icon className="size-4" aria-hidden /> : null}
      {option.label}
    </button>
  )
}

function OptionSection({ group }: { group: PalaceViewGroup<string> }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">{group.label}</h3>
      <div className={cn(
        'grid gap-2',
        group.options.length === 2 ? 'grid-cols-2' : group.options.length === 3 ? 'grid-cols-3' : 'grid-cols-2',
      )}>
        {group.options.map((option) => (
          <OptionButton
            key={option.value}
            option={option}
            active={group.value === option.value}
            onClick={() => group.onChange(option.value)}
          />
        ))}
      </div>
    </section>
  )
}

/**
 * Phone entry point for shelf/list view options. The inline segmented rows are
 * a desktop luxury: on a phone they stacked five lines of controls before the
 * first shelf or palace card was visible. Same settings, one tap deep.
 */
export function PalaceViewSheet({
  title,
  summary,
  display,
  layout,
  density,
  onReset,
  triggerTestId,
}: PalaceViewSheetProps) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 shrink-0 gap-1.5 rounded-xl px-3 sm:hidden"
          data-testid={triggerTestId}
        >
          <SlidersHorizontal className="size-4" aria-hidden />
          视图
        </Button>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        className="max-h-[85dvh] overflow-y-auto rounded-t-3xl p-0 pb-[max(env(safe-area-inset-bottom),1rem)]"
      >
        <SheetHeader className="border-b border-border/70 px-5 pb-3 pr-14 pt-5">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{summary}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-5 py-4">
          {display ? <OptionSection group={display} /> : null}
          <OptionSection group={layout} />
          <OptionSection group={density} />
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 self-start rounded-xl px-3 text-muted-foreground"
            onClick={onReset}
          >
            恢复默认
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
