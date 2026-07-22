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
  renderPalaceCard: (palace: TPalace) => ReactNode
  emptyTitle?: string
  emptyDescription?: string
  emptyActionLabel?: string
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
                return (
                  <div
                    key={chapterId ?? 'no-chapter'}
                    className={getChapterCardClass(viewSettings.layoutMode, viewSettings.densityMode)}
                  >
                    {group.source_chapter ? (
                      <button
                        type="button"
                        className="mb-1 ml-2 flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                        onClick={() => chapterId != null && onToggleChapter(chapterId)}
                      >
                        {isCollapsed ? (
                          <ChevronRight className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                        {group.source_chapter.name}
                      </button>
                    ) : null}
                    {!isCollapsed ? (
                      <div className={getChapterPalaceGridClass(viewSettings.layoutMode)}>
                        {group.palaces.map((palace) => renderPalaceCard(palace as TPalace))}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
            {subject.ungrouped_palaces.length > 0 ? (
              <div className={getUngroupedPalaceGridClass(viewSettings.layoutMode)}>
                {subject.ungrouped_palaces.map((palace) => renderPalaceCard(palace as TPalace))}
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
