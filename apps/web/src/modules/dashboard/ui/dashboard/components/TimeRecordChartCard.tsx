import type { ReactNode } from 'react'
import type { TimeRecordChartRange } from '@/modules/session/public'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { TIME_RECORD_CHART_RANGE_OPTIONS } from '@/modules/dashboard/ui/dashboard/model/dashboard-duration-filter'

interface TimeRecordChartCardProps {
  title: string
  selectedRange: TimeRecordChartRange
  onRangeChange: (range: TimeRecordChartRange) => void
  children: ReactNode
}

export function TimeRecordChartCard({
  title,
  selectedRange,
  onRangeChange,
  children,
}: TimeRecordChartCardProps) {
  return (
    <Card className="min-w-0 border-border/70">
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-2">
        <CardTitle className="text-lg">{title}</CardTitle>
        <div className="flex flex-wrap justify-end gap-2">
          {TIME_RECORD_CHART_RANGE_OPTIONS.map((option) => (
            <Button
              key={option.label}
              size="sm"
              variant={selectedRange === option.value ? 'default' : 'outline'}
              className="h-7 px-2"
              onClick={() => onRangeChange(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="min-w-0 pt-2">{children}</CardContent>
    </Card>
  )
}
