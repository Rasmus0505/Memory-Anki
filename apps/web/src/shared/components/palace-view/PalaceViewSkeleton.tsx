import { Skeleton } from '@/shared/components/ui/skeleton'

export function PalaceViewSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header with back + title + actions */}
      <div className="flex items-center gap-3">
        <Skeleton className="size-8 rounded-md" />
        <Skeleton className="h-7 w-40" />
        <div className="flex-1" />
        <Skeleton className="h-9 w-20 rounded-md" />
        <Skeleton className="h-9 w-20 rounded-md" />
      </div>

      {/* Stats row */}
      <div className="flex gap-4">
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-5 w-24 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>

      {/* Mind-map / content area */}
      <div className="rounded-lg border p-4">
        <Skeleton className="h-[500px] w-full rounded-xl" />
      </div>
    </div>
  )
}
