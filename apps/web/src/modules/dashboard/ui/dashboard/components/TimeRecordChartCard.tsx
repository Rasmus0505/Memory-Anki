import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { cn } from '@/shared/lib/utils'

interface TimeRecordChartCardProps {
  title: string
  children: ReactNode
  className?: string
}

export function TimeRecordChartCard({
  title,
  children,
  className,
}: TimeRecordChartCardProps) {
  return (
    <Card className={cn('flex min-h-0 min-w-0 flex-col border-border/70', className)}>
      <CardHeader className="shrink-0 space-y-0 p-4 pb-1">
        <CardTitle className="truncate text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="min-h-0 min-w-0 flex-1 p-3 pt-0">{children}</CardContent>
    </Card>
  )
}
