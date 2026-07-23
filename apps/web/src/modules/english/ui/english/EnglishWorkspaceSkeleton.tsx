import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  SkeletonListRows,
  SkeletonPageHeader,
  SkeletonPanel,
} from '@/shared/components/ui/skeleton-layout'
import { EnglishZoneLayout } from '@/modules/english/ui/english-shell'

export function EnglishWorkspaceSkeleton() {
  return (
    <EnglishZoneLayout
      zone="listening"
      title="英语听力"
      description="上传视频生成逐句听写课程；句模与生词在阅读/全局库中统一管理。"
    >
      <div className="space-y-5" data-testid="english-workspace-skeleton">
        <SkeletonPageHeader />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-4 rounded-2xl border border-border/70 bg-card/95 p-5">
            <Skeleton className="h-5 w-24" />
            <SkeletonPanel heightClassName="h-32" />
            <div className="flex gap-3">
              <Skeleton className="h-9 w-24 rounded-md" />
              <Skeleton className="h-9 w-24 rounded-md" />
            </div>
          </div>
          <div className="space-y-4 rounded-2xl border border-border/70 bg-card/95 p-5">
            <Skeleton className="h-5 w-20" />
            <SkeletonListRows rows={5} withTrailing trailingClassName="h-7 w-14 rounded-md" />
          </div>
        </div>
      </div>
    </EnglishZoneLayout>
  )
}
