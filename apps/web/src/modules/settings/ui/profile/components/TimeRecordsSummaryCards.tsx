import { formatDuration, type TimeRecordSummary } from '@/modules/session/public'

interface TimeRecordsSummaryCardsProps {
  summary: TimeRecordSummary
}

export function TimeRecordsSummaryCards({
  summary,
}: TimeRecordsSummaryCardsProps) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/90 p-6 shadow-card">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            时间记录
          </h1>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-border/60 bg-background/80 px-4 py-3">
            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              总记录数
            </div>
            <div className="mt-2 text-2xl font-semibold text-foreground">
              {summary.totalRecords}
            </div>
          </div>
          <div className="rounded-lg border border-border/60 bg-background/80 px-4 py-3">
            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              累计有效时长
            </div>
            <div className="mt-2 text-2xl font-semibold text-foreground">
              {formatDuration(summary.totalEffectiveSeconds)}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
