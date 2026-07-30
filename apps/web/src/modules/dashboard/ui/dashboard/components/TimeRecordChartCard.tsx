import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'

interface TimeRecordChartCardProps {
  title: string
  children: ReactNode
}

export function TimeRecordChartCard({
  title,
  children,
}: TimeRecordChartCardProps) {
  return (
    <Card className="min-w-0 border-border/70">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent className="min-w-0 pt-2">{children}</CardContent>
    </Card>
  )
}
