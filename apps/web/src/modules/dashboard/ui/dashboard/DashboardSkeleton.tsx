import { Card, CardContent } from '@/shared/components/ui/card'
import { Skeleton } from '@/shared/components/ui/skeleton'

function SkeletonCard({ className, rows }: { className?: string; rows: number }) {
  return (
    <Card className={className}>
      <CardContent className="flex flex-col gap-3 p-4">
        <Skeleton className="h-4 w-24" />
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </CardContent>
    </Card>
  )
}

export function DashboardSkeleton() {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="flex min-h-0 flex-col gap-3">
        <SkeletonCard rows={3} />
        <SkeletonCard rows={3} />
        <SkeletonCard rows={4} className="flex-1" />
      </div>
      <div className="hidden min-h-0 flex-col gap-3 lg:flex">
        <SkeletonCard rows={3} />
        <SkeletonCard rows={2} />
        <SkeletonCard rows={5} className="flex-1" />
      </div>
      <div className="hidden min-h-0 flex-col gap-3 lg:flex">
        <SkeletonCard rows={5} className="flex-1" />
        <SkeletonCard rows={4} className="flex-1" />
      </div>
    </div>
  )
}
