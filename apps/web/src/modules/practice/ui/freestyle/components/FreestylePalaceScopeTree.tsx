import { useEffect, useRef, useState, type MouseEvent } from 'react'
import type { PalaceGroupedItem } from '@/shared/api/contracts'
import { ChevronDown, ChevronRight, Star } from 'lucide-react'
import { useIsPalaceFavorite } from '@/modules/content/public'
import type {
  FreestylePalaceScopeChapter,
  FreestylePalaceScopeSubject,
} from '@/modules/practice/ui/freestyle/model/freestyle-palace-scope'
import { getFreestyleChapterSelection } from '@/modules/practice/ui/freestyle/model/freestyle-palace-scope'
import { cn } from '@/shared/lib/utils'

export type PalaceScopeToggle = (ids: number[], checked: boolean) => void

function TriStateCheckbox({
  state,
  onChange,
  onClick,
  label,
}: {
  state: 'checked' | 'indeterminate' | 'unchecked'
  onChange: () => void
  onClick?: (event: MouseEvent<HTMLInputElement>) => void
  label: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'indeterminate'
  }, [state])
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={state === 'checked'}
      aria-label={label}
      onClick={onClick}
      onChange={onChange}
      className="size-4 shrink-0 accent-primary"
    />
  )
}

function PalaceRow({
  palace,
  checked,
  onToggle,
  indentPx,
}: {
  palace: { id: number; title: string; resolved_title?: string | null }
  checked: boolean
  onToggle: PalaceScopeToggle
  indentPx?: number
}) {
  const title = palace.resolved_title || palace.title
  const favorite = useIsPalaceFavorite(palace.id)
  return (
    <div
      className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-muted/50"
      style={indentPx != null ? { paddingLeft: `${indentPx}px` } : undefined}
      onClick={() => onToggle([palace.id], !checked)}
    >
      <input
        type="checkbox"
        checked={checked}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => onToggle([palace.id], event.target.checked)}
        aria-label={`选择宫殿${title}`}
        className="size-4 shrink-0 accent-primary"
      />
      <span className="min-w-0 flex-1 truncate">
        <span>{title}</span>
        {favorite ? (
          <Star
            aria-label="已收藏"
            data-testid="palace-picker-favorite"
            className="ml-1 inline size-3 fill-current text-warning align-[-1px]"
          />
        ) : null}
      </span>
    </div>
  )
}

function flattenPalaces(chapter: FreestylePalaceScopeChapter): FreestylePalaceScopeChapter['palaces'] {
  return [...chapter.palaces, ...chapter.children.flatMap(flattenPalaces)]
}

