import * as React from 'react'
import { cn } from '@/shared/lib/utils'

export interface ChartConfigItem {
  label: string
  color: string
}

export type ChartConfig = Record<string, ChartConfigItem>

export function ChartContainer({
  config,
  className,
  children,
}: React.PropsWithChildren<{ config: ChartConfig; className?: string }>) {
  const style = Object.entries(config).reduce<Record<string, string>>((accumulator, [key, value]) => {
    accumulator[`--color-${key}`] = value.color
    return accumulator
  }, {})

  return (
    <div
      className={cn(
        'h-[280px] min-h-0 min-w-0 w-full rounded-lg border border-border/70 bg-card p-3',
        className,
      )}
      style={style as React.CSSProperties}
    >
      {children}
    </div>
  )
}

interface ChartTooltipEntry {
  color?: string
  dataKey?: string | number
  name?: string | number
  payload?: { fill?: string }
  value?: number | string
}

interface ChartTooltipContentProps {
  active?: boolean
  payload?: ChartTooltipEntry[]
  label?: string | number
  formatter?: (value: number, name: string) => string
}

export function ChartTooltipContent({
  active,
  payload,
  label,
  formatter,
}: ChartTooltipContentProps) {
  if (!active || !payload?.length) return null

  return (
    <div className="min-w-[140px] rounded-lg border border-border/70 bg-popover px-3 py-2 text-xs text-popover-foreground shadow-popover">
      {label ? <div className="mb-2 font-medium text-foreground">{label}</div> : null}
      <div className="flex flex-col gap-1.5">
        {payload.map((entry) => {
          const numericValue = typeof entry.value === 'number' ? entry.value : Number(entry.value ?? 0)
          return (
            <div key={entry.dataKey?.toString()} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-muted-foreground">
                <span
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: entry.color ?? entry.payload?.fill ?? 'currentColor' }}
                />
                <span>{entry.name}</span>
              </div>
              <div className="font-medium text-foreground">
                {formatter ? formatter(numericValue, String(entry.name)) : numericValue}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
