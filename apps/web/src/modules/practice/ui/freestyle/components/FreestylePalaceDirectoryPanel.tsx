import { useState, type ReactNode } from 'react'
import { ListOrdered, ScrollText } from 'lucide-react'
import {
  PalaceDirectoryTreeView,
  usePalaceDirectoryTree,
  usePalaceMenuActions,
  type RoundPalaceStatus,
} from '@/modules/content/public'
import { MindMapSplitLayout, SplitPanelToggle } from '@/shared/components/layout/MindMapSplitLayout'
import { FreestyleQueuePanel, type FreestyleQueuePanelProps } from './FreestyleQueuePanel'

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
  /** Every palace still in this round's queue, each with how far it has got. */
  queuedPalaces?: ReadonlyMap<number, RoundPalaceStatus>
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  onSelectPalace: (palaceId: number) => void
  /** 单独编辑: open the palace editor with a way back to this round. */
  onEditPalace?: (palaceId: number) => void
  /** Fullscreen feed hides the directory instead of squeezing it. */
  queuePanel?: FreestyleQueuePanelProps
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
  queuedPalaces,
  collapsed,
  onCollapsedChange,
  onSelectPalace,
  onEditPalace,
  queuePanel,
  hidden = false,
  children,
}: FreestylePalaceDirectoryPanelProps) {
  const { tree, loading, error } = usePalaceDirectoryTree({ enabled: !hidden })
  const rowMenus = usePalaceMenuActions()
  const [activeView, setActiveView] = useState<'directory' | 'queue'>('directory')
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
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex shrink-0 items-center gap-1 border-b border-border/70 px-2 py-1.5" role="tablist" aria-label="左侧面板">
            <button
              type="button"
              role="tab"
              aria-selected={activeView === 'directory'}
              onClick={() => setActiveView('directory')}
              className={activeView === 'directory'
                ? 'inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary/10 px-2 text-xs font-medium text-primary'
                : 'inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground'}
            >
              <ScrollText className="size-3.5" aria-hidden />目录
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeView === 'queue'}
              onClick={() => setActiveView('queue')}
              className={activeView === 'queue'
                ? 'inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary/10 px-2 text-xs font-medium text-primary'
                : 'inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground'}
            >
              <ListOrdered className="size-3.5" aria-hidden />随心列表
            </button>
            <SplitPanelToggle />
          </div>
          <div className={activeView === 'directory' ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'hidden'} role="tabpanel" aria-label="宫殿目录">
            <PalaceDirectoryTreeView
              tree={tree}
              currentPalaceId={currentPalaceId}
              // A feed keeps moving; only the first card's palace is revealed, the
              // rest of the round stays marked by dots instead of yanking the list.
              revealCurrent={false}
              queuedPalaces={queuedPalaces}
              loading={loading}
              error={error}
              onSelectPalace={select}
              palaceMenu={(palace, { beginRename }) => rowMenus.palaceMenu(palace, {
                open: { onSelect: () => select(palace.id) },
                edit: onEditPalace
                  ? { onSelect: () => onEditPalace(palace.id) }
                  : undefined,
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
              showCollapseToggle={false}
            />
          </div>
          <div className={activeView === 'queue' ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'hidden'} role="tabpanel" aria-label="随心列表内容">
            {queuePanel ? <FreestyleQueuePanel {...queuePanel} active={activeView === 'queue' && !collapsed && !hidden} /> : null}
          </div>
          {rowMenus.moveDialog}
        </div>
      )}
    >
      {children}
    </MindMapSplitLayout>
  )
}
