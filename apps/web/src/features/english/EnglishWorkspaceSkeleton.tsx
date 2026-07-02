import { Skeleton } from '@/shared/components/ui/skeleton'

export function EnglishWorkspaceSkeleton() {
  return (
    <div className="space-y-6">
      {/* PageIntro */}
      <Skeleton className="h-8 w-32" />

      {/* 2-col cards */}
      <div className="grid xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] gap-4">
        {/* Left: upload/task card */}
        <div className="rounded-lg border p-5 space-y-4">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-32 w-full rounded-xl" />
          <div className="flex gap-3">
            <Skeleton className="h-9 w-24 rounded-md" />
            <Skeleton className="h-9 w-24 rounded-md" />
          </div>
        </div>

        {/* Right: course list */}
        <div className="rounded-lg border p-5 space-y-4">
          <Skeleton className="h-5 w-20" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-2">
              <Skeleton className="size-10 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
              <Skeleton className="h-7 w-14 rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
