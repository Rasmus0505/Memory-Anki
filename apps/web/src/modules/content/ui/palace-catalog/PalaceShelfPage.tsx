import { ExamStarPicker, useExamOverview } from '@/modules/exam/public'
import { BookOpen, ChevronRight, FolderTree, LayoutGrid, LibraryBig, List, Plus, RotateCcw, Rows3, Search, WrapText, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useRouteResidency } from '@/shared/routing/RouteResidency'
import { PageHeader } from '@/shared/components/layout/PageHeader'
import { PageContainer } from '@/shared/components/layout/PageLayout'
import { PalaceListCard } from '@/modules/content/ui/palace-catalog/components/palace-list/PalaceListCard'
import {
  DEFAULT_PALACE_SHELF_VIEW_SETTINGS,
  PALACE_SHELF_VIEW_SETTINGS_KEY,
  type PalaceListLayoutMode,
  type PalaceListViewSettings,
  type PalaceShelfDensityMode,
  type PalaceShelfLayoutMode,
  type PalaceShelfViewSettings,
  isPalaceShelfViewSettings,
} from '@/modules/settings/public'
import { PalaceListSections } from '@/modules/content/ui/palace-catalog/components/palace-list/PalaceListSections'
import type { PalaceGroupedItem, PalaceGroupedListResponse, PalaceSubjectShelfItem } from '@/shared/api/contracts'
import {
  getPalacesGroupedApi,
  getPalaceSubjectShelfApi,
  PALACE_CATALOG_INVALIDATED_EVENT,
} from '@/modules/content/domain/palace-entity/api'
import { isStudyTextLibraryPending, peekGroupedPalaces, peekSubjectShelf } from '@/shared/study-text/studyTextLibrary'
import { ToggleGroup, ToggleGroupItem } from '@/shared/components/ui/toggle-group'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { EmptyState, ErrorState } from '@/shared/components/state-placeholders'
import { PalaceViewSheet } from './components/palace-list/PalaceViewSheet'
import { PalaceShelfSkeleton } from './components/PalaceShelfSkeleton'
import { usePalaceListCardActions } from '@/modules/content/ui/palace-catalog/components/palace-list/usePalaceListCardActions'
import { useLocalStorageState } from '@/shared/lib/localStorage'
import { onAppEvent } from '@/shared/events/appEvents'
import { cn } from '@/shared/lib/utils'
import { SubjectMemoryLadder } from '@/modules/practice/public'
import {
  buildPalaceCatalogQuery,
  createEmptyPalaceGroupedListResponse,
  flattenGroupedPalaces,
} from '@/modules/content/ui/palace-catalog/model/palaceCatalog'

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
    return <span className="mt-1 inline-block size-2 shrink-0 rounded-full bg-destructive" title="当前可立即复习" />
  }
  if ((item.due_later_today_count ?? 0) > 0) {
    return <span className="mt-1 inline-block size-2 shrink-0 rounded-full bg-warning" title="今天稍后可复习" />
  }

  return null
}

function getShelfGridClass(layoutMode: PalaceShelfLayoutMode) {
  if (layoutMode === 'single') return 'grid-cols-1'
  if (layoutMode === 'grid') return 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'
  return 'grid-cols-1 lg:grid-cols-2'
}

function getShelfCardContentClass(densityMode: PalaceShelfDensityMode) {
  if (densityMode === 'comfortable') return 'p-6 pl-8'
  if (densityMode === 'compact') return 'p-3.5 pl-5'
  return 'p-5 pl-7'
}

function getShelfMetaSpacingClass(densityMode: PalaceShelfDensityMode) {
  if (densityMode === 'comfortable') return 'space-y-5'
  if (densityMode === 'compact') return 'space-y-3'
  return 'space-y-4'
}

function getShelfTitleClass(densityMode: PalaceShelfDensityMode) {
  if (densityMode === 'comfortable') return 'text-lg'
  if (densityMode === 'compact') return 'text-[15px]'
  return 'text-base'
}

