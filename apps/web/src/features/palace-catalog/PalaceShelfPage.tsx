import { BookOpen, ChevronRight, LayoutGrid, LibraryBig, List, Plus, Rows3, Search, WrapText } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { PageIntro } from '@/shared/components/layout/PageIntro'
import { PalaceListCard } from '@/features/palace-catalog/components/palace-list/PalaceListCard'
import {
  DEFAULT_PALACE_SHELF_VIEW_SETTINGS,
  PALACE_SHELF_VIEW_SETTINGS_KEY,
  type PalaceListLayoutMode,
  type PalaceListViewSettings,
  type PalaceShelfDensityMode,
  type PalaceShelfLayoutMode,
  type PalaceShelfViewSettings,
  isPalaceShelfViewSettings,
} from '@/entities/preferences/model/palaceViewSettings'
import { PalaceListSections } from '@/features/palace-catalog/components/palace-list/PalaceListSections'
import type { PalaceGroupedItem, PalaceGroupedListResponse, PalaceSubjectShelfItem } from '@/shared/api/contracts'
import {
  getPalacesGroupedApi,
  getPalaceSubjectShelfApi,
  PALACE_CATALOG_INVALIDATED_EVENT,
} from '@/entities/palace/api'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { EmptyState, ErrorState } from '@/shared/components/state-placeholders'
import { PalaceShelfSkeleton } from './components/PalaceShelfSkeleton'
import { usePalaceListCardActions } from '@/features/palace-catalog/components/palace-list/usePalaceListCardActions'
import { useLocalStorageState } from '@/shared/lib/localStorage'
import { onAppEvent } from '@/shared/events/appEvents'
import { cn } from '@/shared/lib/utils'
import {
  buildPalaceCatalogQuery,
  createEmptyPalaceGroupedListResponse,
  flattenGroupedPalaces,
} from '@/features/palace-catalog/model/palaceCatalog'

const shelfLayoutOptions: Array<{ value: PalaceShelfLayoutMode; label: string; icon: typeof List }> = [
  { value: 'single', label: '单列', icon: List },
  { value: 'double', label: '双列', icon: Rows3 },
  { value: 'grid', label: '多列网格', icon: LayoutGrid },
]

const expandedLayoutOptions: Array<{ value: PalaceListLayoutMode; label: string; icon: typeof List }> = [
  { value: 'chapter-single', label: '单列章节流', icon: List },
  { value: 'chapter-double', label: '章节内双列', icon: Rows3 },
  { value: 'chapter-card-grid', label: '章节知识点双列', icon: LayoutGrid },
  { value: 'flow', label: '知识点流', icon: WrapText },
]

const shelfDensityOptions: Array<{ value: PalaceShelfDensityMode; label: string }> = [
  { value: 'comfortable', label: '舒展' },
  { value: 'standard', label: '标准' },
  { value: 'compact', label: '紧凑' },
]

function statusBadge(item: PalaceSubjectShelfItem) {
  if ((item.due_now_count ?? 0) > 0) {
    return <span className="inline-block h-3 w-3 rounded-full bg-destructive" title="当前可立即复习" />
  }
  if ((item.due_later_today_count ?? 0) > 0) {
    return <span className="inline-block h-3 w-3 rounded-full bg-warning" title="今天稍后可复习" />
  }

  return null
}

function getShelfGridClass(layoutMode: PalaceShelfLayoutMode) {
  if (layoutMode === 'single') return 'grid-cols-1'
  if (layoutMode === 'grid') return 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'
  return 'grid-cols-1 lg:grid-cols-2'
}

function getShelfCardContentClass(densityMode: PalaceShelfDensityMode) {
  if (densityMode === 'comfortable') return 'min-h-[248px] p-7 pl-11'
  if (densityMode === 'compact') return 'min-h-[188px] p-4 pl-8'
  return 'min-h-[220px] p-6 pl-10'
}

function getShelfMetaSpacingClass(densityMode: PalaceShelfDensityMode) {
  if (densityMode === 'comfortable') return 'space-y-5'
  if (densityMode === 'compact') return 'space-y-3'
  return 'space-y-4'
}

