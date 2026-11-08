import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, FileText, LoaderCircle, Plus, Search } from 'lucide-react'
import { Input } from '@/shared/components/ui/input'
import { SplitPanelToggle } from '@/shared/components/layout/MindMapSplitLayout'
import { cn } from '@/shared/lib/utils'
import { InlineRenameInput } from '@/shared/ui/inline-rename/InlineRenameInput'
import { RowContextMenu, type RowMenuEntry } from '@/shared/ui/row-context-menu/RowContextMenu'
import { usePalaceDirectoryTree } from '../hooks/usePalaceDirectoryTree'
import {
  expansionKeysForPalace,
  filterPalaceDirectoryTree,
  type DirectoryChapterNode,
  type DirectoryPalaceNode,
  type DirectorySubjectNode,
  type PalaceDirectoryTree as PalaceDirectoryTreeModel,
} from '../model/palaceDirectoryTree'
import {
  readDirectoryExpandedKeys,
  readDirectoryScrollTop,
  writeDirectoryExpandedKeys,
  writeDirectoryScrollTop,
} from '../model/palaceDirectoryViewState'


/** `sidebar`: compact panel beside a canvas. `page`: a full-page catalog list. */
export type PalaceDirectoryTreeSize = 'sidebar' | 'page'

import {
  PALACE_DRAG_TYPE,
  Highlighted,
  QueueDot,
  collectQueueMarks,
  readDraggedPalaceId,
  roundStatusLabel,
  type RoundPalaceStatus,
} from './palaceDirectoryTreeChrome'

const ROW_METRICS: Record<PalaceDirectoryTreeSize, { indent: number; base: number; text: string; row: string; leaf: string; chevron: string }> = {
  sidebar: { indent: 14, base: 6, text: 'text-[13px]', row: 'py-1', leaf: 'size-3.5', chevron: 'size-5' },
  page: { indent: 20, base: 4, text: 'text-sm', row: 'py-2', leaf: 'size-4', chevron: 'size-7' },
}

export interface RowMenuHelpers {
  /** Turns this row into an input so the host's 「重命名」 runs inline. */
  beginRename: () => void
}

export type RowMenuBuilder<T> = (row: T, helpers: RowMenuHelpers) => RowMenuEntry[] | null

export interface PalaceDirectoryTreeViewProps {
  tree: PalaceDirectoryTreeModel
  currentPalaceId: number | null
  loading?: boolean
  error?: string | null
  onSelectPalace: (palaceId: number) => void
  /** Enables drag-to-rebind; without it rows are select-only. */
  onBindPalace?: (palaceId: number, chapterId: number | null, subjectId: number | null) => void
  /** Right-click / long-press menu for a palace row. */
  palaceMenu?: RowMenuBuilder<DirectoryPalaceNode>
  chapterMenu?: RowMenuBuilder<DirectoryChapterNode>
  subjectMenu?: RowMenuBuilder<DirectorySubjectNode>
  /** 「未分类」 bucket rows only carry host verbs (new palace, open shelf…). */
  bucketMenu?: (bucketKey: string) => RowMenuEntry[] | null
  /** Inline rename handlers; the row turns into an input while renaming. */
  onRenamePalace?: (palaceId: number, nextTitle: string) => void | Promise<void>
  onRenameChapter?: (chapterId: number, nextName: string) => void | Promise<void>
  onRenameSubject?: (subjectId: number, nextName: string) => void | Promise<void>
  showHeader?: boolean
  showCollapseToggle?: boolean
  showSearch?: boolean
  searchPlaceholder?: string
  emptyState?: ReactNode
  className?: string
  /**
   * Keeps folds and scroll position across remounts that share this key (the
   * editor remounts per palace). Omit to start folded every mount.
   */
  viewStateKey?: string
  size?: PalaceDirectoryTreeSize
  /** Drive the filter from outside (the page owns its search box). */
  keyword?: string
  /** Render a single subject's chapters at the root, without the subject row. */
  hideSubjectRows?: boolean
  /** Folds open on first mount when no remembered state exists. */
  defaultExpandedKeys?: ReadonlyArray<string>
  /** Changing this value folds every row (a 「全部收起」 button). */
  collapseSignal?: number
  /** Open every fold, e.g. while the host shows filtered search results. */
  expandAll?: boolean
  /** Trailing content on a row: counts, status chips, row actions. */
  renderPalaceMeta?: (palace: DirectoryPalaceNode) => ReactNode
  renderChapterMeta?: (chapter: DirectoryChapterNode) => ReactNode
  renderSubjectMeta?: (subject: DirectorySubjectNode) => ReactNode
  /** Trailing content on a 「未分类」 bucket row, keyed `root:ungrouped` or `subject:<id>:ungrouped`. */
  renderBucketMeta?: (bucketKey: string) => ReactNode
  /** Mark this text inside chapter and palace names (the host's search term). */
  highlight?: string
  /**
   * Palaces that still have cards in the host's round (随心), each with how far
   * it has got: 还没评分 / 有待重练 / 已评分完. They get a small dot in that colour,
   * and their ancestors a fainter one carrying the least-advanced status below
   * them, so a folded chapter still shows what is left. The palace on screen
   * keeps the filled row.
   */
  queuedPalaces?: ReadonlyMap<number, RoundPalaceStatus>
  /**
   * Expand and scroll to the current palace whenever it changes. True for
   * editors and catalogs; the freestyle feed turns it off so paging cards does
   * not keep yanking the directory, and only reveals its first palace.
   */
  revealCurrent?: boolean
}


