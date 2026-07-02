import { Card, CardContent } from '@/shared/components/ui/card'
import { Skeleton } from '@/shared/components/ui/skeleton'

export function ReviewSessionSkeleton() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6">
      {/* Progress bar area */}
      <div className="flex w-full max-w-2xl flex-col gap-2">
        <div className="flex justify-between">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-12" />
        </div>
        <Skeleton className="h-2 w-full rounded-full" />
      </div>

      {/* Card */}
      <Card className="w-full max-w-2xl">
        <CardContent className="flex flex-col gap-6 pt-8">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <div className="flex justify-center gap-3 pt-4">
          <Skeleton className="h-10 w-24 rounded-md" />
          <Skeleton className="h-10 w-24 rounded-md" />
          <Skeleton className="h-10 w-24 rounded-md" />
        </div>
        </CardContent>
      </Card>
    </div>
  )
}
