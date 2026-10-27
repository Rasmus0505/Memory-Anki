import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, FileText, LoaderCircle, Plus, Search } from 'lucide-react'
import { Input } from '@/shared/components/ui/input'
import { cn } from '@/shared/lib/utils'
import { usePalaceDirectoryTree } from '../hooks/usePalaceDirectoryTree'
import {
  expansionKeysForPalace,
  filterPalaceDirectoryTree,
  type DirectoryChapterNode,
  type DirectoryPalaceNode,
  type DirectorySubjectNode,
} from '../model/palaceDirectoryTree'

const PALACE_DRAG_TYPE = 'application/x-memory-anki-palace'
const INDENT_STEP = 14
const BASE_INDENT = 6

export interface PalaceDirectoryTreeProps {
  currentPalaceId: number | null
  onOpenPalace: (palaceId: number) => void
  /** Resolve a drop: `chapterId === null` means the 「未分类」 bucket. */
  onBindPalace: (palaceId: number, chapterId: number | null, subjectId: number | null) => void
  className?: string
}

function readDraggedPalaceId(event: DragEvent) {
  const raw = event.dataTransfer.getData(PALACE_DRAG_TYPE)
    || event.dataTransfer.getData('text/plain')
  const palaceId = Number(raw)
  return Number.isFinite(palaceId) && palaceId > 0 ? palaceId : null
}