/**
 * Pure tree rendering for 「学科 → 章节 → 宫殿」. Data loading and the host's
 * selection semantics stay outside so the editor panel and the lookup dialog
 * can share exactly one visual language.
 */
export function PalaceDirectoryTreeView({
  tree,
  currentPalaceId,
  loading = false,
  error = null,
  onSelectPalace,
  onBindPalace,
  palaceMenu,
  chapterMenu,
  subjectMenu,
  bucketMenu,
  onRenamePalace,
  onRenameChapter,
  onRenameSubject,
  showHeader = true,
  showCollapseToggle = true,
  showSearch = true,
  searchPlaceholder = '搜索宫殿',
  emptyState,
  className,
  viewStateKey,
  size = 'sidebar',
  keyword: controlledKeyword,
  hideSubjectRows = false,
  defaultExpandedKeys,
  collapseSignal,
  expandAll = false,
  renderPalaceMeta,
  renderChapterMeta,
  renderSubjectMeta,
  renderBucketMeta,
  highlight,
  queuedPalaces,
  revealCurrent = true,
}: PalaceDirectoryTreeViewProps) {
  const metrics = ROW_METRICS[size]
  const pageList = size === 'page'
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const remembered = viewStateKey ? readDirectoryExpandedKeys(viewStateKey) : undefined
    return new Set(remembered ?? defaultExpandedKeys ?? [])
  })
  const [ownKeyword, setKeyword] = useState('')
  const keyword = controlledKeyword ?? ownKeyword
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const [renamingKey, setRenamingKey] = useState<string | null>(null)
  const activeRowRef = useRef<HTMLButtonElement | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

  /**
   * Inline rename: the row itself becomes an input. The menu entry that starts
   * it is owned by the host, which hands back this `beginRename` through the
   * row-menu builder — so 「重命名」 keeps one implementation for every list.
   */
  const beginRename = useCallback((key: string) => setRenamingKey(key), [])
  const commitRename = useCallback((
    handler: ((id: number, next: string) => void | Promise<void>) | undefined,
    id: number,
  ) => (next: string) => {
    setRenamingKey(null)
    if (handler) void handler(id, next)
  }, [])
  const cancelRename = useCallback(() => setRenamingKey(null), [])

  useEffect(() => {
    if (!viewStateKey) return
    writeDirectoryExpandedKeys(viewStateKey, expanded)
  }, [expanded, viewStateKey])

  // Restore before paint so the remounted panel never shows a top-of-list frame
  // first; the reveal effect below then only scrolls when the active row is
  // actually outside the restored viewport.
  useLayoutEffect(() => {
    if (!viewStateKey) return
    const savedTop = readDirectoryScrollTop(viewStateKey)
    const node = scrollContainerRef.current
    if (savedTop == null || !node) return
    node.scrollTop = savedTop
  }, [viewStateKey])

  const filtered = useMemo(() => filterPalaceDirectoryTree(tree, keyword), [tree, keyword])

  const lastCollapseSignal = useRef(collapseSignal)
  useEffect(() => {
    if (collapseSignal === lastCollapseSignal.current) return
    lastCollapseSignal.current = collapseSignal
    setExpanded(new Set())
  }, [collapseSignal])
  // A search must reveal what it found: rows are folded by default, so keeping
  // the manual fold state here would hide every match behind a collapsed
  // subject/chapter and look like an empty result.
  const searching = expandAll || keyword.trim().length > 0

  const toggle = useCallback((key: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // Which rows this round reaches into, computed against the full tree so the
  // marks do not blink while a search narrows what is rendered.
  const queueMarks = useMemo(() => collectQueueMarks(tree, queuedPalaces), [tree, queuedPalaces])

  // Opening a palace from anywhere (including the tree itself) reveals its path.
  // A feed host that turns `revealCurrent` off reveals only its first palace:
  // after that the dots keep the round legible without the list moving.
  const revealedPalaceRef = useRef<number | null>(null)
  const pendingScrollRef = useRef(false)
  useEffect(() => {
    if (currentPalaceId == null) return
    if (!revealCurrent && revealedPalaceRef.current != null) return
    // The first render can arrive before the directory loads; only a palace the
    // loaded tree actually contains counts as revealed.
    const keys = expansionKeysForPalace(tree, currentPalaceId)
    if (!keys.length) return
    revealedPalaceRef.current = currentPalaceId
    pendingScrollRef.current = true
    setExpanded((current) => {
      if (keys.every((key) => current.has(key))) return current
      const next = new Set(current)
      for (const key of keys) next.add(key)
      return next
    })
  }, [tree, currentPalaceId, revealCurrent])

  useEffect(() => {
    // jsdom (component tests) has no scrollIntoView.
    if (!revealCurrent && !pendingScrollRef.current) return
    const row = activeRowRef.current
    if (!row) return
    if (typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' })
    pendingScrollRef.current = false
  }, [currentPalaceId, expanded, filtered, revealCurrent])

  const bindFromEvent = useCallback((
    event: DragEvent,
    chapterId: number | null,
    subjectId: number | null,
  ) => {
    if (!onBindPalace) return
    event.preventDefault()
    setDragOverKey(null)
    const palaceId = readDraggedPalaceId(event)
    if (palaceId == null) return
    onBindPalace(palaceId, chapterId, subjectId)
  }, [onBindPalace])

  const dropTargetProps = (key: string, chapterId: number | null, subjectId: number | null) => ({
    onDragOver: (event: DragEvent) => {
      if (!onBindPalace) return
      if (!event.dataTransfer.types.includes(PALACE_DRAG_TYPE)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setDragOverKey((current) => (current === key ? current : key))
    },
    onDragLeave: () => setDragOverKey((current) => (current === key ? null : current)),
    onDrop: (event: DragEvent) => bindFromEvent(event, chapterId, subjectId),
  })

  /**
   * A row's question share: a hairline along the bottom edge with the number at
   * its right end, aligned under the row's label. Rows without totals draw
   * nothing, so the editor's directory stays plain.
   */
  const questionShareLine = (share: number | undefined, depth: number) => {
    if (share == null) return null
    const percent = Math.round(Math.min(1, Math.max(0, share)) * 100)
    return (
      <div
        className="flex items-center gap-2 pb-1 pr-2"
        style={{ paddingLeft: metrics.base + depth * metrics.indent + (pageList ? 28 : 20) }}
        role="img"
        aria-label={`题目占比 ${percent}%`}
        data-question-share={percent}
      >
        <span className="block h-0.5 min-w-0 flex-1 overflow-hidden rounded-full bg-border/60" aria-hidden="true">
          <span className="block h-full rounded-full bg-muted-foreground/35" style={{ width: `${percent}%` }} />
        </span>
        <span className="shrink-0 text-[10px] font-medium leading-none tabular-nums text-muted-foreground">{percent}%</span>
      </div>
    )
  }

  /**
   * `flattenedChapter` marks a leaf chapter rendered as its single palace: the
   * row then also accepts drops so another palace can be rebound onto it.
   */
  const renderPalace = (
    palace: DirectoryPalaceNode,
    depth: number,
    flattenedChapter?: DirectoryChapterNode,
  ) => {
    const active = palace.id === currentPalaceId
    const roundStatus = queueMarks.palaces.get(palace.id)
    const queued = roundStatus != null
    const dropKey = flattenedChapter ? `chapter:${flattenedChapter.id}` : null
    const rowKey = `palace:${palace.id}`
    const rowIndent = { paddingLeft: metrics.base + depth * metrics.indent + (pageList ? 28 : 20) }
    const renaming = renamingKey === rowKey && Boolean(onRenamePalace)
    const palaceButton = (
      <button
        key={rowKey}
        type="button"
        ref={active ? activeRowRef : undefined}
        aria-current={active ? 'page' : undefined}
        aria-label={palace.title}
        title={flattenedChapter && flattenedChapter.name !== palace.title
          ? `${flattenedChapter.name} · ${palace.title}`
          : palace.title}
        draggable={Boolean(onBindPalace) && !renaming}
        onDragStart={onBindPalace
          ? (event) => {
            event.dataTransfer.setData(PALACE_DRAG_TYPE, String(palace.id))
            event.dataTransfer.setData('text/plain', String(palace.id))
            event.dataTransfer.effectAllowed = 'move'
          }
          : undefined}
        onClick={() => onSelectPalace(palace.id)}
        className={cn(
          'group flex items-center gap-1.5 rounded-md pr-1.5 text-left transition-colors',
          metrics.row,
          metrics.text,
          renderPalaceMeta ? 'min-w-0 flex-1' : 'w-full',
          active
            ? 'bg-primary/15 font-medium text-foreground ring-1 ring-inset ring-primary/30'
            : queued
              ? 'text-foreground'
              : renderPalaceMeta
                ? 'text-foreground/90 hover:text-foreground'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
          'data-[state=open]:bg-accent data-[state=open]:text-foreground',
        )}
        style={rowIndent}
        data-round-queued={queued ? 'true' : undefined}
        data-round-status={roundStatus}
      >
        <FileText className={cn(metrics.leaf, 'shrink-0 opacity-60')} aria-hidden />
        <span className="truncate"><Highlighted text={palace.title} query={highlight} /></span>
        {roundStatus && !active
          ? <QueueDot status={roundStatus} label={roundStatusLabel(roundStatus, 'palace')} />
          : null}
      </button>
    )
    const palaceMenuItems = palaceMenu?.(palace, { beginRename: () => beginRename(rowKey) }) ?? null
    const row = renaming ? (
      <div
        key={rowKey}
        className={cn('flex min-w-0 items-center gap-1.5 rounded-md', metrics.row, metrics.text, 'w-full')}
        style={rowIndent}
      >
        <FileText className={cn(metrics.leaf, 'shrink-0 opacity-60')} aria-hidden />
        <InlineRenameInput
          defaultValue={palace.title}
          ariaLabel={`重命名 ${palace.title}`}
          onCommit={commitRename(onRenamePalace, palace.id)}
          onCancel={cancelRename}
        />
      </div>
    ) : (
      <RowContextMenu key={rowKey} items={palaceMenuItems}>{palaceButton}</RowContextMenu>
    )
    const rowWithMeta = renderPalaceMeta ? (
      <div
        key={`palace-row:${palace.id}`}
        data-palace-row={palace.id}
        className="group/row min-w-0 rounded-md transition-colors hover:bg-accent/70"
      >
        <div className="flex min-w-0 items-center gap-2 pr-2">
          {row}
          <div className="flex shrink-0 items-center gap-1.5">{renderPalaceMeta(palace)}</div>
        </div>
        {questionShareLine(flattenedChapter?.questionShare ?? palace.questionShare, depth)}
      </div>
    ) : row
    if (!flattenedChapter || dropKey == null) return rowWithMeta
    return (
      <div
        key={dropKey}
        {...dropTargetProps(dropKey, flattenedChapter.id, flattenedChapter.subjectId)}
        className={cn(
          'rounded-md transition-colors',
          dragOverKey === dropKey ? 'bg-primary/10 ring-1 ring-primary/50' : null,
        )}
      >
        {rowWithMeta}
      </div>
    )
  }

  const renderChapter = (chapter: DirectoryChapterNode, depth: number) => {
    // A leaf chapter with exactly one palace folds into that palace: the extra
    // fold would only reveal a child with the same name.
    if (chapter.children.length === 0 && chapter.palaces.length === 1) {
      return renderPalace(chapter.palaces[0], depth, chapter)
    }
    const key = `chapter:${chapter.id}`
    const isOpen = searching || expanded.has(key)
    const renaming = renamingKey === key && Boolean(onRenameChapter)
    const chapterStatus = queueMarks.chapters.get(chapter.id)
    const chapterLabel = (
      <button
        type="button"
        onClick={() => toggle(key)}
        className={cn(
          'min-w-0 flex-1 truncate pr-1.5 text-left text-foreground/85',
          metrics.row,
          metrics.text,
          'data-[state=open]:text-foreground',
        )}
      >
        <Highlighted text={chapter.name} query={highlight} />
      </button>
    )
    const chapterMenuItems = chapterMenu?.(chapter, { beginRename: () => beginRename(key) }) ?? null
    return (
      <div key={key} className="min-w-0">
        <div
          {...dropTargetProps(key, chapter.id, chapter.subjectId)}
          className={cn(
            'group/row flex items-center rounded-md transition-colors',
            dragOverKey === key ? 'bg-primary/10 ring-1 ring-primary/50' : pageList ? 'hover:bg-accent/70' : 'hover:bg-muted/60',
            renderChapterMeta && 'gap-2 pr-2',
          )}
        >
          <button
            type="button"
            onClick={() => toggle(key)}
            aria-expanded={isOpen}
            aria-label={`${isOpen ? '收起' : '展开'}${chapter.name}`}
            className={cn('flex shrink-0 items-center justify-center rounded-md text-muted-foreground', metrics.chevron)}
            style={{ marginLeft: metrics.base + depth * metrics.indent }}
          >
            <ChevronRight className={cn('size-3.5 transition-transform', isOpen && 'rotate-90')} aria-hidden />
          </button>
          {renaming ? (
            <InlineRenameInput
              defaultValue={chapter.name}
              ariaLabel={`重命名 ${chapter.name}`}
              className={cn(metrics.text, metrics.row)}
              onCommit={commitRename(onRenameChapter, chapter.id)}
              onCancel={cancelRename}
            />
          ) : (
            <RowContextMenu items={chapterMenuItems}>{chapterLabel}</RowContextMenu>
          )}
          {chapterStatus
            ? <QueueDot faint status={chapterStatus} label={roundStatusLabel(chapterStatus, 'chapter')} />
            : null}
          {renderChapterMeta ? <div className="flex shrink-0 items-center gap-1.5">{renderChapterMeta(chapter)}</div> : null}
        </div>
        {questionShareLine(chapter.questionShare, depth)}
        {isOpen ? (
          <div className="min-w-0">
            {chapter.children.map((child) => renderChapter(child, depth + 1))}
            {chapter.palaces.map((palace) => renderPalace(palace, depth + 1))}
          </div>
        ) : null}
      </div>
    )
  }

  const renderUngroupedBucket = (
    key: string,
    label: string,
    palaces: DirectoryPalaceNode[],
    depth: number,
  ) => {
    const isOpen = searching || expanded.has(key)
    const bucketStatus = queueMarks.buckets.get(key)
    const bucketLabel = (
      <button
        type="button"
        onClick={() => toggle(key)}
        className={cn(
          'min-w-0 flex-1 truncate pr-1.5 text-left text-muted-foreground',
          metrics.row,
          metrics.text,
          'data-[state=open]:text-foreground',
        )}
      >
        {label}
      </button>
    )
    const bucketMenuItems = bucketMenu?.(key) ?? null
    return (
      <div key={key} className="min-w-0">
        <div className={cn('group/row flex items-center rounded-md transition-colors', pageList ? 'hover:bg-accent/70' : 'hover:bg-muted/60', renderBucketMeta && 'gap-2 pr-2')}>
          <button
            type="button"
            onClick={() => toggle(key)}
            aria-expanded={isOpen}
            aria-label={`${isOpen ? '收起' : '展开'}${label}`}
            className={cn('flex shrink-0 items-center justify-center rounded-md text-muted-foreground', metrics.chevron)}
            style={{ marginLeft: metrics.base + depth * metrics.indent }}
          >
            <ChevronRight className={cn('size-3.5 transition-transform', isOpen && 'rotate-90')} aria-hidden />
          </button>
          <RowContextMenu items={bucketMenuItems}>{bucketLabel}</RowContextMenu>
          {bucketStatus
            ? <QueueDot faint status={bucketStatus} label={roundStatusLabel(bucketStatus, 'bucket')} />
            : null}
          {renderBucketMeta ? <div className="flex shrink-0 items-center gap-1.5">{renderBucketMeta(key)}</div> : null}
        </div>
        {isOpen ? palaces.map((palace) => renderPalace(palace, depth + 1)) : null}
      </div>
    )
  }

  const renderSubjectChildren = (subject: DirectorySubjectNode, depth: number) => (
    <div className="min-w-0">
      {subject.chapters.map((chapter) => renderChapter(chapter, depth))}
      {subject.ungrouped.length
        ? renderUngroupedBucket(
          `subject:${subject.id}:ungrouped`,
          '未分类',
          subject.ungrouped,
          depth,
        )
        : null}
    </div>
  )

  const renderSubject = (subject: DirectorySubjectNode, depth: number) => {
    if (hideSubjectRows) return <div key={`subject:${subject.id}`}>{renderSubjectChildren(subject, depth)}</div>
    const key = `subject:${subject.id}`
    const isOpen = searching || expanded.has(key)
    const renaming = renamingKey === key && Boolean(onRenameSubject)
    const subjectStatus = queueMarks.subjects.get(subject.id)
    const subjectLabel = (
      <button
        type="button"
        onClick={() => toggle(key)}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-1.5 pr-1.5 text-left font-medium text-foreground',
          metrics.row,
          metrics.text,
          pageList && 'ma-display py-3 text-[17px]',
          'data-[state=open]:text-foreground',
        )}
      >
        <span
          className="size-2 shrink-0 rounded-[2px]"
          style={{ backgroundColor: subject.color }}
          aria-hidden
        />
        <span className="truncate"><Highlighted text={subject.name} query={highlight} /></span>
      </button>
    )
    const subjectMenuItems = subjectMenu?.(subject, { beginRename: () => beginRename(key) }) ?? null
    return (
      <div key={key} className={cn('min-w-0', pageList && 'border-b border-border/60 py-1 last:border-b-0')}>
        <div className={cn('group/row flex items-center rounded-md transition-colors', pageList ? 'hover:bg-accent/70' : 'hover:bg-muted/60', renderSubjectMeta && 'gap-2 pr-2')}>
          <button
            type="button"
            onClick={() => toggle(key)}
            aria-expanded={isOpen}
            aria-label={`${isOpen ? '收起' : '展开'}${subject.name}`}
            className={cn('flex shrink-0 items-center justify-center rounded-md text-muted-foreground', metrics.chevron)}
            style={{ marginLeft: metrics.base + depth * metrics.indent }}
          >
            <ChevronRight className={cn('size-3.5 transition-transform', isOpen && 'rotate-90')} aria-hidden />
          </button>
          {renaming ? (
            <div className={cn('flex min-w-0 flex-1 items-center gap-1.5', metrics.text, metrics.row)}>
              <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: subject.color }} aria-hidden />
              <InlineRenameInput
                defaultValue={subject.name}
                ariaLabel={`重命名 ${subject.name}`}
                onCommit={commitRename(onRenameSubject, subject.id)}
                onCancel={cancelRename}
              />
            </div>
          ) : (
            <RowContextMenu items={subjectMenuItems}>{subjectLabel}</RowContextMenu>
          )}
          {subjectStatus
            ? <QueueDot faint status={subjectStatus} label={roundStatusLabel(subjectStatus, 'subject')} />
            : null}
          {renderSubjectMeta ? <div className="flex shrink-0 items-center gap-1.5">{renderSubjectMeta(subject)}</div> : null}
        </div>
        {questionShareLine(subject.questionShare, depth)}
        {isOpen ? renderSubjectChildren(subject, depth + 1) : null}
      </div>
    )
  }

  const hasAnySubject = filtered.subjects.length > 0
  const hasRootUngrouped = filtered.ungrouped.length > 0

  return (
    <div className={cn('flex w-full flex-col gap-2', pageList ? 'p-1' : 'h-full min-h-0 p-3', className)}>
      {showHeader ? (
        <div className="flex h-7 items-center gap-0.5">
          <span className="mr-auto pl-1 text-xs font-medium tracking-wide text-muted-foreground">记忆宫殿</span>
          <Link
            to="/palaces/new"
            aria-label="新建宫殿"
            title="新建宫殿"
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Plus className="size-4" aria-hidden />
          </Link>
          {showCollapseToggle ? <SplitPanelToggle /> : null}
        </div>
      ) : null}
      {showSearch ? (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2 size-3.5 text-muted-foreground" aria-hidden />
          <Input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="h-8 pl-8 text-[13px]"
          />
        </div>
      ) : null}
      <div
        ref={scrollContainerRef}
        aria-label="宫殿目录"
        className={pageList ? 'min-w-0' : 'min-h-0 flex-1 overflow-y-auto'}
        onScroll={viewStateKey
          ? (event) => { writeDirectoryScrollTop(viewStateKey, event.currentTarget.scrollTop) }
          : undefined}
      >
        {loading && !hasAnySubject && !hasRootUngrouped ? (
          <div className="flex items-center gap-2 px-1 py-3 text-[13px] text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
            正在加载目录…
          </div>
        ) : null}
        {error ? (
          <p className="px-1 py-2 text-[13px] text-destructive">{error}</p>
        ) : null}
        {!loading && !error && !hasAnySubject && !hasRootUngrouped ? (
          <p className="px-1 py-3 text-[13px] text-muted-foreground">
            {searching
              ? '没有匹配的宫殿。'
              : emptyState ?? <>还没有学科。<Link to="/knowledge" className="text-primary hover:underline">去知识库建立学科</Link></>}
          </p>
        ) : null}
        {filtered.subjects.map((subject) => renderSubject(subject, 0))}
        {hasRootUngrouped
          ? renderUngroupedBucket('root:ungrouped', '未分类', filtered.ungrouped, 0)
          : null}
      </div>
    </div>
  )
}

