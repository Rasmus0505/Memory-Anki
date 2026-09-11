import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  SkeletonBlockRows,
  SkeletonPageHeader,
  SkeletonPanel,
} from '@/shared/components/ui/skeleton-layout'

export function PalaceEditorSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header with back + title */}
      <SkeletonPageHeader titleClassName="h-7 w-36" withIcon />

      {/* Editor layout: left binding/meta + right mind-map */}
      <div className="flex min-h-0 flex-1">
        <div className="w-[280px] shrink-0 space-y-3">
          <div className="space-y-3 rounded-lg border p-4">
            <Skeleton className="h-5 w-28" />
            <SkeletonBlockRows rows={4} />
          </div>
          <div className="space-y-3 rounded-lg border p-4">
            <Skeleton className="h-5 w-20" />
            <SkeletonPanel heightClassName="h-20 rounded-md" />
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col space-y-3 rounded-lg border p-1">
          <div className="flex items-center gap-2">
            <Skeleton className="size-8 rounded-md" />
            <Skeleton className="size-8 rounded-md" />
            <Skeleton className="size-8 rounded-md" />
          </div>
          <SkeletonPanel heightClassName="min-h-[360px] flex-1 rounded-md" />
        </div>
      </div>
    </div>
  )
}
