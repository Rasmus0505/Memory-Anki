import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, ListChecks, RotateCcw } from 'lucide-react'
import type {
  FreestylePalaceScopeChapter,
  FreestylePalaceScopeSubject,
} from '@/modules/practice/ui/freestyle/model/freestyle-palace-scope'
import {
  allFreestylePalaceIdsFromSubjects,
  getFreestyleChapterSelection,
  toggleFreestylePalaceGroup,
} from '@/modules/practice/ui/freestyle/model/freestyle-palace-scope'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'

function TriStateCheckbox({
  state,
  onChange,
  label,
}: {
  state: 'checked' | 'indeterminate' | 'unchecked'
  onChange: () => void
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
      onChange={onChange}
      className="size-4 shrink-0 accent-primary"
    />
  )
}

function ChapterRow({
  chapter,
  selectedIds,
  onToggle,
  level,
}: {
  chapter: FreestylePalaceScopeChapter
  selectedIds: number[]
  onToggle: (ids: number[], checked: boolean) => void
  level: number
}) {
  const [expanded, setExpanded] = useState(true)
  const state = getFreestyleChapterSelection(chapter.palaceIds, selectedIds)
  return (
    <div className="space-y-1">
      <div className="flex min-h-10 items-center gap-2 rounded-lg px-2 py-1 hover:bg-muted/50" style={{ paddingLeft: `${8 + level * 18}px` }}>
        {chapter.children.length ? (
          <button type="button" className="inline-flex size-6 items-center justify-center rounded hover:bg-muted" onClick={() => setExpanded((value) => !value)} aria-label={expanded ? `收起${chapter.title}` : `展开${chapter.title}`}>
            {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        ) : <span className="size-6" />}
        <TriStateCheckbox state={state} onChange={() => onToggle(chapter.palaceIds, state !== 'checked')} label={`选择章节${chapter.title}`} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          <span className="mr-1.5 text-[11px] font-normal text-muted-foreground">章节</span>
          <span>{chapter.title}</span>
        </span>
        <span className="text-xs text-muted-foreground">{chapter.palaceIds.length} 个宫殿</span>
      </div>
      {expanded ? (
        <div className="space-y-1">
          {chapter.palaces.map((palace) => {
            const checked = selectedIds.includes(palace.id)
            return <label key={palace.id} className="flex min-h-9 items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-muted/50" style={{ paddingLeft: `${32 + level * 18}px` }}>
              <Checkbox checked={checked} onCheckedChange={(value) => onToggle([palace.id], value === true)} aria-label={`选择宫殿${palace.resolved_title || palace.title}`} />
              <span className="min-w-0 flex-1 truncate">
                <span className="mr-1.5 text-[11px] text-muted-foreground">宫殿</span>
                <span>{palace.resolved_title || palace.title}</span>
              </span>
            </label>
          })}
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
}: {
  subject: FreestylePalaceScopeSubject
  selectedIds: number[]
  onToggle: (ids: number[], checked: boolean) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const palaceIds = Array.from(new Set([
    ...subject.chapters.flatMap((chapter) => chapter.palaceIds),
    ...(subject.ungrouped?.palaceIds ?? []),
  ]))
  const state = getFreestyleChapterSelection(palaceIds, selectedIds)
  const hasChildren = subject.chapters.length > 0 || Boolean(subject.ungrouped)

  return (
    <section className="rounded-lg border border-border/70 bg-card/20 p-3">
      <div className="flex min-h-10 items-center gap-2 rounded-lg px-2 py-1 hover:bg-muted/50">
        {hasChildren ? (
          <button
            type="button"
            className="inline-flex size-6 items-center justify-center rounded hover:bg-muted"
            onClick={() => setExpanded((value) => !value)}
            aria-label={expanded ? `收起${subject.title}` : `展开${subject.title}`}
          >
            {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        ) : <span className="size-6" />}
        <TriStateCheckbox
          state={state}
          onChange={() => onToggle(palaceIds, state !== 'checked')}
          label={`选择学科${subject.title}`}
        />
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{subject.title}</h3>
        <span className="text-xs text-muted-foreground">{palaceIds.length} 个宫殿</span>
      </div>
      {expanded ? (
        <div className="mt-2 space-y-2">
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
            <div className="mt-2 rounded-lg border-t border-border/50 pt-2">
              <div className="mb-1 px-2 text-sm font-medium">{subject.ungrouped.title}</div>
              {subject.ungrouped.palaces.map((palace) => (
                <label
                  key={palace.id}
                  className="flex min-h-9 items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-muted/50"
                >
                  <Checkbox
                    checked={selectedIds.includes(palace.id)}
                    onCheckedChange={(checked) => onToggle([palace.id], checked === true)}
                    aria-label={`选择宫殿${palace.resolved_title || palace.title}`}
                  />
                  <span className="truncate">
                    <span className="mr-1.5 text-[11px] text-muted-foreground">宫殿</span>
                    <span>{palace.resolved_title || palace.title}</span>
                  </span>
                </label>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

export function FreestylePalacePickerDialog({
  open,
  subjects,
  value,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  subjects: FreestylePalaceScopeSubject[]
  value: number[]
  onOpenChange: (open: boolean) => void
  onConfirm: (ids: number[]) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { if (open) setDraft(value) }, [open, value])
  const allIds = allFreestylePalaceIdsFromSubjects(subjects)
  const toggle = (ids: number[], checked: boolean) => setDraft((current) => toggleFreestylePalaceGroup(current, ids, checked))
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent
      layout="centered"
      floating={false}
      showCloseButton
      dismissOnInteractOutside={false}
      className="flex max-h-[min(92vh,100dvh-2rem)] w-[min(68rem,calc(100vw-2rem))] max-w-none min-w-0 flex-col overflow-hidden rounded-xl border-border/70 bg-background p-0 shadow-2xl max-sm:max-h-[calc(100dvh-1rem)] max-sm:w-[calc(100vw-1rem)]"
    >
      <DialogHeader>
        <div className="min-w-0"><DialogTitle className="flex items-center gap-2"><ListChecks className="size-5 text-primary" />宫殿章节筛选</DialogTitle><DialogDescription className="mt-1">选择父章节会递归包含所有子章节和关联宫殿。</DialogDescription></div>
      </DialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-card/40 px-3 py-2">
          <span className="text-sm text-muted-foreground">已选 {draft.length} 个宫殿</span>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" aria-pressed={allIds.length > 0 && allIds.every((id) => draft.includes(id))} onClick={() => toggle(allIds, !(allIds.length > 0 && allIds.every((id) => draft.includes(id))))}>全选</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setDraft([])}><RotateCcw className="size-3.5" />清空</Button>
          </div>
        </div>
        <div className="space-y-4">
          {subjects.map((subject) => (
            <SubjectRow
              key={subject.key}
              subject={subject}
              selectedIds={draft}
              onToggle={toggle}
            />
          ))}
          {!subjects.length ? <div className="py-10 text-center text-sm text-muted-foreground">暂无可选宫殿</div> : null}
        </div>
      </div>
      <DialogFooter className="shrink-0 flex-col-reverse gap-2 sm:flex-row"><Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => onOpenChange(false)}>取消</Button><Button type="button" className="w-full sm:w-auto" onClick={() => { onConfirm(draft); onOpenChange(false) }}>确认选择</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
