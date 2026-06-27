import { Skeleton } from '@/shared/components/ui/skeleton'

export function ProfileSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-4 w-48" />
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b pb-px">
        <Skeleton className="h-9 w-20 rounded-md" />
        <Skeleton className="h-9 w-20 rounded-md" />
        <Skeleton className="h-9 w-20 rounded-md" />
      </div>

      {/* Tab content panel */}
      <div className="rounded-2xl border p-6 space-y-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-full max-w-md rounded-md" />
          </div>
        ))}
        <Skeleton className="h-9 w-20 rounded-md" />
      </div>
    </div>
  )
}
