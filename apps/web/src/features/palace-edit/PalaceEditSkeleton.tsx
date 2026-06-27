import { Skeleton } from '@/shared/components/ui/skeleton'

export function PalaceEditSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header with back + title */}
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-8 rounded-md" />
        <Skeleton className="h-7 w-36" />
      </div>

      {/* Editor layout: sidebar + main */}
      <div className="grid xl:grid-cols-[300px_minmax(0,1fr)] gap-4">
        {/* Left: chapter/binding sidebar */}
        <div className="space-y-3">
          <div className="rounded-2xl border p-4 space-y-3">
            <Skeleton className="h-5 w-16" />
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full rounded-md" />
            ))}
          </div>
          <div className="rounded-2xl border p-4 space-y-3">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-20 w-full rounded-md" />
          </div>
        </div>

        {/* Right: editor / mind-map area */}
        <div className="rounded-2xl border p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-8 rounded-md" />
            <Skeleton className="h-8 w-8 rounded-md" />
            <Skeleton className="h-8 w-8 rounded-md" />
          </div>
          <Skeleton className="h-[450px] w-full rounded-xl" />
        </div>
      </div>
    </div>
  )
}
