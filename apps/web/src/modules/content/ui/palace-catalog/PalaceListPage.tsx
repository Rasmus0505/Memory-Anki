import { ChevronLeft, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useRouteResidency } from '@/shared/routing/RouteResidency'
import {
  PalaceListCard,
} from '@/modules/content/ui/palace-catalog/components/palace-list/PalaceListCard'
import {
  PalaceListSections,
} from '@/modules/content/ui/palace-catalog/components/palace-list/PalaceListSections'
import {
  PalaceListToolbar,
} from '@/modules/content/ui/palace-catalog/components/palace-list/PalaceListToolbar'
import {
  PALACE_SHELF_VIEW_SETTINGS_KEY,
  DEFAULT_PALACE_SHELF_VIEW_SETTINGS,
  type PalaceListViewSettings,
  type PalaceShelfViewSettings,
  isPalaceShelfViewSettings,
} from '@/modules/settings/public'
import type {
  PalaceGroupedItem,
} from '@/shared/api/contracts'
import {
  getPalacesGroupedApi,
  PALACE_CATALOG_INVALIDATED_EVENT,
} from '@/modules/content/domain/palace-entity/api'
import { Button } from '@/shared/components/ui/button'
import { PageHeader } from '@/shared/components/layout/PageHeader'
import { PageContainer } from '@/shared/components/layout/PageLayout'
import {
  SubjectMemoryLadder,
  stageLabel,
  useSubjectMemoryLadder,
  type SubjectMemoryLadderKey,
} from '@/modules/practice/public'
import { ErrorState } from '@/shared/components/state-placeholders'
import { useLocalStorageState } from '@/shared/lib/localStorage'
import { onAppEvent } from '@/shared/events/appEvents'
import { PalaceListSkeleton } from './components/PalaceListSkeleton'
import { usePalaceListCardActions } from '@/modules/content/ui/palace-catalog/components/palace-list/usePalaceListCardActions'
import {
  PALACE_CATALOG_GROUPED_QUERY_KEY,
  buildPalaceCatalogGroupedQueryKey,
  buildPalaceCatalogQuery,
  createEmptyPalaceGroupedListResponse,
  filterGroupedPalacesByPalaceIds,
  filterGroupedPalacesBySearch,
  filterGroupedPalacesByScope,
  flattenGroupedPalaces,
  getPalaceCatalogScopeTitle,
} from '@/modules/content/ui/palace-catalog/model/palaceCatalog'

