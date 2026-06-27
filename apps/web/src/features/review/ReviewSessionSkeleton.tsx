import { Skeleton } from '@/shared/components/ui/skeleton'

export function ReviewSessionSkeleton() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-6">
      {/* Progress bar area */}
      <div className="w-full max-w-2xl space-y-2">
        <div className="flex justify-between">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-12" />
        </div>
        <Skeleton className="h-2 w-full rounded-full" />
      </div>

      {/* Card */}
      <div className="w-full max-w-2xl rounded-2xl border p-8 space-y-6">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <div className="flex justify-center gap-3 pt-4">
          <Skeleton className="h-10 w-24 rounded-md" />
          <Skeleton className="h-10 w-24 rounded-md" />
          <Skeleton className="h-10 w-24 rounded-md" />
        </div>
      </div>
    </div>
  )
}