function ChapterRow({
  chapter,
  selectedIds,
  onToggle,
  level,
}: {
  chapter: FreestylePalaceScopeChapter
  selectedIds: number[]
  onToggle: PalaceScopeToggle
  level: number
}) {
  const [expanded, setExpanded] = useState(true)
  const state = getFreestyleChapterSelection(chapter.palaceIds, selectedIds)
  // A chapter holding a single palace is the same choice as that palace: show one row, not two.
  if (chapter.palaceIds.length === 1) {
    const sole = chapter.palaces[0] ?? chapter.children.flatMap(flattenPalaces)[0]
    if (sole) {
      return (
        <PalaceRow
          palace={sole}
          checked={selectedIds.includes(sole.id)}
          onToggle={onToggle}
          indentPx={8 + level * 18 + 32}
        />
      )
    }
  }
  return (
    <div className="space-y-1">
      <div className="flex min-h-10 items-center gap-2 rounded-lg px-2 py-1 hover:bg-muted/50" style={{ paddingLeft: `${8 + level * 18}px` }}>
        {chapter.children.length ? (
          <button type="button" className="inline-flex size-6 items-center justify-center rounded hover:bg-muted" onClick={() => setExpanded((value) => !value)} aria-label={expanded ? `收起${chapter.title}` : `展开${chapter.title}`}>
            {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        ) : <span className="size-6" />}
        <div
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2"
          onClick={() => onToggle(chapter.palaceIds, state !== 'checked')}
        >
          <TriStateCheckbox
            state={state}
            onChange={() => onToggle(chapter.palaceIds, state !== 'checked')}
            label={`选择章节${chapter.title}`}
            onClick={(event) => event.stopPropagation()}
          />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{chapter.title}</span>
          <span className="text-xs text-muted-foreground">{chapter.palaceIds.length}</span>
        </div>
      </div>
      {expanded ? (
        <div className="space-y-1">
          {chapter.palaces.map((palace) => (
            <PalaceRow
              key={palace.id}
              palace={palace}
              checked={selectedIds.includes(palace.id)}
              onToggle={onToggle}
              indentPx={32 + level * 18}
            />
          ))}
          {chapter.children.map((child) => <ChapterRow key={child.key} chapter={child} selectedIds={selectedIds} onToggle={onToggle} level={level + 1} />)}
        </div>
      ) : null}
    </div>
  )
}

function SubjectRow({
  subject,
  selectedIds,
  onToggle,
  defaultExpanded,
}: {
  subject: FreestylePalaceScopeSubject
  selectedIds: number[]
  onToggle: PalaceScopeToggle
  defaultExpanded: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const palaceIds = subjectPalaceIds(subject)
  const state = getFreestyleChapterSelection(palaceIds, selectedIds)
  const hasChildren = subject.chapters.length > 0 || Boolean(subject.ungrouped)

  return (
    <section className="rounded-lg border border-border/60 bg-background/40">
      <div className="flex min-h-11 items-center gap-2 rounded-lg px-2 py-1">
        {hasChildren ? (
          <button
            type="button"
            className="inline-flex size-7 items-center justify-center rounded-md hover:bg-muted"
            onClick={() => setExpanded((value) => !value)}
            aria-label={expanded ? `收起${subject.title}` : `展开${subject.title}`}
          >
            {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        ) : <span className="size-7" />}
        <div
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2"
          onClick={() => onToggle(palaceIds, state !== 'checked')}
        >
          <TriStateCheckbox
            state={state}
            onChange={() => onToggle(palaceIds, state !== 'checked')}
            label={`选择学科${subject.title}`}
            onClick={(event) => event.stopPropagation()}
          />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{subject.title}</span>
          <span className="text-xs tabular-nums text-muted-foreground">{palaceIds.length} 座</span>
        </div>
      </div>
      {expanded ? (
        <div className="space-y-1 px-2 pb-2 pt-0.5">
          {subject.chapters.map((chapter) => (
            <ChapterRow
              key={chapter.key}
              chapter={chapter}
              selectedIds={selectedIds}
              onToggle={onToggle}
              level={0}
            />
          ))}
          {subject.ungrouped ? (
            <div className="mt-2 border-t border-border/50 pt-2">
              <div className="mb-1 px-2 text-xs font-medium text-muted-foreground">{subject.ungrouped.title}</div>
              {subject.ungrouped.palaces.map((palace) => (
                <PalaceRow
                  key={palace.id}
                  palace={palace}
                  checked={selectedIds.includes(palace.id)}
                  onToggle={onToggle}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function subjectPalaceIds(subject: FreestylePalaceScopeSubject): number[] {
  return Array.from(new Set([
    ...subject.chapters.flatMap((chapter) => chapter.palaceIds),
    ...(subject.ungrouped?.palaceIds ?? []),
  ]))
}

/** Every palace under the subject tree, once each, including nested chapters. */
export function palacesInSubjects(subjects: FreestylePalaceScopeSubject[]): PalaceGroupedItem[] {
  const byId = new Map<number, PalaceGroupedItem>()
  const walk = (chapters: FreestylePalaceScopeChapter[]) => {
    chapters.forEach((chapter) => {
      chapter.palaces.forEach((palace) => byId.set(palace.id, palace))
      walk(chapter.children)
    })
  }
  subjects.forEach((subject) => {
    walk(subject.chapters)
    subject.ungrouped?.palaces.forEach((palace) => byId.set(palace.id, palace))
  })
  return [...byId.values()]
}

/** Palaces with at least one unit due for review. 只选到期 selects exactly these. */
export function duePalaceIdsFromSubjects(subjects: FreestylePalaceScopeSubject[]): number[] {
  return palacesInSubjects(subjects)
    .filter((palace) => palace.due_review_unit_count > 0)
    .map((palace) => palace.id)
}

/**
 * 学科 → 章节 → 宫殿, with a tri-state checkbox on every level. The same tree
 * serves the picker dialog and the inline bookshelf in 随心配置, so a fold
 * choice and a half-selected chapter mean the same thing in both places.
 */
export function FreestylePalaceScopeTree({
  subjects,
  selectedIds,
  onToggle,
  defaultExpanded = true,
  className,
}: {
  subjects: FreestylePalaceScopeSubject[]
  selectedIds: number[]
  onToggle: PalaceScopeToggle
  /** The picker opens every subject; the inline bookshelf starts folded. */
  defaultExpanded?: boolean
  className?: string
}) {
  if (!subjects.length) {
    return <div className="py-10 text-center text-sm text-muted-foreground">暂无可选宫殿</div>
  }
  return (
    <div className={cn('space-y-1.5', className)}>
      {subjects.map((subject) => (
        <SubjectRow
          key={subject.key}
          subject={subject}
          selectedIds={selectedIds}
          onToggle={onToggle}
          defaultExpanded={defaultExpanded}
        />
      ))}
    </div>
  )
}
