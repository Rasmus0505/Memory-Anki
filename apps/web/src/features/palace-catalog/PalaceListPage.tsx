import { ArrowLeft, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  PalaceListCard,
} from '@/features/palace-catalog/components/palace-list/PalaceListCard'
import {
  PalaceListSections,
} from '@/features/palace-catalog/components/palace-list/PalaceListSections'
import {
  PalaceListToolbar,
} from '@/features/palace-catalog/components/palace-list/PalaceListToolbar'
import {
  DEFAULT_PALACE_LIST_VIEW_SETTINGS,
  PALACE_LIST_VIEW_SETTINGS_KEY,
  type PalaceListViewSettings,
  isPalaceListViewSettings,
} from '@/entities/preferences/model/palaceViewSettings'
import type {
  PalaceGroupedItem,
  PalaceGroupedListResponse,
} from '@/shared/api/contracts'
import {
  getPalacesGroupedApi,
  PALACE_CATALOG_INVALIDATED_EVENT,
} from '@/entities/palace/api'
import { Button } from '@/shared/components/ui/button'
import { PageIntro } from '@/shared/components/layout/PageIntro'
import { useLocalStorageState } from '@/shared/lib/localStorage'
import { PalaceListSkeleton } from './components/PalaceListSkeleton'
import { usePalaceListCardActions } from '@/features/palace-catalog/components/palace-list/usePalaceListCardActions'
import {
  buildPalaceCatalogQuery,
  createEmptyPalaceGroupedListResponse,
  filterGroupedPalacesByScope,
  flattenGroupedPalaces,
  getPalaceCatalogScopeTitle,
} from '@/features/palace-catalog/model/palaceCatalog'

export default function PalaceList() {
  const navigate = useNavigate()
  const [groupedData, setGroupedData] = useState<PalaceGroupedListResponse>(
    createEmptyPalaceGroupedListResponse,
  )
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get('search') || ''
  const selectedSubjectId = searchParams.get('subjectId')
  const showUncategorizedOnly = searchParams.get('uncategorized') === 'true'
  const [collapsedChapters, setCollapsedChapters] = useState<Set<number>>(new Set())
  const [viewSettings, setViewSettings] = useLocalStorageState<PalaceListViewSettings>(
    PALACE_LIST_VIEW_SETTINGS_KEY,
    DEFAULT_PALACE_LIST_VIEW_SETTINGS,
    isPalaceListViewSettings,
    'palace_list_view_settings',
  )

  const fetchData = useCallback(async () => {
    const scope = { selectedSubjectId, showUncategorizedOnly }
    const params = buildPalaceCatalogQuery({ search, selectedSubjectId })
    const data = await getPalacesGroupedApi(params)
    const filteredData = filterGroupedPalacesByScope(data, scope)
    setGroupedData(filteredData)
    return filteredData
  }, [search, selectedSubjectId, showUncategorizedOnly])

  const allPalaces = useMemo(() => flattenGroupedPalaces(groupedData), [groupedData])

  const currentSubjectTitle = useMemo(() => {
    return getPalaceCatalogScopeTitle(groupedData, {
      selectedSubjectId,
      showUncategorizedOnly,
    })
  }, [groupedData.subjects, selectedSubjectId, showUncategorizedOnly])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  useEffect(() => {
    const handleCatalogInvalidated = () => {
      void fetchData()
    }
    window.addEventListener(PALACE_CATALOG_INVALIDATED_EVENT, handleCatalogInvalidated)
    return () => window.removeEventListener(PALACE_CATALOG_INVALIDATED_EVENT, handleCatalogInvalidated)
  }, [fetchData])

  const cardActions = usePalaceListCardActions({
    allPalaces,
    fetchData,
    navigate,
  })

  const renderPalaceCard = useCallback(
    (palace: PalaceGroupedItem) => (
      <PalaceListCard
        key={palace.id}
        palace={palace}
        viewSettings={viewSettings}
        segmentReviewLoadingId={cardActions.segmentReviewLoadingId}
        markReviewedKey={cardActions.markReviewedKey}
        defaultExpanded
        onOpenBatchReview={cardActions.onOpenBatchReview}
        onPalacePractice={cardActions.onPalacePractice}
        onWarmPalacePractice={cardActions.onWarmPalacePractice}
        onWarmFocusPractice={cardActions.onWarmFocusPractice}
        onSegmentPractice={cardActions.onSegmentPractice}
        onWarmSegmentPractice={cardActions.onWarmSegmentPractice}
        onSegmentReviewAction={cardActions.onSegmentReviewAction}
        onWarmSegmentReviewAction={cardActions.onWarmSegmentReviewAction}
        onOpenStageEdit={cardActions.onOpenStageEdit}
        onMarkSegmentReviewed={cardActions.onMarkSegmentReviewed}
        onMiniPalacePractice={cardActions.onMiniPalacePractice}
        onWarmMiniPalacePractice={cardActions.onWarmMiniPalacePractice}
        onMiniPalaceReview={cardActions.onMiniPalaceReview}
        onWarmMiniPalaceReview={cardActions.onWarmMiniPalaceReview}
        onOpenConfig={cardActions.onOpenConfig}
        onDelete={cardActions.onDelete}
      />
    ),
    [cardActions, viewSettings],
  )

  return (
    <div className="space-y-8">
      <PageIntro
        title="记忆宫殿"
        description={currentSubjectTitle ? `当前书架：${currentSubjectTitle}` : undefined}
        actions={
          <div className="flex items-center gap-3">
            <Link to="/palaces">
              <Button variant="ghost" size="sm" className="-ml-3">
                <ArrowLeft className="size-4" />
                返回学科书架
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
        compact
      />

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

      <PalaceListSections
        groupedData={groupedData}
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
      />

      {cardActions.dialogs}
    </div>
  )
}