export default function PalaceList() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { isActive, becameActiveAt } = useRouteResidency()
  const seenActiveAtRef = useRef<number | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get('search') || ''
  const selectedSubjectId = searchParams.get('subjectId')
  const showUncategorizedOnly = searchParams.get('uncategorized') === 'true'
  const [collapsedChapters, setCollapsedChapters] = useState<Set<number>>(new Set())
  // 书内宫殿卡片和书架「章节目录」共用同一份布局/密度，避免进书后换成另一套前端。
  const [shelfViewSettings, setShelfViewSettings] = useLocalStorageState<PalaceShelfViewSettings>(
    PALACE_SHELF_VIEW_SETTINGS_KEY,
    DEFAULT_PALACE_SHELF_VIEW_SETTINGS,
    isPalaceShelfViewSettings,
    'palace_shelf_view_settings',
  )
  const viewSettings = useMemo<PalaceListViewSettings>(
    () => ({
      layoutMode: shelfViewSettings.expandedLayoutMode,
      densityMode: shelfViewSettings.densityMode,
    }),
    [shelfViewSettings.densityMode, shelfViewSettings.expandedLayoutMode],
  )
  const setViewSettings = useCallback(
    (updater: PalaceListViewSettings | ((current: PalaceListViewSettings) => PalaceListViewSettings)) => {
      setShelfViewSettings((current) => {
        const listCurrent: PalaceListViewSettings = {
          layoutMode: current.expandedLayoutMode,
          densityMode: current.densityMode,
        }
        const next = typeof updater === 'function' ? updater(listCurrent) : updater
        return {
          ...current,
          expandedLayoutMode: next.layoutMode,
          densityMode: next.densityMode,
        }
      })
    },
    [setShelfViewSettings],
  )
  const catalogScope = useMemo(
    () => ({ selectedSubjectId, showUncategorizedOnly }),
    [selectedSubjectId, showUncategorizedOnly],
  )
  const catalogQueryParams = useMemo(
    () => buildPalaceCatalogQuery({ search: '', selectedSubjectId }),
    [selectedSubjectId],
  )
  const subjectKey = useMemo<SubjectMemoryLadderKey | null>(() => {
    if (showUncategorizedOnly) return 'unassigned'
    if (!selectedSubjectId) return null
    if (!/^\d+$/.test(selectedSubjectId)) return 'unassigned'
    const subjectId = Number(selectedSubjectId)
    return Number.isSafeInteger(subjectId) && subjectId > 0 ? subjectId : null
  }, [selectedSubjectId, showUncategorizedOnly])
  const memoryLadder = useSubjectMemoryLadder(subjectKey)
  // 间隔段筛选是这本书内的临时视图，换学科时自动回到“全部”。
  const [stageFilter, setStageFilter] = useState<number | null>(null)
  useEffect(() => {
    setStageFilter(null)
  }, [subjectKey])
  const activeStage = stageFilter == null
    ? null
    : memoryLadder.stages.find((item) => item.stage_index === stageFilter) ?? null
  const stagePalaceIds = useMemo(
    () => (activeStage ? new Set(activeStage.palaces.map((palace) => palace.palace_id)) : null),
    [activeStage],
  )

  const palaceCatalogQuery = useQuery({
    queryKey: buildPalaceCatalogGroupedQueryKey(catalogQueryParams),
    queryFn: () => getPalacesGroupedApi(catalogQueryParams),
    select: (data) => {
      const scopedData = filterGroupedPalacesByScope(data, catalogScope)
      return filterGroupedPalacesBySearch(scopedData, search)
    },
  })

  const groupedData = palaceCatalogQuery.data ?? createEmptyPalaceGroupedListResponse()
  const loadError = palaceCatalogQuery.error
    ? palaceCatalogQuery.error instanceof Error
      ? palaceCatalogQuery.error.message
      : '加载记忆宫殿失败。'
    : null
  const hasLoaded = palaceCatalogQuery.data !== undefined
  const isInitialLoading = palaceCatalogQuery.isPending && !hasLoaded

  const fetchData = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: PALACE_CATALOG_GROUPED_QUERY_KEY,
      refetchType: 'none',
    })
    const result = await palaceCatalogQuery.refetch()
    if (result.error) throw result.error
    return result.data ?? createEmptyPalaceGroupedListResponse()
  }, [palaceCatalogQuery, queryClient])

  const visibleGroupedData = useMemo(
    () => (stagePalaceIds ? filterGroupedPalacesByPalaceIds(groupedData, stagePalaceIds) : groupedData),
    [groupedData, stagePalaceIds],
  )
  const allPalaces = useMemo(() => flattenGroupedPalaces(visibleGroupedData), [visibleGroupedData])

  const currentSubjectTitle = useMemo(() => {
    return getPalaceCatalogScopeTitle(groupedData, {
      selectedSubjectId,
      showUncategorizedOnly,
    })
  }, [groupedData, selectedSubjectId, showUncategorizedOnly])

  useEffect(() => {
    return onAppEvent(PALACE_CATALOG_INVALIDATED_EVENT, () => {
      void queryClient.invalidateQueries({ queryKey: PALACE_CATALOG_GROUPED_QUERY_KEY })
    })
  }, [queryClient])

  useEffect(() => {
    if (!isActive) return
    if (seenActiveAtRef.current === becameActiveAt) return
    const isFirstActivation = seenActiveAtRef.current == null
    seenActiveAtRef.current = becameActiveAt
    if (isFirstActivation) return
    void queryClient.invalidateQueries({ queryKey: PALACE_CATALOG_GROUPED_QUERY_KEY })
  }, [becameActiveAt, isActive, queryClient])

  const cardActions = usePalaceListCardActions({
    fetchData,
    navigate,
    subjectId: selectedSubjectId,
  })

  const renderPalaceCard = useCallback(
    (palace: PalaceGroupedItem, parentQuestionTotal?: number | null) => (
      <PalaceListCard
        key={palace.id}
        palace={palace}
        chapterQuestionTotal={parentQuestionTotal}
        viewSettings={viewSettings}
        searchQuery={search}
        defaultExpanded
        onPalaceReview={cardActions.onPalaceReview}
        onDelete={cardActions.onDelete}
      />
    ),
    [cardActions, search, viewSettings],
  )

  if (isInitialLoading) {
    return <PalaceListSkeleton />
  }

  if (loadError && !hasLoaded) {
    return (
      <ErrorState
        title="记忆宫殿加载失败"
        description={loadError}
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => void fetchData().catch(() => undefined)}>
            重新加载
          </Button>
        }
      />
    )
  }

  return (
    <PageContainer wide className="gap-8">
      <PageHeader
        title={currentSubjectTitle ? `${currentSubjectTitle}` : '记忆宫殿'}
        description={
          currentSubjectTitle
            ? '本书内的宫殿按章节排列；返回书架可切换中国教育史、外国教育史、英语等学科。'
            : '浏览全部宫殿，或从学科书架进入某一本书。'
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {selectedSubjectId || showUncategorizedOnly ? (
              <Link to="/palaces">
                <Button size="sm" variant="outline">
                  <ChevronLeft className="size-4" />
                  返回书架
                </Button>
              </Link>
            ) : null}
            <Link to="/palaces/new">
              <Button size="sm">
                <Plus className="size-4" />
                新建宫殿
              </Button>
            </Link>
          </div>
        }
        compact
      />

      {subjectKey != null && (
        <SubjectMemoryLadder
          subjectKey={subjectKey}
          variant="full"
          selectedStageIndex={stageFilter}
          onStageSelect={setStageFilter}
        />
      )}

      <PalaceListToolbar
        search={search}
        viewSettings={viewSettings}
        onSearchChange={(value) =>
          setSearchParams((params) => {
            if (value) params.set('search', value)
            else params.delete('search')
            return params
          })
        }
        onClearSearch={() =>
          setSearchParams((params) => {
            params.delete('search')
            return params
          })
        }
        onViewSettingsChange={setViewSettings}
      />

      {loadError ? (
        <ErrorState
          title="记忆宫殿刷新失败"
          description={loadError}
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => void fetchData().catch(() => undefined)}>
              重新加载
            </Button>
          }
        />
      ) : (
        <>
          {activeStage && activeStage.palace_count > 0 ? (
            <div
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-info/25 bg-info/5 px-4 py-2.5 text-sm"
              data-testid="stage-filter-banner"
            >
              <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                <span className="rounded-full bg-info/15 px-2.5 py-0.5 text-xs font-semibold text-foreground">
                  {stageLabel(activeStage.interval_days)}
                </span>
                <span>
                  下方只显示这一档的 <strong className="text-foreground">{activeStage.palace_count}</strong> 座宫殿
                  · {activeStage.unit_count} 个记忆单元
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0 rounded-xl"
                onClick={() => setStageFilter(null)}
              >
                查看全部
              </Button>
            </div>
          ) : null}
          <PalaceListSections
            groupedData={visibleGroupedData}
            hasPalaces={allPalaces.length > 0}
            viewSettings={viewSettings}
            collapsedChapters={collapsedChapters}
            onToggleChapter={(chapterId) =>
              setCollapsedChapters((current) => {
                const next = new Set(current)
                if (next.has(chapterId)) next.delete(chapterId)
                else next.add(chapterId)
                return next
              })
            }
            renderPalaceCard={renderPalaceCard}
            emptyTitle={
              activeStage
                ? (search ? '这一段间隔里没有匹配的宫殿' : `「${stageLabel(activeStage.interval_days)}」间隔段没有宫殿`)
                : search
                  ? '没有匹配的记忆宫殿'
                  : '这个书架还没有宫殿'
            }
            emptyDescription={
              activeStage
                ? (search
                    ? '换一个关键词，或查看全部宫殿。'
                    : '这一段间隔暂时没有宫殿；换一段，或查看全部宫殿。')
                : search
                  ? '换一个关键词，或清除搜索后查看全部宫殿。'
                  : '新建一个宫殿，或回到学科书架选择其他分类。'
            }
            emptyActionLabel="新建宫殿"
            emptyAction={
              activeStage ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setStageFilter(null)}>
                  查看全部宫殿
                </Button>
              ) : undefined
            }
          />
        </>
      )}

    </PageContainer>
  )
}