export interface PalaceDirectoryTreeProps {
  currentPalaceId: number | null
  onOpenPalace: (palaceId: number) => void
  /** Resolve a drop: `chapterId === null` means the 「未分类」 bucket. */
  onBindPalace: (palaceId: number, chapterId: number | null, subjectId: number | null) => void
  palaceMenu?: RowMenuBuilder<DirectoryPalaceNode>
  chapterMenu?: RowMenuBuilder<DirectoryChapterNode>
  subjectMenu?: RowMenuBuilder<DirectorySubjectNode>
  bucketMenu?: (bucketKey: string) => RowMenuEntry[] | null
  onRenamePalace?: (palaceId: number, nextTitle: string) => void | Promise<void>
  onRenameChapter?: (chapterId: number, nextName: string) => void | Promise<void>
  onRenameSubject?: (subjectId: number, nextName: string) => void | Promise<void>
  className?: string
  /** Share folds with the surface that launched this editor (e.g. 随心目录). */
  viewStateKey?: string
}

/**
 * Every palace editor instance shows the same directory, so they share one
 * view-state key: switching to a palace in another chapter keeps the folders
 * the user had open and the scroll position instead of resetting the panel.
 */
export const PALACE_EDITOR_DIRECTORY_VIEW_STATE_KEY = 'palace-editor-directory'

/** Editor-side panel: loads the directory and binds it to the editor's actions. */
export function PalaceDirectoryTree({
  currentPalaceId,
  onOpenPalace,
  onBindPalace,
  palaceMenu,
  chapterMenu,
  subjectMenu,
  bucketMenu,
  onRenamePalace,
  onRenameChapter,
  onRenameSubject,
  className,
  viewStateKey = PALACE_EDITOR_DIRECTORY_VIEW_STATE_KEY,
}: PalaceDirectoryTreeProps) {
  const { tree, loading, error } = usePalaceDirectoryTree()
  return (
    <PalaceDirectoryTreeView
      tree={tree}
      currentPalaceId={currentPalaceId}
      loading={loading}
      error={error}
      onSelectPalace={onOpenPalace}
      onBindPalace={onBindPalace}
      palaceMenu={palaceMenu}
      chapterMenu={chapterMenu}
      subjectMenu={subjectMenu}
      bucketMenu={bucketMenu}
      onRenamePalace={onRenamePalace}
      onRenameChapter={onRenameChapter}
      onRenameSubject={onRenameSubject}
      className={className}
      viewStateKey={viewStateKey}
    />
  )
}
