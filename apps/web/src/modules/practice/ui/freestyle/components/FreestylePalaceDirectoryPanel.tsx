import type { ReactNode } from 'react'
import {
  PalaceDirectoryTreeView,
  usePalaceDirectoryTree,
  usePalaceMenuActions,
} from '@/modules/content/public'
import { MindMapSplitLayout } from '@/shared/components/layout/MindMapSplitLayout'

/**
 * Fold/scroll memory is session-only and keyed per surface: the freestyle
 * directory is not the editor directory, so opening a palace from one must not
 * reorder the other's folds.
 */
const FREESTYLE_DIRECTORY_VIEW_STATE_KEY = 'freestyle-directory'

function isNarrowViewport() {
  return typeof window !== 'undefined'
    && Boolean(window.matchMedia?.('(max-width: 767px)').matches)
}

export interface FreestylePalaceDirectoryPanelProps {
  /** Palace of the card on screen; keeps the filled row. */
  currentPalaceId: number | null
  /** Every palace still in this round's queue, marked with a dot in the tree. */
  queuedPalaceIds?: ReadonlySet<number>
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  onSelectPalace: (palaceId: number) => void
  /** Fullscreen feed hides the directory instead of squeezing it. */
  hidden?: boolean
  children: ReactNode
}

/**
 * 随心的左侧宫殿目录: the same 学科 → 章节 → 宫殿 tree the mind-map editor
 * uses, on the chrome side of the immersive stage. It owns a collapse rail of
 * its own — collapsing the app nav must not take the directory with it.
 */
export function FreestylePalaceDirectoryPanel({
  currentPalaceId,
  queuedPalaceIds,
  collapsed,
  onCollapsedChange,
  onSelectPalace,
  hidden = false,
  children,
}: FreestylePalaceDirectoryPanelProps) {
  const { tree, loading, error } = usePalaceDirectoryTree({ enabled: !hidden })
  const rowMenus = usePalaceMenuActions()
  const select = (palaceId: number) => {
    onSelectPalace(palaceId)
    // Below md the open panel overlays the stage; keep the chosen card visible.
    if (isNarrowViewport()) onCollapsedChange(true)
  }
  return (
    <MindMapSplitLayout
      side="start"
      resizable
      collapsed={collapsed}
      onCollapsedChange={onCollapsedChange}
      hidden={hidden}
      railMode="always"
      collapseLabel="收起宫殿目录"
      expandLabel="展开宫殿目录"
      // Below md the panel is an overlay over the stage; those overlays go up to
      // z-70 (结算), so the open directory must sit above them or it opens behind
      // today's start page.
      sideClassName="bg-card max-md:z-[75]"
      sidePanel={(
        <>
        <PalaceDirectoryTreeView
          tree={tree}
          currentPalaceId={currentPalaceId}
          // A feed keeps moving; only the first card's palace is revealed, the
          // rest of the round stays marked by dots instead of yanking the list.
          revealCurrent={false}
          queuedPalaceIds={queuedPalaceIds}
          loading={loading}
          error={error}
          onSelectPalace={select}
          palaceMenu={(palace, { beginRename }) => rowMenus.palaceMenu(palace, {
            open: { onSelect: () => select(palace.id) },
            rename: { onSelect: beginRename },
            omit: ['freestyle'],
          })}
          chapterMenu={(chapter, { beginRename }) => rowMenus.chapterMenu(
            { id: chapter.id, name: chapter.name, subjectId: chapter.subjectId },
            { rename: { onSelect: beginRename }, omit: ['freestyle'] },
          )}
          subjectMenu={(subject, { beginRename }) => rowMenus.subjectMenu(
            { id: subject.id, name: subject.name },
            { rename: { onSelect: beginRename } },
          )}
          onRenamePalace={rowMenus.renamePalaceTo}
          onRenameChapter={rowMenus.renameChapterTo}
          onRenameSubject={rowMenus.renameSubjectTo}
          viewStateKey={FREESTYLE_DIRECTORY_VIEW_STATE_KEY}
        />
        {rowMenus.moveDialog}
        </>
      )}
    >
      {children}
    </MindMapSplitLayout>
  )
}
