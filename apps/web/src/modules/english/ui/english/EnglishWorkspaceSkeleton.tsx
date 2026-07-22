import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  SkeletonListRows,
  SkeletonPageHeader,
  SkeletonPanel,
} from '@/shared/components/ui/skeleton-layout'

export function EnglishWorkspaceSkeleton() {
  return (
    <div className="space-y-6">
      {/* PageIntro */}
      <SkeletonPageHeader />

      {/* 2-col cards */}
      <div className="grid xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] gap-4">
        {/* Left: upload/task card */}
        <div className="rounded-lg border p-5 space-y-4">
          <Skeleton className="h-5 w-24" />
          <SkeletonPanel heightClassName="h-32" />
          <div className="flex gap-3">
            <Skeleton className="h-9 w-24 rounded-md" />
            <Skeleton className="h-9 w-24 rounded-md" />
          </div>
        </div>

        {/* Right: course list */}
        <div className="rounded-lg border p-5 space-y-4">
          <Skeleton className="h-5 w-20" />
          <SkeletonListRows rows={4} withTrailing trailingClassName="h-7 w-14 rounded-md" />
        </div>
      </div>
    </div>
  )
}
