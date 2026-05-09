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
        'h-[280px] w-full rounded-3xl border border-border/60 bg-gradient-to-b from-background to-slate-50/80 p-3',
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
    <div className="min-w-[140px] rounded-2xl border border-border/70 bg-background/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      {label ? <div className="mb-2 font-medium text-foreground">{label}</div> : null}
      <div className="space-y-1.5">
        {payload.map((entry) => {
          const numericValue = typeof entry.value === 'number' ? entry.value : Number(entry.value ?? 0)
          return (
            <div key={entry.dataKey?.toString()} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-muted-foreground">
                <span
                  className="h-2.5 w-2.5 rounded-full"
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
