import { Card, CardContent } from '@/shared/components/ui/card'
import { Skeleton } from '@/shared/components/ui/skeleton'

export function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      {/* 页面标题 */}
      <Skeleton className="h-8 w-40" />

      {/* 5 stat cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="flex flex-col gap-3 pt-5">
            <div className="flex items-center gap-2">
              <Skeleton className="size-5 rounded" />
              <Skeleton className="h-4 w-16" />
            </div>
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-3 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 2-col content cards */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* 今日学习 */}
        <Card>
          <CardContent className="flex flex-col gap-4 pt-5">
          <Skeleton className="h-5 w-24" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-4 rounded" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-10" />
            </div>
          ))}
          </CardContent>
        </Card>
        {/* 新增章节 */}
        <Card>
          <CardContent className="flex flex-col gap-4 pt-5">
          <Skeleton className="h-5 w-28" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-4 rounded" />
              <Skeleton className="h-4 flex-1" />
            </div>
          ))}
          </CardContent>
        </Card>
      </div>

      {/* 2-col charts */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardContent className="flex flex-col gap-3 pt-5">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-52 rounded-xl" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-3 pt-5">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-52 rounded-xl" />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
