import { useExamOverview } from '@/modules/exam/public'
import { ChevronsDownUp, FolderTree, Plus, Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useRouteResidency } from '@/shared/routing/RouteResidency'
import { PageHeader } from '@/shared/components/layout/PageHeader'
import { PageContainer } from '@/shared/components/layout/PageLayout'
import type { PalaceGroupedListResponse, PalaceSubjectShelfItem } from '@/shared/api/contracts'
import {
  getPalacesGroupedApi,
  getPalaceSubjectShelfApi,
  PALACE_CATALOG_INVALIDATED_EVENT,
} from '@/modules/content/domain/palace-entity/api'
import { isStudyTextLibraryPending, peekGroupedPalaces, peekSubjectShelf } from '@/shared/study-text/studyTextLibrary'
import { Button } from '@/shared/components/ui/button'
import { Card } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { EmptyState, ErrorState } from '@/shared/components/state-placeholders'
import { PalaceShelfSkeleton } from './components/PalaceShelfSkeleton'
import { PalaceCatalogTree } from './components/PalaceCatalogTree'
import { usePalaceListCardActions } from '@/modules/content/ui/palace-catalog/components/palace-list/usePalaceListCardActions'
import { onAppEvent } from '@/shared/events/appEvents'
import {
  buildPalaceCatalogQuery,
  createEmptyPalaceGroupedListResponse,
  flattenGroupedPalaces,
} from '@/modules/content/ui/palace-catalog/model/palaceCatalog'

/** Fold memory for the shelf tree; separate from the editor's directory. */
const SHELF_TREE_VIEW_STATE_KEY = 'palace-shelf-tree'

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
  const [loadError, setLoadError] = useState<string | null>(null)
  const [collapseSignal, setCollapseSignal] = useState(0)

  const fetchShelfData = useCallback(async () => {
    const params = buildPalaceCatalogQuery({ search, selectedSubjectId: null })
    const shelfResponse = await getPalaceSubjectShelfApi(params)
    setItems(shelfResponse.items || [])
  }, [search])

  const fetchGroupedData = useCallback(async () => {
    const params = buildPalaceCatalogQuery({ search, selectedSubjectId: null })
    const groupedResponse = await getPalacesGroupedApi(params)
    setGroupedData(groupedResponse)
    return groupedResponse
  }, [search])

  const fetchData = useCallback(async () => {
    setLoadError(null)
    try {
      const [, grouped] = await Promise.all([fetchShelfData(), fetchGroupedData()])
      return grouped
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '加载学科书架失败。')
      throw error
    }
  }, [fetchGroupedData, fetchShelfData])

  useEffect(() => {
    void fetchData().catch(() => undefined)
  }, [fetchData])

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

  const subjectSummaries = useMemo(
    () => new Map(items.filter((item) => item.subject).map((item) => [item.subject!.id, item])),
    [items],
  )
  const hasPalaces = useMemo(
    () => flattenGroupedPalaces(groupedData ?? createEmptyPalaceGroupedListResponse()).length > 0
      || (groupedData?.ungrouped.length ?? 0) > 0,
    [groupedData],
  )
  const cardActions = usePalaceListCardActions({
    fetchData: async () => (await fetchData()) ?? createEmptyPalaceGroupedListResponse(),
    navigate,
  })
  const { data: examOverview, reload: reloadExam } = useExamOverview()
  const examStarsById = useMemo(
    () => new Map((examOverview?.palaces ?? []).map((row) => [row.id, row])),
    [examOverview],
  )

  const setSearch = (value: string) =>
    setSearchParams((params) => {
      if (value) params.set('search', value)
      else params.delete('search')
      return params
    })

  return (
    <PageContainer>
      <PageHeader
        title="学科书架"
        actions={
          <>
            <Button asChild size="sm" variant="outline">
              <Link to="/knowledge">
                <FolderTree />
                知识树编辑
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/palaces/new">
                <Plus />
                新建宫殿
              </Link>
            </Button>
          </>
        }
      />

      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索学科或宫殿..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
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
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ml-auto text-muted-foreground"
          aria-label="全部收起"
          title="全部收起"
          disabled={Boolean(search)}
          onClick={() => setCollapseSignal((value) => value + 1)}
        >
          <ChevronsDownUp />
        </Button>
      </div>

      {loadError && !groupedData ? (
        <ErrorState
          title="学科书架加载失败"
          description={loadError}
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => void fetchData().catch(() => undefined)}>
              重新加载
            </Button>
          }
        />
      ) : !groupedData ? (
        <PalaceShelfSkeleton />
      ) : hasPalaces || items.length > 0 ? (
        <Card className="p-1" data-testid="shelf-tree">
          <PalaceCatalogTree
            grouped={groupedData}
            subjectSummaries={subjectSummaries}
            examStarsById={examStarsById}
            examStarRule={examOverview?.star_rule.description}
            onExamStarsSaved={() => void reloadExam()}
            onPalaceReview={cardActions.onPalaceReview}
            onDelete={cardActions.onDelete}
            expandAll={Boolean(search)}
            highlight={search}
            collapseSignal={collapseSignal}
            viewStateKey={SHELF_TREE_VIEW_STATE_KEY}
            emptyState={search ? '没有匹配的学科或宫殿。' : '还没有宫殿。'}
          />
        </Card>
      ) : isStudyTextLibraryPending() ? (
        <PalaceShelfSkeleton />
      ) : (
        <Card>
          <EmptyState
            variant="create"
            title={search ? '没有匹配的学科或宫殿' : '还没有学科书架'}
            description={search ? '换一个关键词试试。' : '绑定章节后，宫殿会出现在对应学科下。'}
            action={
              <Button asChild variant="outline" size="sm">
                <Link to="/palaces/new">
                  <Plus />
                  创建第一个宫殿
                </Link>
              </Button>
            }
          />
        </Card>
      )}
    </PageContainer>
  )
}
