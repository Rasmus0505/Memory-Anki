import { formatDuration, type TimeRecordSummary } from '@/entities/session/model'

interface TimeRecordsSummaryCardsProps {
  summary: TimeRecordSummary
}

export function TimeRecordsSummaryCards({
  summary,
}: TimeRecordsSummaryCardsProps) {
  return (
    <div className="rounded-[28px] border border-border/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(239,246,255,0.92))] p-6 shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
            时间记录
          </h1>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-border/60 bg-background/80 px-4 py-3">
            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              总记录数
            </div>
            <div className="mt-2 text-2xl font-semibold text-slate-950">
              {summary.totalRecords}
            </div>
          </div>
          <div className="rounded-2xl border border-border/60 bg-background/80 px-4 py-3">
            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              累计有效时长
            </div>
            <div className="mt-2 text-2xl font-semibold text-slate-950">
              {formatDuration(summary.totalEffectiveSeconds)}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