function renderShelfStatusSummary(item: PalaceSubjectShelfItem) {
  const entries = [
    { label: '立即复习', count: item.due_now_count ?? 0, color: 'text-destructive' },
    { label: '今日稍后', count: item.due_later_today_count ?? 0, color: 'text-warning' },
  ]
  const hasAny = entries.some((entry) => entry.count > 0)

  if (!hasAny) {
    return <span className="text-xs text-muted-foreground">没有到期的复习</span>
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

type ShelfViewSetter = (
  updater: PalaceShelfViewSettings | ((current: PalaceShelfViewSettings) => PalaceShelfViewSettings),
) => void

function shelfViewSummary(settings: PalaceShelfViewSettings) {
  const display = settings.displayMode === 'expanded' ? '目录' : '封面'
  const layoutMode = settings.displayMode === 'expanded'
    ? settings.expandedLayoutMode
    : settings.layoutMode
  const layoutLabel = (settings.displayMode === 'expanded' ? expandedLayoutOptions : shelfLayoutOptions)
    .find((option) => option.value === layoutMode)?.label ?? ''
  const densityLabel = shelfDensityOptions.find((option) => option.value === settings.densityMode)?.label ?? ''
  return [display, layoutLabel, densityLabel].filter(Boolean).join(' · ')
}

function ShelfViewSheet({ settings, onChange }: {
  settings: PalaceShelfViewSettings
  onChange: ShelfViewSetter
}) {
  const isExpanded = settings.displayMode === 'expanded'
  const layoutOptions = isExpanded ? expandedLayoutOptions : shelfLayoutOptions
  const layoutMode = isExpanded ? settings.expandedLayoutMode : settings.layoutMode
  return (
    <PalaceViewSheet
      title="书架视图"
      summary={shelfViewSummary(settings)}
      triggerTestId="shelf-view-sheet-trigger"
      display={{
        label: '显示',
        options: [
          { value: 'shelf', label: '书架封面' },
          { value: 'expanded', label: '章节目录' },
        ],
        value: settings.displayMode,
        onChange: (value) =>
          onChange((current) => ({ ...current, displayMode: value as PalaceShelfViewSettings['displayMode'] })),
      }}
      layout={{
        label: '布局',
        options: layoutOptions,
        value: layoutMode,
        onChange: (value) =>
          onChange((current) =>
            current.displayMode === 'expanded'
              ? { ...current, expandedLayoutMode: value as PalaceListLayoutMode }
              : { ...current, layoutMode: value as PalaceShelfLayoutMode },
          ),
      }}
      density={{
        label: '密度',
        options: shelfDensityOptions,
        value: settings.densityMode,
        onChange: (value) =>
          onChange((current) => ({ ...current, densityMode: value as PalaceShelfDensityMode })),
      }}
      onReset={() => onChange(DEFAULT_PALACE_SHELF_VIEW_SETTINGS)}
    />
  )
}

export default function PalaceShelfPage() {
  const navigate = useNavigate()
  const { isActive, becameActiveAt } = useRouteResidency()
  const seenActiveAtRef = useRef<number | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get('search') || ''
  const [items, setItems] = useState<PalaceSubjectShelfItem[]>(() => (
    search ? [] : peekSubjectShelf()?.items ?? []
  ))
  const [groupedData, setGroupedData] = useState<PalaceGroupedListResponse | null>(() => (
    search ? null : peekGroupedPalaces()
  ))
  const [groupedDataSearch, setGroupedDataSearch] = useState<string | null>(() => (
    search || !peekGroupedPalaces() ? null : search
  ))
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

  useEffect(() => {
    if (!isActive) return
    if (seenActiveAtRef.current === becameActiveAt) return
    const isFirstActivation = seenActiveAtRef.current == null
    seenActiveAtRef.current = becameActiveAt
    if (isFirstActivation) return
    void fetchData().catch(() => undefined)
  }, [becameActiveAt, fetchData, isActive])

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
    fetchData,
    navigate,
  })
  const { data: examOverview, reload: reloadExam } = useExamOverview()
  const examStarsById = useMemo(
    () => new Map((examOverview?.palaces ?? []).map((row) => [row.id, row])),
    [examOverview],
  )
  const renderExpandedPalaceCard = useCallback(
    (palace: PalaceGroupedItem, parentQuestionTotal?: number | null) => {
      const exam = examStarsById.get(palace.id)
      return (
        <div key={palace.id} className={`relative rounded-xl ${exam?.stars === 3 ? 'exam-key-card' : ''}`}>
          <PalaceListCard
            palace={palace}
            chapterQuestionTotal={parentQuestionTotal}
            viewSettings={expandedViewSettings}
            defaultExpanded
            onPalaceReview={cardActions.onPalaceReview}
            onDelete={cardActions.onDelete}
          />
          {exam ? (
            <div className="absolute bottom-2 right-3 z-10 rounded-full bg-card/90 px-1.5 shadow-sm backdrop-blur" title={examOverview?.star_rule.description}>
              <ExamStarPicker
                kind="palace"
                entityId={palace.id}
                stars={exam.stars}
                source={exam.stars_source}
                ownStars={exam.own_stars}
                onSaved={() => void reloadExam()}
              />
            </div>
          ) : null}
        </div>
      )
    },
    [cardActions, examOverview?.star_rule.description, examStarsById, expandedViewSettings, reloadExam],
  )

  return (
    <PageContainer wide>
      <PageHeader
        title="学科书架"
        hideDescriptionOnMobile
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/knowledge">
              <Button size="sm" variant="outline">
                <FolderTree className="size-4" />
                知识树编辑
              </Button>
            </Link>
            <Link to="/palaces/new">
              <Button size="sm">
                <Plus className="size-4" />
                新建宫殿
              </Button>
            </Link>
          </div>
        }
      />

      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
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
            className="pl-9 pr-9"
          />
          {search ? (
            <button
              type="button"
              aria-label="清除搜索"
              title="清除搜索"
              onClick={() => setSearchParams({})}
              className="absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        <ShelfViewSheet settings={viewSettings} onChange={setViewSettings} />
        {/* Desktop: covers/contents, layout icons, density, reset — one row of segments. */}
        <div
          className="ml-auto hidden items-center gap-2 sm:flex"
          data-testid="shelf-view-toolbar"
          data-display-mode={viewSettings.displayMode}
        >
          <ToggleGroup
            type="single"
            value={viewSettings.displayMode}
            onValueChange={(value) => {
              if (value) setViewSettings((current) => ({ ...current, displayMode: value as PalaceShelfViewSettings['displayMode'] }))
            }}
            aria-label="书架显示模式"
          >
            <ToggleGroupItem value="shelf" data-testid="shelf-mode-covers" aria-label="书架封面" className="text-xs">
              封面
            </ToggleGroupItem>
            <ToggleGroupItem value="expanded" data-testid="shelf-mode-expanded" aria-label="章节目录" className="text-xs">
              目录
            </ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            type="single"
            value={viewSettings.displayMode === 'expanded' ? viewSettings.expandedLayoutMode : viewSettings.layoutMode}
            onValueChange={(value) => {
              if (!value) return
              setViewSettings((current) =>
                current.displayMode === 'expanded'
                  ? { ...current, expandedLayoutMode: value as PalaceListLayoutMode }
                  : { ...current, layoutMode: value as PalaceShelfLayoutMode },
              )
            }}
            aria-label="布局"
          >
            {(viewSettings.displayMode === 'expanded' ? expandedLayoutOptions : shelfLayoutOptions).map((option) => {
              const Icon = option.icon
              return (
                <ToggleGroupItem key={option.value} value={option.value} aria-label={option.label} title={option.label} className="px-2">
                  <Icon className="size-4" />
                </ToggleGroupItem>
              )
            })}
          </ToggleGroup>
          <ToggleGroup
            type="single"
            value={viewSettings.densityMode}
            onValueChange={(value) => {
              if (value) setViewSettings((current) => ({ ...current, densityMode: value as PalaceShelfDensityMode }))
            }}
            aria-label="密度"
          >
            {shelfDensityOptions.map((option) => (
              <ToggleGroupItem key={option.value} value={option.value} className="text-xs">
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="恢复默认"
            title="恢复默认视图"
            className="text-muted-foreground"
            onClick={() => setViewSettings(DEFAULT_PALACE_SHELF_VIEW_SETTINGS)}
          >
            <RotateCcw />
          </Button>
        </div>
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
          className={cn('ma-stagger grid gap-4', getShelfGridClass(viewSettings.layoutMode))}
          data-testid="shelf-grid"
          data-layout-mode={viewSettings.layoutMode}
          data-density-mode={viewSettings.densityMode}
        >
          {items.map((item, index) => {
            const isUncategorized = item.subject == null
            const title = item.subject?.name || '未分类'
            const color = item.subject?.color || 'var(--color-ink-faint)'
            return (
              <button
                key={item.subject?.id ?? `uncategorized-${index}`}
                type="button"
                onClick={() =>
                  navigate(
                    isUncategorized ? '/palaces/list?uncategorized=true' : `/palaces/list?subjectId=${item.subject?.id}`,
                  )
                }
                className="group rounded-xl text-left"
                data-testid="subject-book-card"
              >
                <Card className="group relative h-full overflow-hidden border-border/80 shadow-soft transition-[box-shadow,border-color,translate] duration-200 group-hover:-translate-y-0.5 group-hover:border-foreground/15 group-hover:shadow-lift">
                  {/* Book spine in the subject colour */}
                  <div
                    className="absolute inset-y-0 left-0 w-1.5"
                    style={{ background: color }}
                    aria-hidden
                  />
                  <CardContent className={cn('relative flex h-full flex-col justify-between', getShelfCardContentClass(viewSettings.densityMode))}>
                    <div className={getShelfMetaSpacingClass(viewSettings.densityMode)}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <div
                            className="flex size-10 shrink-0 items-center justify-center rounded-lg"
                            style={{
                              background: `color-mix(in srgb, ${color} 14%, transparent)`,
                              color,
                            }}
                            aria-hidden
                          >
                            {isUncategorized ? <LibraryBig className="size-5" /> : <BookOpen className="size-5" />}
                          </div>
                          <div className="min-w-0">
                            <div className={cn('truncate font-semibold tracking-tight text-foreground', getShelfTitleClass(viewSettings.densityMode))}>{title}</div>
                            <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                              {item.palace_count} 座宫殿 · {item.chapter_count} 个章节
                            </div>
                          </div>
                        </div>
                        {statusBadge(item)}
                      </div>
                      <SubjectMemoryLadder
                        subjectKey={item.subject?.id ?? 'unassigned'}
                        variant="thumb"
                      />
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/60 pt-3 text-sm">
                      {renderShelfStatusSummary(item)}
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden />
                    </div>
                  </CardContent>
                </Card>
              </button>
            )
          })}
        </div>
      ) : isStudyTextLibraryPending() ? (
        <PalaceShelfSkeleton />
      ) : (
        <Card>
          <CardContent>
            <EmptyState
              variant="create"
              title="还没有学科书架"
              description="绑定章节后，宫殿会出现在对应书架里。"
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
    </PageContainer>
  )
}
