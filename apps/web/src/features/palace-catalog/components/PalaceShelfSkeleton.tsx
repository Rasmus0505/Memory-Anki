import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  SkeletonListRows,
  SkeletonPageHeader,
  SkeletonToolbar,
} from '@/shared/components/ui/skeleton-layout'

export function PalaceShelfSkeleton() {
  return (
    <div className="space-y-6">
      {/* PageIntro */}
      <SkeletonPageHeader actions={1} />

      {/* Toolbar card */}
      <SkeletonToolbar buttons={3} framed />

      {/* Card grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-lg border p-5 space-y-3">
            <SkeletonListRows rows={1} iconClassName="size-10 rounded-xl" />
            <Skeleton className="h-3 w-full" />
            <div className="flex gap-2">
              <Skeleton className="h-5 w-12 rounded-full" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
