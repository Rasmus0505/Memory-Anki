import { Skeleton } from '@/shared/components/ui/skeleton'

export function KnowledgeSkeleton() {
  return (
    <div className="space-y-6">
      {/* PageIntro */}
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-5 w-14 rounded-full" />
      </div>

      {/* 2-col: sidebar + main */}
      <div className="grid xl:grid-cols-[320px_minmax(0,1fr)] gap-4">
        {/* Left sidebar */}
        <div className="rounded-lg border p-4 space-y-3">
          <Skeleton className="h-5 w-20" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-md" />
          ))}
          <div className="pt-3 space-y-2">
            <Skeleton className="h-9 w-full rounded-md" />
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
        </div>

        {/* Right mind-map area */}
        <div className="rounded-lg border p-4 space-y-3">
          {/* Toolbar */}
          <div className="flex items-center gap-2">
            <Skeleton className="size-8 rounded-md" />
            <Skeleton className="size-8 rounded-md" />
            <Skeleton className="size-8 rounded-md" />
            <div className="flex-1" />
            <Skeleton className="h-8 w-20 rounded-md" />
          </div>
          {/* Canvas placeholder */}
          <Skeleton className="h-[400px] w-full rounded-xl" />
        </div>
      </div>
    </div>
  )
}
