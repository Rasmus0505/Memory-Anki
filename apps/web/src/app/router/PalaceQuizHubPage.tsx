import { BookOpen, ChevronRight, Search, Target } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { DEFAULT_PALACE_LIST_VIEW_SETTINGS } from '@/app/router/palace-view-settings'
import { PalaceListSections } from '@/app/router/palace-list/PalaceListSections'
import type { PalaceGroupedItem, PalaceGroupedListResponse } from '@/shared/api/contracts'
import { getPalacesGroupedApi } from '@/shared/api/modules/palaces'
import { PageIntro } from '@/shared/components/layout/PageIntro'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'

function flattenGroupedPalaces(data: PalaceGroupedListResponse) {
  const list: PalaceGroupedItem[] = []
  for (const subject of data.subjects) {
    for (const group of subject.chapter_groups) {
      list.push(...group.palaces)
    }
    list.push(...subject.ungrouped_palaces)
  }
  return list
}

function QuizPalaceCard({ palace }: { palace: PalaceGroupedItem }) {
  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="flex items-start gap-3 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary">
          <BookOpen className="h-5 w-5 text-muted-foreground" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">
                {palace.resolved_title || palace.title || '未命名宫殿'}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {palace.primary_chapter?.name ? (
                  <Badge variant="outline">{palace.primary_chapter.name}</Badge>
                ) : null}
                <span>{palace.segments?.length ?? 0} 个分段</span>
                {(palace.focus_count ?? 0) > 0 ? (
                  <span className="inline-flex items-center gap-1 text-warning">
                    <Target className="h-3.5 w-3.5" />
                    专项 {(palace.focus_count ?? 0)} 张
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Link to={`/palaces/${palace.id}`}>
                <Button variant="outline" size="sm">
                  查看脑图
                </Button>
              </Link>
              <Link to={`/palaces/${palace.id}/quiz`}>
                <Button size="sm">
                  开始做题
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>

          {palace.description ? (
            <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
              {palace.description}
            </p>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">进入这座宫殿的题库做配套练习。</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export default function PalaceQuizHubPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get('search') || ''
  const [groupedData, setGroupedData] = useState<PalaceGroupedListResponse>({
    groups: [],
    ungrouped: [],
    subjects: [],
  })
  const [collapsedChapters, setCollapsedChapters] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (search) params.search = search
      const data = await getPalacesGroupedApi(params)
      setGroupedData(data)
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  const allPalaces = useMemo(() => flattenGroupedPalaces(groupedData), [groupedData])

  return (
    <div className="space-y-6">
      <PageIntro
        eyebrow="记忆宫殿"
        title="做题区"
        description="把所有宫殿的配套题库集中到一起，直接进入目标宫殿开始做题。"
      />

      <Card className="border-border/70 bg-card/92">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-[220px] flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) =>
                  setSearchParams((params) => {
                    if (event.target.value) params.set('search', event.target.value)
                    else params.delete('search')
                    return params
                  })
                }
                placeholder="搜索宫殿、章节或学科..."
                className="pl-9"
              />
            </div>
          </div>
          <div className="text-sm text-muted-foreground">
            {loading ? '正在整理题库入口...' : `共 ${allPalaces.length} 座宫殿可进入做题`}
          </div>
        </CardContent>
      </Card>

      <PalaceListSections
        groupedData={groupedData}
        hasPalaces={allPalaces.length > 0}
        viewSettings={DEFAULT_PALACE_LIST_VIEW_SETTINGS}
        collapsedChapters={collapsedChapters}
        onToggleChapter={(chapterId) =>
          setCollapsedChapters((current) => {
            const next = new Set(current)
            if (next.has(chapterId)) next.delete(chapterId)
            else next.add(chapterId)
            return next
          })
        }
        renderPalaceCard={(palace) => <QuizPalaceCard key={palace.id} palace={palace} />}
      />
    </div>
  )
}