export function PalaceDirectoryTree({
  currentPalaceId,
  onOpenPalace,
  onBindPalace,
  className,
}: PalaceDirectoryTreeProps) {
  const { tree, loading, error } = usePalaceDirectoryTree()
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [keyword, setKeyword] = useState('')
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const activeRowRef = useRef<HTMLButtonElement | null>(null)

  const filtered = useMemo(() => filterPalaceDirectoryTree(tree, keyword), [tree, keyword])
  // A search must reveal what it found: rows are folded by default, so keeping
  // the manual fold state here would hide every match behind a collapsed
  // subject/chapter and look like an empty result.
  const searching = keyword.trim().length > 0

  const toggle = useCallback((key: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // Opening a palace from anywhere (including the tree itself) reveals its path.
  useEffect(() => {
    if (currentPalaceId == null) return
    const keys = expansionKeysForPalace(tree, currentPalaceId)
    if (!keys.length) return
    setExpanded((current) => {
      if (keys.every((key) => current.has(key))) return current
      const next = new Set(current)
      for (const key of keys) next.add(key)
      return next
    })
  }, [tree, currentPalaceId])

  useEffect(() => {
    // jsdom (component tests) has no scrollIntoView.
    const row = activeRowRef.current
    if (typeof row?.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' })
  }, [currentPalaceId, expanded, filtered])

  const bindFromEvent = useCallback((
    event: DragEvent,
    chapterId: number | null,
    subjectId: number | null,
  ) => {
    event.preventDefault()
    setDragOverKey(null)
    const palaceId = readDraggedPalaceId(event)
    if (palaceId == null) return
    onBindPalace(palaceId, chapterId, subjectId)
  }, [onBindPalace])

  const dropTargetProps = (key: string, chapterId: number | null, subjectId: number | null) => ({
    onDragOver: (event: DragEvent) => {
      if (!event.dataTransfer.types.includes(PALACE_DRAG_TYPE)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setDragOverKey((current) => (current === key ? current : key))
    },
    onDragLeave: () => setDragOverKey((current) => (current === key ? null : current)),
    onDrop: (event: DragEvent) => bindFromEvent(event, chapterId, subjectId),
  })

  const renderPalace = (palace: DirectoryPalaceNode, depth: number) => {
    const active = palace.id === currentPalaceId
    return (
      <button
        key={`palace:${palace.id}`}
        type="button"
        ref={active ? activeRowRef : undefined}
        aria-current={active ? 'page' : undefined}
        aria-label={palace.title}
        title={palace.title}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData(PALACE_DRAG_TYPE, String(palace.id))
          event.dataTransfer.setData('text/plain', String(palace.id))
          event.dataTransfer.effectAllowed = 'move'
        }}
        onClick={() => onOpenPalace(palace.id)}
        className={cn(
          'group flex w-full items-center gap-1.5 rounded-md py-1 pr-1.5 text-left text-[13px] transition-colors',
          active
            ? 'bg-primary/10 font-medium text-foreground'
            : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
        )}
        style={{ paddingLeft: BASE_INDENT + depth * INDENT_STEP + 20 }}
      >
        <FileText className="size-3.5 shrink-0 opacity-60" aria-hidden />
        <span className="truncate">{palace.title}</span>
      </button>
    )
  }

  const renderChapter = (chapter: DirectoryChapterNode, depth: number) => {
    const key = `chapter:${chapter.id}`
    const isOpen = searching || expanded.has(key)
    return (
      <div key={key} className="min-w-0">
        <div
          {...dropTargetProps(key, chapter.id, chapter.subjectId)}
          className={cn(
            'flex items-center rounded-md transition-colors',
            dragOverKey === key ? 'bg-primary/10 ring-1 ring-primary/50' : 'hover:bg-muted/60',
          )}
        >
          <button
            type="button"
            onClick={() => toggle(key)}
            aria-expanded={isOpen}
            aria-label={`${isOpen ? '收起' : '展开'}${chapter.name}`}
            className="flex size-5 shrink-0 items-center justify-center text-muted-foreground"
            style={{ marginLeft: BASE_INDENT + depth * INDENT_STEP }}
          >
            <ChevronRight className={cn('size-3.5 transition-transform', isOpen && 'rotate-90')} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => toggle(key)}
            className="min-w-0 flex-1 truncate py-1 pr-1.5 text-left text-[13px] text-foreground/85"
          >
            {chapter.name}
          </button>
        </div>
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
    return (
      <div key={key} className="min-w-0">
        <div className="flex items-center rounded-md transition-colors hover:bg-muted/60">
          <button
            type="button"
            onClick={() => toggle(key)}
            aria-expanded={isOpen}
            aria-label={`${isOpen ? '收起' : '展开'}${label}`}
            className="flex size-5 shrink-0 items-center justify-center text-muted-foreground"
            style={{ marginLeft: BASE_INDENT + depth * INDENT_STEP }}
          >
            <ChevronRight className={cn('size-3.5 transition-transform', isOpen && 'rotate-90')} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => toggle(key)}
            className="min-w-0 flex-1 truncate py-1 pr-1.5 text-left text-[13px] text-muted-foreground"
          >
            {label}
          </button>
        </div>
        {isOpen ? palaces.map((palace) => renderPalace(palace, depth + 1)) : null}
      </div>
    )
  }

  const renderSubject = (subject: DirectorySubjectNode, depth: number) => {
    const key = `subject:${subject.id}`
    const isOpen = searching || expanded.has(key)
    return (
      <div key={key} className="min-w-0">
        <div className="flex items-center rounded-md transition-colors hover:bg-muted/60">
          <button
            type="button"
            onClick={() => toggle(key)}
            aria-expanded={isOpen}
            aria-label={`${isOpen ? '收起' : '展开'}${subject.name}`}
            className="flex size-5 shrink-0 items-center justify-center text-muted-foreground"
            style={{ marginLeft: BASE_INDENT + depth * INDENT_STEP }}
          >
            <ChevronRight className={cn('size-3.5 transition-transform', isOpen && 'rotate-90')} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => toggle(key)}
            className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-1.5 text-left text-[13px] font-medium text-foreground"
          >
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: subject.color }}
              aria-hidden
            />
            <span className="truncate">{subject.name}</span>
          </button>
        </div>
        {isOpen ? (
          <div className="min-w-0">
            {subject.chapters.map((chapter) => renderChapter(chapter, depth + 1))}
            {subject.ungrouped.length
              ? renderUngroupedBucket(
                `subject:${subject.id}:ungrouped`,
                '未分类',
                subject.ungrouped,
                depth + 1,
              )
              : null}
          </div>
        ) : null}
      </div>
    )
  }

  const hasAnySubject = filtered.subjects.length > 0
  const hasRootUngrouped = filtered.ungrouped.length > 0

  return (
    <div className={cn('flex h-full min-h-0 w-full flex-col gap-2 p-3', className)}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium tracking-wide text-muted-foreground">记忆宫殿</span>
        <Link
          to="/palaces/new"
          aria-label="新建宫殿"
          title="新建宫殿"
          className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-3.5" aria-hidden />
        </Link>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2 size-3.5 text-muted-foreground" aria-hidden />
        <Input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="搜索宫殿"
          aria-label="搜索宫殿"
          className="h-8 pl-8 text-[13px]"
        />
      </div>
      <div aria-label="宫殿目录" className="min-h-0 flex-1 overflow-y-auto">
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
            {keyword.trim()
              ? '没有匹配的宫殿。'
              : <>还没有学科。<Link to="/knowledge" className="text-primary hover:underline">去知识库建立学科</Link></>}
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
