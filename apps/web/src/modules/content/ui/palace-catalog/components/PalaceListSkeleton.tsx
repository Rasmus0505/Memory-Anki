import { PageContainer } from '@/shared/components/layout/PageLayout'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  SkeletonListRows,
  SkeletonPageHeader,
  SkeletonToolbar,
} from '@/shared/components/ui/skeleton-layout'

export function PalaceListSkeleton() {
  return (
    <PageContainer wide>
      {/* PageHeader */}
      <SkeletonPageHeader actions={1} titleClassName="h-7 w-28" withIcon />

      {/* Toolbar */}
      <SkeletonToolbar buttons={1} />

      {/* Grouped card list — 2 groups */}
      {Array.from({ length: 2 }).map((_, g) => (
        <div key={g} className="space-y-3">
          <Skeleton className="h-5 w-20" />
          <SkeletonListRows
            rows={3}
            withTrailing
            framed
            trailingClassName="h-5 w-14 rounded-full"
          />
        </div>
      ))}
    </PageContainer>
  )
}
