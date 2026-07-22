import { Card, CardContent } from '@/shared/components/ui/card'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { SkeletonFormRows, SkeletonPageHeader } from '@/shared/components/ui/skeleton-layout'

export function ProfileSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <SkeletonPageHeader titleClassName="h-8 w-24" />
        <Skeleton className="size-48" />
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b pb-px">
        <Skeleton className="h-9 w-20 rounded-md" />
        <Skeleton className="h-9 w-20 rounded-md" />
        <Skeleton className="h-9 w-20 rounded-md" />
      </div>

      {/* Tab content panel */}
      <Card>
        <CardContent className="flex flex-col gap-5 pt-6">
          <SkeletonFormRows rows={4} />
          <Skeleton className="h-9 w-20 rounded-md" />
        </CardContent>
      </Card>
    </div>
  )
}
