import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Sparkles } from 'lucide-react'
import type { DashboardResponse } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Pagination } from '@/shared/components/ui/pagination'

const PAGE_SIZE = 5

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
}

export function DashboardNewPalacesCard({ data }: DashboardNewPalacesCardProps) {
  const flatItems = useMemo(() => flattenNewPalaces(data), [data])
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(flatItems.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageItems = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE
    return flatItems.slice(start, start + PAGE_SIZE)
  }, [flatItems, safePage])
  const showSubjectTitle =
    data.today_new_palaces.filter((item) => item.subject).length > 1

  return (
    <Card className="flex min-h-0 flex-col">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{`新增章节数量：${data.today_new_palace_count}`}</CardTitle>
        <Link to="/palaces/new">
          <Button size="sm" variant="outline" className="h-8">
            <Plus data-icon="inline-start" />
            新建
          </Button>
        </Link>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">
        {flatItems.length > 0 ? (
          <>
            <div className="flex min-h-[240px] flex-col gap-2">
              {pageItems.map((item) => (
                <div key={item.key} className="rounded-lg border border-border/50 px-2 py-2">
                  {showSubjectTitle && item.subjectName ? (
                    <div className="text-[11px] font-medium text-muted-foreground">
                      {item.subjectName}
                    </div>
                  ) : null}
                  <div className="text-xs text-muted-foreground">{item.chapterName}</div>
                  <Link
                    to={`/palaces/${item.palaceId}/edit`}
                    className="mt-0.5 block truncate rounded-md px-1 py-1 text-sm transition-colors hover:bg-secondary active:scale-[0.98]"
                  >
                    {item.palaceTitle}
                  </Link>
                </div>
              ))}
            </div>
            {totalPages > 1 ? (
              <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/60 pt-3">
                <div className="text-xs text-muted-foreground">
                  第 {safePage} / {totalPages} 页 · 共 {flatItems.length} 项
                </div>
                <Pagination
                  page={safePage}
                  totalPages={totalPages}
                  onPageChange={setPage}
                  className="justify-end"
                  aria-label="新增章节分页"
                />
              </div>
            ) : null}
          </>
        ) : (
          <div className="py-8 text-center text-sm text-muted-foreground">
            今天还没有新增记忆宫殿。
            <div className="mt-3">
              <Link to="/palaces/new">
                <Button variant="outline" size="sm">
                  <Sparkles data-icon="inline-start" />
                  创建一个
                </Button>
              </Link>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
