import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  SkeletonBlockRows,
  SkeletonPageHeader,
  SkeletonPanel,
} from '@/shared/components/ui/skeleton-layout'

export function PalaceEditSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header with back + title */}
      <SkeletonPageHeader titleClassName="h-7 w-36" withIcon />

      {/* Editor layout: sidebar + main */}
      <div className="grid xl:grid-cols-[300px_minmax(0,1fr)] gap-4">
        {/* Left: chapter/binding sidebar */}
        <div className="space-y-3">
          <div className="rounded-lg border p-4 space-y-3">
            <Skeleton className="h-5 w-16" />
            <SkeletonBlockRows rows={5} />
          </div>
          <div className="rounded-lg border p-4 space-y-3">
            <Skeleton className="h-5 w-20" />
            <SkeletonPanel heightClassName="h-20 rounded-md" />
          </div>
        </div>

        {/* Right: editor / mind-map area */}
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Skeleton className="size-8 rounded-md" />
            <Skeleton className="size-8 rounded-md" />
            <Skeleton className="size-8 rounded-md" />
          </div>
          <SkeletonPanel heightClassName="h-[450px]" />
        </div>
      </div>
    </div>
  )
}
