import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Sparkles } from 'lucide-react'
import type { DashboardResponse } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { cn } from '@/shared/lib/utils'
import { useFitPageSize } from '@/modules/dashboard/ui/dashboard/model/useFitPageSize'
import { CompactPager } from './CompactPager'

const ITEM_HEIGHT = 50
const ITEM_GAP = 6
const FALLBACK_PAGE_SIZE = 5

interface FlatNewPalaceItem {
  key: string
  subjectName: string | null
  chapterName: string
  palaceId: number
  palaceTitle: string
}

function flattenNewPalaces(
  data: Pick<DashboardResponse, 'today_new_palaces'>,
): FlatNewPalaceItem[] {
  const items: FlatNewPalaceItem[] = []
  data.today_new_palaces.forEach((subjectGroup, subjectIndex) => {
    const subjectName = subjectGroup.subject?.name ?? null
    subjectGroup.chapter_groups.forEach((group) => {
      const chapterName = group.source_chapter?.name ?? '未关联章节'
      group.palaces.forEach((palace) => {
        items.push({
          key: `grouped-${palace.id}`,
          subjectName,
          chapterName,
          palaceId: palace.id,
          palaceTitle: palace.title || '未命名宫殿',
        })
      })
    })
    subjectGroup.ungrouped_palaces.forEach((palace) => {
      items.push({
        key: `ungrouped-${palace.id}-${subjectIndex}`,
        subjectName,
        chapterName: '未关联章节',
        palaceId: palace.id,
        palaceTitle: palace.title || '未命名宫殿',
      })
    })
  })
  return items
}

interface DashboardNewPalacesCardProps {
  data: Pick<DashboardResponse, 'today_new_palace_count' | 'today_new_palaces'>
  className?: string
}

export function DashboardNewPalacesCard({ data, className }: DashboardNewPalacesCardProps) {
  const flatItems = useMemo(() => flattenNewPalaces(data), [data])
  const [page, setPage] = useState(1)
  const { ref: listRef, pageSize } = useFitPageSize<HTMLDivElement>(ITEM_HEIGHT, ITEM_GAP, FALLBACK_PAGE_SIZE)
  const totalPages = Math.max(1, Math.ceil(flatItems.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageItems = useMemo(() => {
    const start = (safePage - 1) * pageSize
    return flatItems.slice(start, start + pageSize)
  }, [flatItems, safePage, pageSize])
  const showSubjectTitle = data.today_new_palaces.filter((item) => item.subject).length > 1

  return (
    <Card className={cn('flex min-h-0 flex-col', className)}>
      <CardHeader className="flex shrink-0 flex-row items-center justify-between space-y-0 p-4 pb-2">
        <CardTitle className="text-base">{`新增章节数量：${data.today_new_palace_count}`}</CardTitle>
        <Button asChild size="sm" variant="outline" className="h-7">
          <Link to="/palaces/new">
            <Plus data-icon="inline-start" />
            新建
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col p-4 pt-1">
        <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-1.5">
          {flatItems.length > 0 ? (
            pageItems.map((item) => (
              <Link
                key={item.key}
                to={`/palaces/${item.palaceId}/edit`}
                className="block shrink-0 rounded-lg border border-border/50 px-2.5 py-1.5 transition-colors hover:bg-secondary active:scale-[0.98]"
              >
                <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                  {showSubjectTitle && item.subjectName ? (
                    <span className="shrink-0 font-medium">{item.subjectName}</span>
                  ) : null}
                  <span className="truncate">{item.chapterName}</span>
                </div>
                <div className="truncate text-sm">{item.palaceTitle}</div>
              </Link>
            ))
          ) : (
            <div className="m-auto text-center text-sm text-muted-foreground">
              今天还没有新增记忆宫殿。
              <div className="mt-3">
                <Button asChild variant="outline" size="sm">
                  <Link to="/palaces/new">
                    <Sparkles data-icon="inline-start" />
                    创建一个
                  </Link>
                </Button>
              </div>
            </div>
          )}
        </div>
        {flatItems.length > 0 ? (
          <div className="mt-2 flex h-8 shrink-0 items-center justify-between gap-3 border-t border-border/60 pt-1">
            <div className="text-xs text-muted-foreground">共 {flatItems.length} 项</div>
            {totalPages > 1 ? (
              <CompactPager page={safePage} totalPages={totalPages} onPageChange={setPage} aria-label="新增章节分页" />
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