function getShelfStatCardClass(densityMode: PalaceShelfDensityMode) {
  if (densityMode === 'comfortable') return 'px-4 py-4'
  if (densityMode === 'compact') return 'px-3 py-2'
  return 'px-4 py-3'
}

function getShelfTitleClass(densityMode: PalaceShelfDensityMode) {
  if (densityMode === 'comfortable') return 'text-xl'
  if (densityMode === 'compact') return 'text-base'
  return 'text-lg'
}

function renderShelfStatusSummary(item: PalaceSubjectShelfItem) {
  const entries = [
    { label: '立即复习', count: item.due_now_count ?? 0, color: 'text-destructive' },
    { label: '今日稍后', count: item.due_later_today_count ?? 0, color: 'text-warning' },
  ]
  const hasAny = entries.some((entry) => entry.count > 0)

  if (!hasAny) {
    return <span className="text-muted-foreground">当前没有紧急复习</span>
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {entries.map((entry) => (
        <span key={entry.label} className="inline-flex items-center gap-1 text-xs">
          <span className={cn('font-semibold', entry.color)}>{entry.count}</span>
          <span className="text-muted-foreground">{entry.label}</span>
        </span>
      ))}
    </div>
  )
}

export default function PalaceShelfPage({ prefetchReviewSession }: { prefetchReviewSession?: (reviewId: number) => void }) {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get('search') || ''
  const [items, setItems] = useState<PalaceSubjectShelfItem[]>([])
  const [groupedData, setGroupedData] = useState<PalaceGroupedListResponse | null>(null)
  const [groupedDataSearch, setGroupedDataSearch] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [collapsedChapters, setCollapsedChapters] = useState<Set<number>>(new Set())
  const [viewSettings, setViewSettings] = useLocalStorageState<PalaceShelfViewSettings>(
    PALACE_SHELF_VIEW_SETTINGS_KEY,
    DEFAULT_PALACE_SHELF_VIEW_SETTINGS,
    isPalaceShelfViewSettings,
    'palace_shelf_view_settings',
  )
  const isExpandedMode = viewSettings.displayMode === 'expanded'

  const fetchShelfData = useCallback(async () => {
    setLoadError(null)
    const params = buildPalaceCatalogQuery({ search, selectedSubjectId: null })
    const shelfResponse = await getPalaceSubjectShelfApi(params)
    setItems(shelfResponse.items || [])
  }, [search])

  const fetchGroupedData = useCallback(async () => {
    setLoadError(null)
    const params = buildPalaceCatalogQuery({ search, selectedSubjectId: null })
    const groupedResponse = await getPalacesGroupedApi(params)
    setGroupedData(groupedResponse)
    setGroupedDataSearch(search)
    return groupedResponse
  }, [search])

  useEffect(() => {
    void fetchShelfData().catch((error) => {
      setLoadError(error instanceof Error ? error.message : '加载学科书架失败。')
    })
  }, [fetchShelfData])

  useEffect(() => {
    if (!isExpandedMode) return
    if (groupedDataSearch === search && groupedData) return
    void fetchGroupedData().catch((error) => {
      setLoadError(error instanceof Error ? error.message : '加载宫殿列表失败。')
    })
  }, [fetchGroupedData, groupedData, groupedDataSearch, isExpandedMode, search])

  const fetchData = useCallback(async () => {
    setLoadError(null)
    try {
      await fetchShelfData()
      if (isExpandedMode) {
        return fetchGroupedData()
      }
      return groupedData
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '加载学科书架失败。')
      throw error
    }
  }, [fetchGroupedData, fetchShelfData, groupedData, isExpandedMode])

  useEffect(() => {
    return onAppEvent(PALACE_CATALOG_INVALIDATED_EVENT, () => {
      void fetchData().catch(() => undefined)
    })
  }, [fetchData])

  const categorizedCount = useMemo(() => items.filter((item) => item.subject).length, [items])
  const allPalaces = useMemo(
    () => flattenGroupedPalaces(groupedData ?? createEmptyPalaceGroupedListResponse()),
    [groupedData],
  )
  const hasExpandedPalaces = allPalaces.length > 0
  const expandedViewSettings: PalaceListViewSettings = useMemo(
    () => ({
      layoutMode: viewSettings.expandedLayoutMode,
      densityMode: viewSettings.densityMode,
    }),
    [viewSettings.densityMode, viewSettings.expandedLayoutMode],
  )
  const cardActions = usePalaceListCardActions({
    allPalaces,
    fetchData,
    navigate,
    prefetchReviewSession,
  })
  const renderExpandedPalaceCard = useCallback(
    (palace: PalaceGroupedItem) => (
      <PalaceListCard
        key={palace.id}
        palace={palace}
        viewSettings={expandedViewSettings}
        defaultExpanded
        onPalacePractice={cardActions.onPalacePractice}
        onWarmPalacePractice={cardActions.onWarmPalacePractice}
        onSegmentPractice={cardActions.onSegmentPractice}
        onWarmSegmentPractice={cardActions.onWarmSegmentPractice}
        onDelete={cardActions.onDelete}
      />
    ),
    [cardActions, expandedViewSettings],
  )

  return (
    <div className="space-y-8">
      <PageIntro
        title="学科书架"
        description="一个学科就是一本书，点击进入后继续查看你熟悉的章节和宫殿列表。"
        actions={
          <Link to="/palaces/new">
            <Button size="sm">
              <Plus className="size-4" />
              新建宫殿
            </Button>
          </Link>
        }
      />

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[180px] flex-1">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="搜索学科或宫殿..."
                  value={search}
                  onChange={(event) =>
                    setSearchParams((params) => {
                      if (event.target.value) params.set('search', event.target.value)
                      else params.delete('search')
                      return params
                    })
                  }
                  className="pl-9"
                />
              </div>
            </div>
            <div
              className="flex flex-wrap items-center gap-2"
              data-testid="shelf-view-toolbar"
              data-display-mode={viewSettings.displayMode}
            >
              <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border/70 bg-background/80 p-1">
                <Button
                  type="button"
                  variant={viewSettings.displayMode === 'shelf' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="min-h-11 sm:h-8 sm:min-h-8"
                  onClick={() => setViewSettings((current) => ({ ...current, displayMode: 'shelf' }))}
                >
                  收纳
                </Button>
                <Button
                  type="button"
                  variant={viewSettings.displayMode === 'expanded' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="min-h-11 sm:h-8 sm:min-h-8"
                  onClick={() => setViewSettings((current) => ({ ...current, displayMode: 'expanded' }))}
                >
                  展开
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border/70 bg-background/80 p-1">
                {(viewSettings.displayMode === 'expanded' ? expandedLayoutOptions : shelfLayoutOptions).map((option) => {
                  const Icon = option.icon
                  const isActive =
                    viewSettings.displayMode === 'expanded'
                      ? viewSettings.expandedLayoutMode === option.value
                      : viewSettings.layoutMode === option.value
                  return (
                    <Button
                      key={option.value}
                      type="button"
                      variant={isActive ? 'secondary' : 'ghost'}
                      size="sm"
                      className="min-h-11 sm:h-8 sm:min-h-8"
                      onClick={() =>
                        setViewSettings((current) =>
                          current.displayMode === 'expanded'
                            ? { ...current, expandedLayoutMode: option.value as PalaceListLayoutMode }
                            : { ...current, layoutMode: option.value as PalaceShelfLayoutMode },
                        )
                      }
                    >
                      <Icon className="size-4" />
                      {option.label}
                    </Button>
                  )
                })}
              </div>
              <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border/70 bg-background/80 p-1">
                {shelfDensityOptions.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    variant={viewSettings.densityMode === option.value ? 'secondary' : 'ghost'}
                    size="sm"
                    className="min-h-11 sm:h-8 sm:min-h-8"
                    onClick={() => setViewSettings((current) => ({ ...current, densityMode: option.value }))}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setViewSettings(DEFAULT_PALACE_SHELF_VIEW_SETTINGS)}
              >
                恢复默认
              </Button>
            </div>
            {search ? (
              <Button variant="ghost" size="sm" onClick={() => setSearchParams({})}>
                清除搜索
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Badge variant="secondary">{categorizedCount} 个学科书架</Badge>
        <Badge variant="outline">{items.find((item) => item.subject == null) ? '含未分类' : '全部已分类'}</Badge>
      </div>

      {loadError ? (
        <ErrorState
          title="学科书架加载失败"
          description={loadError}
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => void fetchData().catch(() => undefined)}>
              重新加载
            </Button>
          }
        />
      ) : viewSettings.displayMode === 'expanded' ? (
        groupedData ? (
          <PalaceListSections
            groupedData={groupedData}
            hasPalaces={hasExpandedPalaces}
            viewSettings={expandedViewSettings}
            collapsedChapters={collapsedChapters}
            onToggleChapter={(chapterId) =>
              setCollapsedChapters((current) => {
                const next = new Set(current)
                if (next.has(chapterId)) next.delete(chapterId)
                else next.add(chapterId)
                return next
              })
            }
            renderPalaceCard={renderExpandedPalaceCard}
            emptyTitle={search ? '没有匹配的宫殿' : '还没有可展开的宫殿'}
            emptyDescription={
              search
                ? '试试缩短关键词，或清除搜索查看全部学科书架。'
                : '创建第一个记忆宫殿后，这里会按学科和章节展开显示。'
            }
            emptyActionLabel="创建宫殿"
          />
        ) : (
          <PalaceShelfSkeleton />
        )
      ) : items.length > 0 ? (
        <div
          className={cn('grid gap-5', getShelfGridClass(viewSettings.layoutMode))}
          data-testid="shelf-grid"
          data-layout-mode={viewSettings.layoutMode}
          data-density-mode={viewSettings.densityMode}
        >
          {items.map((item, index) => {
            const isUncategorized = item.subject == null
            const title = item.subject?.name || '未分类'
            const color = item.subject?.color || '#94a3b8'
            return (
              <button
                key={item.subject?.id ?? `uncategorized-${index}`}
                type="button"
                onClick={() =>
                  navigate(
                    isUncategorized ? '/palaces/list?uncategorized=true' : `/palaces/list?subjectId=${item.subject?.id}`,
                  )
                }
                className="text-left"
              >
                <Card className="group relative h-full overflow-hidden border-border/70 bg-card/90 transition-all hover:-translate-y-1 hover:shadow-xl">
                  <div
                    className="absolute inset-y-0 left-0 w-5 rounded-l-xl opacity-90"
                    style={{ backgroundColor: color }}
                  />
                  <CardContent className={cn('relative flex h-full flex-col justify-between', getShelfCardContentClass(viewSettings.densityMode))}>
                    <div className={getShelfMetaSpacingClass(viewSettings.densityMode)}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div
                            className="flex size-11 items-center justify-center rounded-lg text-white shadow-sm"
                            style={{ backgroundColor: color }}
                          >
                            {isUncategorized ? <LibraryBig className="size-5" /> : <BookOpen className="size-5" />}
                          </div>
                          <div>
                            <div className={cn('font-semibold text-foreground', getShelfTitleClass(viewSettings.densityMode))}>{title}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {isUncategorized ? '尚未归入学科的宫殿' : '点击进入学科详情'}
                            </div>
                          </div>
                        </div>
                        {statusBadge(item)}
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className={cn('rounded-lg border border-border/70 bg-background/70', getShelfStatCardClass(viewSettings.densityMode))}>
                          <div className="text-xs text-muted-foreground">宫殿数量</div>
                          <div className="mt-1 text-xl font-semibold">{item.palace_count}</div>
                        </div>
                        <div className={cn('rounded-lg border border-border/70 bg-background/70', getShelfStatCardClass(viewSettings.densityMode))}>
                          <div className="text-xs text-muted-foreground">章节数量</div>
                          <div className="mt-1 text-xl font-semibold">{item.chapter_count}</div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-6 flex items-center justify-between gap-3 text-sm">
                      {renderShelfStatusSummary(item)}
                      <span className="inline-flex items-center font-medium text-foreground">
                        打开
                        <ChevronRight className="ml-1 size-4 transition-transform group-hover:translate-x-1" />
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </button>
            )
          })}
        </div>
      ) : (
        <Card>
          <CardContent>
            <EmptyState
              variant="create"
              title="还没有学科书架"
              description="先创建一个记忆宫殿；绑定章节后，它会自动出现在对应学科书架里。"
              action={
                <Link to="/palaces/new">
                  <Button variant="outline" size="sm">
                    <Plus className="mr-2 size-4" />
                    创建第一个宫殿
                  </Button>
                </Link>
              }
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
