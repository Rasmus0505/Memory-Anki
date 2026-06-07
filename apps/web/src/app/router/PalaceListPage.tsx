import { ArrowLeft, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  PalaceListCard,
} from '@/app/router/palace-list/PalaceListCard'
import {
  PalaceListSections,
} from '@/app/router/palace-list/PalaceListSections'
import {
  PalaceListToolbar,
} from '@/app/router/palace-list/PalaceListToolbar'
import {
  DEFAULT_PALACE_LIST_VIEW_SETTINGS,
  PALACE_LIST_VIEW_SETTINGS_KEY,
  type PalaceListViewSettings,
  isPalaceListViewSettings,
} from '@/app/router/palace-view-settings'
import type {
  PalaceGroupedItem,
  PalaceGroupedListResponse,
} from '@/shared/api/contracts'
import {
  getPalacesGroupedApi,
} from '@/shared/api/modules/palaces'
import { Button } from '@/shared/components/ui/button'
import { useLocalStorageState } from '@/shared/lib/localStorage'
import { usePalaceListCardActions } from '@/app/router/palace-list/usePalaceListCardActions'

export default function PalaceList() {
  const navigate = useNavigate()
  const [groupedData, setGroupedData] = useState<PalaceGroupedListResponse>({
    groups: [],
    ungrouped: [],
    subjects: [],
  })
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get('search') || ''
  const selectedSubjectId = searchParams.get('subjectId')
  const showUncategorizedOnly = searchParams.get('uncategorized') === 'true'
  const [collapsedChapters, setCollapsedChapters] = useState<Set<number>>(new Set())
  const [viewSettings, setViewSettings] = useLocalStorageState<PalaceListViewSettings>(
    PALACE_LIST_VIEW_SETTINGS_KEY,
    DEFAULT_PALACE_LIST_VIEW_SETTINGS,
    isPalaceListViewSettings,
  )

  const fetchData = useCallback(async () => {
    const params: Record<string, string> = {}
    if (search) params.search = search
    if (selectedSubjectId) params.subject_id = selectedSubjectId
    const data = await getPalacesGroupedApi(params)
    const filteredData = showUncategorizedOnly
      ? {
          ...data,
          subjects: data.subjects.filter((subject) => subject.subject == null),
        }
      : selectedSubjectId
        ? {
            ...data,
            subjects: data.subjects.filter((subject) => String(subject.subject?.id ?? '') === selectedSubjectId),
          }
        : data
    setGroupedData(filteredData)
    return filteredData
  }, [search, selectedSubjectId, showUncategorizedOnly])

  const flattenGroupedPalaces = useCallback((data: PalaceGroupedListResponse) => {
    const list: PalaceGroupedItem[] = []
    for (const subject of data.subjects) {
      for (const group of subject.chapter_groups) {
        list.push(...group.palaces)
      }
      list.push(...subject.ungrouped_palaces)
    }
    return list
  }, [])

  const allPalaces = useMemo(() => flattenGroupedPalaces(groupedData), [flattenGroupedPalaces, groupedData])

  const currentSubjectTitle = useMemo(() => {
    if (showUncategorizedOnly) return '未分类'
    return (
      groupedData.subjects.find((subject) => String(subject.subject?.id ?? '') === selectedSubjectId)?.subject
        ?.name ?? null
    )
  }, [groupedData.subjects, selectedSubjectId, showUncategorizedOnly])

  useEffect(() => {
    void fetchData()
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
        onOpenBatchReview={cardActions.onOpenBatchReview}
        onSegmentReviewAction={cardActions.onSegmentReviewAction}
        onOpenStageEdit={cardActions.onOpenStageEdit}
        onMarkSegmentReviewed={cardActions.onMarkSegmentReviewed}
        onDelete={cardActions.onDelete}
      />
    ),
    [cardActions, viewSettings],
  )

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <div className="mb-3">
            <Link to="/palaces">
              <Button variant="ghost" size="sm" className="-ml-3">
                <ArrowLeft className="h-4 w-4" />
                返回学科书架
              </Button>
            </Link>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">记忆宫殿</h1>
          {currentSubjectTitle ? (
            <p className="mt-2 text-sm text-muted-foreground">当前书架：{currentSubjectTitle}</p>
          ) : null}
        </div>
        <Link to="/palaces/new">
          <Button size="sm">
            <Plus className="h-4 w-4" />
            新建宫殿
          </Button>
        </Link>
      </div>

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
