import { useEffect, useState } from 'react'
import { ListChecks, RotateCcw } from 'lucide-react'
import {
  allFreestylePalaceIdsFromSubjects,
  toggleFreestylePalaceGroup,
  type FreestylePalaceScopeSubject,
} from '@/modules/practice/ui/freestyle/model/freestyle-palace-scope'
import {
  duePalaceIdsFromSubjects,
  FreestylePalaceScopeTree,
  palacesInSubjects,
} from './FreestylePalaceScopeTree'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'

/** Flips every listed palace. Selected ids outside the list stay as they were. */
function invertPalaceSelection(current: number[], ids: number[]): number[] {
  const listed = new Set(ids)
  const selected = new Set(current)
  const kept = current.filter((id) => !listed.has(id))
  const flipped = ids.filter((id) => !selected.has(id))
  return [...kept, ...flipped]
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
  useEffect(() => {
    if (!open) return
    setDraft(value)
    // Open only: parent recreates `value` on each render and when trees load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  const allIds = allFreestylePalaceIdsFromSubjects(subjects)
  const allSelected = allIds.length > 0 && allIds.every((id) => draft.includes(id))
  const dueIds = duePalaceIdsFromSubjects(subjects)
  const dueOnlySelected = dueIds.length > 0
    && dueIds.every((id) => draft.includes(id))
    && draft.length === dueIds.length
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
          <span className="text-sm text-muted-foreground">已选 {draft.length} 个宫殿 · 可选 {palacesInSubjects(subjects).length} 座</span>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" aria-pressed={allSelected} onClick={() => toggle(allIds, !allSelected)}>全选</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setDraft((current) => invertPalaceSelection(current, allIds))}>反选</Button>
            <Button type="button" size="sm" variant="outline" aria-pressed={dueOnlySelected} disabled={!dueIds.length} onClick={() => setDraft(dueIds)}>只选到期</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setDraft([])}><RotateCcw className="size-3.5" />清空</Button>
          </div>
        </div>
        <FreestylePalaceScopeTree
          subjects={subjects}
          selectedIds={draft}
          onToggle={toggle}
        />
      </div>
      <DialogFooter className="shrink-0 flex-col-reverse gap-2 sm:flex-row"><Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => onOpenChange(false)}>取消</Button><Button type="button" className="w-full sm:w-auto" onClick={() => { onConfirm(draft); onOpenChange(false) }}>确认选择</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
