import type { DragEvent } from 'react'
import { cn } from '@/shared/lib/utils'
import type {
  DirectoryChapterNode,
  PalaceDirectoryTree as PalaceDirectoryTreeModel,
} from '../model/palaceDirectoryTree'

export const PALACE_DRAG_TYPE = 'application/x-memory-anki-palace'

/**
 * How far one palace has got inside the running round (随心):
 * 还没评分 → 有待重练 → 已评分完. Calendar due-ness is a different question and
 * lives on the badges, not on these dots.
 */
export type RoundPalaceStatus = 'unrated' | 'retry' | 'done'

/** Lowest first: a folded row answers with the least-advanced status below it. */
const ROUND_STATUS_RANK: Record<RoundPalaceStatus, number> = { unrated: 0, retry: 1, done: 2 }

export function lowerRoundStatus(a: RoundPalaceStatus, b: RoundPalaceStatus): RoundPalaceStatus {
  return ROUND_STATUS_RANK[a] <= ROUND_STATUS_RANK[b] ? a : b
}

/** Dot colour plus the words the hover title says; 蓝 → 琥珀 → 绿 as the round advances. */
const ROUND_STATUS_CHROME: Record<RoundPalaceStatus, { className: string; label: string }> = {
  unrated: { className: 'bg-info', label: '还没评分' },
  retry: { className: 'bg-warning', label: '有待重练' },
  done: { className: 'bg-success', label: '已评分完' },
}

interface QueueMarks {
  palaces: Map<number, RoundPalaceStatus>
  chapters: Map<number, RoundPalaceStatus>
  subjects: Map<number, RoundPalaceStatus>
  buckets: Map<string, RoundPalaceStatus>
}

const EMPTY_QUEUE_MARKS: QueueMarks = {
  palaces: new Map(),
  chapters: new Map(),
  subjects: new Map(),
  buckets: new Map(),
}

function raise(map: Map<number, RoundPalaceStatus>, id: number, status: RoundPalaceStatus) {
  const current = map.get(id)
  map.set(id, current ? lowerRoundStatus(current, status) : status)
}

/**
 * Which rows carry this round's cards, and how far each has got. A chapter,
 * subject or 未分类 bucket never says more than the least-advanced palace under
 * it, so one unrated palace keeps the whole folded branch blue.
 */
export function collectQueueMarks(
  tree: PalaceDirectoryTreeModel,
  queuedPalaces: ReadonlyMap<number, RoundPalaceStatus> | undefined,
): QueueMarks {
  if (!queuedPalaces?.size) return EMPTY_QUEUE_MARKS
  const marks: QueueMarks = { palaces: new Map(), chapters: new Map(), subjects: new Map(), buckets: new Map() }
  const walkChapter = (chapter: DirectoryChapterNode, subjectId: number): RoundPalaceStatus | null => {
    let status: RoundPalaceStatus | null = null
    for (const palace of chapter.palaces) {
      const palaceStatus = queuedPalaces.get(palace.id)
      if (!palaceStatus) continue
      raise(marks.palaces, palace.id, palaceStatus)
      status = status ? lowerRoundStatus(status, palaceStatus) : palaceStatus
    }
    for (const child of chapter.children) {
      const childStatus = walkChapter(child, subjectId)
      if (childStatus) status = status ? lowerRoundStatus(status, childStatus) : childStatus
    }
    if (status) {
      raise(marks.chapters, chapter.id, status)
      raise(marks.subjects, subjectId, status)
    }
    return status
  }
  for (const subject of tree.subjects) {
    for (const chapter of subject.chapters) walkChapter(chapter, subject.id)
    let ungroupedStatus: RoundPalaceStatus | null = null
    for (const palace of subject.ungrouped) {
      const palaceStatus = queuedPalaces.get(palace.id)
      if (!palaceStatus) continue
      raise(marks.palaces, palace.id, palaceStatus)
      raise(marks.subjects, subject.id, palaceStatus)
      ungroupedStatus = ungroupedStatus ? lowerRoundStatus(ungroupedStatus, palaceStatus) : palaceStatus
    }
    if (ungroupedStatus) marks.buckets.set(`subject:${subject.id}:ungrouped`, ungroupedStatus)
  }
  let rootStatus: RoundPalaceStatus | null = null
  for (const palace of tree.ungrouped) {
    const palaceStatus = queuedPalaces.get(palace.id)
    if (!palaceStatus) continue
    raise(marks.palaces, palace.id, palaceStatus)
    rootStatus = rootStatus ? lowerRoundStatus(rootStatus, palaceStatus) : palaceStatus
  }
  if (rootStatus) marks.buckets.set('root:ungrouped', rootStatus)
  return marks
}

/**
 * One dot for 「this round still reaches here」, coloured by how far the row has
 * got. Ancestors keep a fainter copy so a folded branch still shows its status
 * without competing with the palace rows underneath.
 */
export function QueueDot({
  status,
  label,
  faint = false,
}: {
  status: RoundPalaceStatus
  label: string
  faint?: boolean
}) {
  return (
    <span
      data-round-dot={faint ? 'ancestor' : 'palace'}
      data-round-status={status}
      title={label}
      aria-hidden
      className={cn('size-1.5 shrink-0 rounded-full', ROUND_STATUS_CHROME[status].className, faint && 'opacity-50')}
    />
  )
}

/** Spoken status of one row, e.g. 「本轮还没评分」/「这一章本轮有待重练」. */
export function roundStatusLabel(status: RoundPalaceStatus, scope: 'palace' | 'chapter' | 'subject' | 'bucket'): string {
  const where = scope === 'palace' ? '本轮' : scope === 'chapter' ? '这一章本轮' : scope === 'subject' ? '这个学科本轮' : '这一栏本轮'
  return `${where}${ROUND_STATUS_CHROME[status].label}`
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
