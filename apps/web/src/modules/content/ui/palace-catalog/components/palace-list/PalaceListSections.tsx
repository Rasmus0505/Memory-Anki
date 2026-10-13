import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type {
  PalaceGroupedItem,
  PalaceGroupedListResponse,
  PalaceGroupedSummaryItem,
  PalaceGroupedSummaryListResponse,
} from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { EmptyState } from '@/shared/components/state-placeholders'
import { ShareBar, shareRatio } from '@/shared/ui/share-bar/ShareBar'
import type { PalaceListViewSettings } from '@/modules/settings/public'
import {
  getChapterCardClass,
  getChapterPalaceGridClass,
  getListSectionWrapperClass,
  getUngroupedPalaceGridClass,
} from '@/modules/content/ui/palace-catalog/components/palace-list/utils'

interface PalaceListSectionsProps<TPalace extends PalaceGroupedItem | PalaceGroupedSummaryItem> {
  groupedData: PalaceGroupedListResponse | PalaceGroupedSummaryListResponse
  hasPalaces: boolean
  viewSettings: PalaceListViewSettings
  collapsedChapters: Set<number>
  onToggleChapter: (chapterId: number) => void
  /** `parentQuestionTotal` is the denominator for the palace's share bar (its chapter, or its subject when ungrouped). */
  renderPalaceCard: (palace: TPalace, parentQuestionTotal?: number | null) => ReactNode
  emptyTitle?: string
  emptyDescription?: string
  emptyActionLabel?: string
}

type SubjectGroup = PalaceGroupedListResponse['subjects'][number] | PalaceGroupedSummaryListResponse['subjects'][number]

/** Chapter id → question total for one subject, so a nested chapter can find its parent's total. */
function chapterTotalsOf(subject: SubjectGroup): Map<number, number> {
  const totals = new Map<number, number>()
  for (const group of subject.chapter_groups) {
    const id = group.source_chapter?.id
    if (id != null) totals.set(id, group.question_total ?? 0)
  }
  return totals
}

export function PalaceListSections<TPalace extends PalaceGroupedItem | PalaceGroupedSummaryItem>({
  groupedData,
  hasPalaces,
  viewSettings,
  collapsedChapters,
  onToggleChapter,
  renderPalaceCard,
  emptyTitle = '还没有记忆宫殿',
  emptyDescription = '创建你的第一个记忆宫殿，开始构建知识网络。',
  emptyActionLabel = '创建第一个宫殿',
}: PalaceListSectionsProps<TPalace>) {
  return (
    <div
      className="space-y-3"
      data-testid="list-layout-root"
      data-layout-mode={viewSettings.layoutMode}
      data-density-mode={viewSettings.densityMode}
    >
      {hasPalaces ? (
        groupedData.subjects.map((subject) => (
          <div key={subject.subject?.id ?? 'ungrouped'}>
            {subject.subject ? (
              <h2 className="mb-2 text-lg font-semibold text-foreground">
                <span
                  className="mr-2 inline-block h-3 w-3 rounded-full"
                  style={{ backgroundColor: subject.subject.color }}
                />
                {subject.subject.name}
              </h2>
            ) : null}
            <div className={getListSectionWrapperClass(viewSettings.layoutMode)}>
              {subject.chapter_groups.map((group) => {
                const chapterId = group.source_chapter?.id
                const isCollapsed = chapterId != null && collapsedChapters.has(chapterId)
                // A chapter's bar is its share of its parent chapter; a top-level chapter (or one whose
                // parent is not on this shelf) is measured against the whole subject.
                const parentId = group.source_chapter?.parent_id
                const parentTotal = (parentId != null ? chapterTotalsOf(subject).get(parentId) : undefined) ?? subject.question_total ?? null
                return (
                  <div
                    key={chapterId ?? 'no-chapter'}
                    // content-visibility 让视口外章节组跳过渲染，长列表零依赖提速。
                    className={`${getChapterCardClass(viewSettings.layoutMode, viewSettings.densityMode)} [content-visibility:auto] [contain-intrinsic-size:auto_240px]`}
                  >
                    {group.source_chapter ? (
                      <div className="mb-1 ml-2 flex flex-col gap-1">
                        <button
                          type="button"
                          className="flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                          onClick={() => chapterId != null && onToggleChapter(chapterId)}
                        >
                          {isCollapsed ? (
                            <ChevronRight className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" />
                          )}
                          {group.source_chapter.name}
                        </button>
                        <ShareBar
                          className="mr-2 max-w-xs"
                          ratio={shareRatio(group.question_total, parentTotal)}
                          label={`章节题目占比 ${group.question_total ?? 0}/${parentTotal ?? 0}`}
                        />
                      </div>
                    ) : null}
                    {!isCollapsed ? (
                      <div className={getChapterPalaceGridClass(viewSettings.layoutMode)}>
                        {group.palaces.map((palace) => renderPalaceCard(palace as TPalace, group.question_total ?? null))}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
            {subject.ungrouped_palaces.length > 0 ? (
              <div className={getUngroupedPalaceGridClass(viewSettings.layoutMode)}>
                {subject.ungrouped_palaces.map((palace) => renderPalaceCard(palace as TPalace, subject.question_total ?? null))}
              </div>
            ) : null}
          </div>
        ))
      ) : (
        <Card>
          <CardContent>
            <EmptyState
              variant="create"
              title={emptyTitle}
              description={emptyDescription}
              action={
                <Link to="/palaces/new">
                  <Button variant="outline" size="sm">
                    <Plus className="mr-2 size-4" />
                    {emptyActionLabel}
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
