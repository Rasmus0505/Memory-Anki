import type { DragEvent } from 'react'
import { cn } from '@/shared/lib/utils'
import type {
  DirectoryChapterNode,
  PalaceDirectoryTree as PalaceDirectoryTreeModel,
} from '../model/palaceDirectoryTree'

export const PALACE_DRAG_TYPE = 'application/x-memory-anki-palace'

interface QueueMarks {
  palaces: Set<number>
  chapters: Set<number>
  subjects: Set<number>
  buckets: Set<string>
}

const EMPTY_QUEUE_MARKS: QueueMarks = {
  palaces: new Set(),
  chapters: new Set(),
  subjects: new Set(),
  buckets: new Set(),
}

/** Which rows carry this round's cards, at each depth of the tree. */
export function collectQueueMarks(
  tree: PalaceDirectoryTreeModel,
  queuedPalaceIds: ReadonlySet<number> | undefined,
): QueueMarks {
  if (!queuedPalaceIds?.size) return EMPTY_QUEUE_MARKS
  const marks: QueueMarks = { palaces: new Set(), chapters: new Set(), subjects: new Set(), buckets: new Set() }
  const walkChapter = (chapter: DirectoryChapterNode, subjectId: number): boolean => {
    let marked = false
    for (const palace of chapter.palaces) {
      if (!queuedPalaceIds.has(palace.id)) continue
      marks.palaces.add(palace.id)
      marked = true
    }
    for (const child of chapter.children) {
      if (walkChapter(child, subjectId)) marked = true
    }
    if (marked) {
      marks.chapters.add(chapter.id)
      marks.subjects.add(subjectId)
    }
    return marked
  }
  for (const subject of tree.subjects) {
    for (const chapter of subject.chapters) walkChapter(chapter, subject.id)
    for (const palace of subject.ungrouped) {
      if (!queuedPalaceIds.has(palace.id)) continue
      marks.palaces.add(palace.id)
      marks.subjects.add(subject.id)
      marks.buckets.add(`subject:${subject.id}:ungrouped`)
    }
  }
  for (const palace of tree.ungrouped) {
    if (!queuedPalaceIds.has(palace.id)) continue
    marks.palaces.add(palace.id)
    marks.buckets.add('root:ungrouped')
  }
  return marks
}

/** One dot for 「this round has cards here」; the palette keeps it apart from due badges. */
export function QueueDot({ label, faint = false }: { label: string; faint?: boolean }) {
  return (
    <span
      data-round-dot={faint ? 'ancestor' : 'palace'}
      title={label}
      aria-hidden
      className={cn('size-1.5 shrink-0 rounded-full bg-success', faint && 'opacity-50')}
    />
  )
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function Highlighted({ text, query }: { text: string; query?: string }) {
  const needle = query?.trim()
  if (!needle) return <>{text}</>
  const lower = needle.toLocaleLowerCase()
  return (
    <>
      {text.split(new RegExp(`(${escapeRegExp(needle)})`, 'gi')).map((part, index) => (
        part.toLocaleLowerCase() === lower
          ? <mark key={index} className="rounded-sm bg-warning/25 px-0.5 text-inherit">{part}</mark>
          : part ? <span key={index}>{part}</span> : null
      ))}
    </>
  )
}

export function readDraggedPalaceId(event: DragEvent) {
  const raw = event.dataTransfer.getData(PALACE_DRAG_TYPE)
    || event.dataTransfer.getData('text/plain')
  const palaceId = Number(raw)
  return Number.isFinite(palaceId) && palaceId > 0 ? palaceId : null
}
