import { Skeleton } from '@/shared/components/ui/skeleton'

export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <Skeleton className="h-8 w-40" />

      {/* 5 stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-2xl border p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-5 rounded" />
              <Skeleton className="h-4 w-16" />
            </div>
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>

      {/* 2-col content cards */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* 今日学习 */}
        <div className="rounded-2xl border p-5 space-y-4">
          <Skeleton className="h-5 w-24" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-4 w-4 rounded" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-10" />
            </div>
          ))}
        </div>
        {/* 新增章节 */}
        <div className="rounded-2xl border p-5 space-y-4">
          <Skeleton className="h-5 w-28" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-4 w-4 rounded" />
              <Skeleton className="h-4 flex-1" />
            </div>
          ))}
        </div>
      </div>

      {/* 2-col charts */}
      <div className="grid xl:grid-cols-2 gap-4">
        <div className="rounded-2xl border p-5 space-y-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-52 rounded-xl" />
        </div>
        <div className="rounded-2xl border p-5 space-y-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-52 rounded-xl" />
        </div>
      </div>
    </div>
  )
}
