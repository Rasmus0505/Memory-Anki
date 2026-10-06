import { useEffect, useMemo, useRef, useState } from 'react'
import { getPalacesGroupedApi } from '@/modules/content/public'
import type { PalaceGroupedItem, PalaceGroupedListResponse } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import { useConfirmEnter } from '@/shared/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'

export type QuizProgressClearScope = 'question' | 'palace' | 'all'

export interface QuizProgressClearChoice {
  scope: QuizProgressClearScope
  palaceId: number | null
}

interface PalaceOption {
  id: number
  title: string
}

function palaceTitle(palace: Pick<PalaceGroupedItem, 'id' | 'resolved_title' | 'title'>) {
  return palace.resolved_title || palace.title || `宫殿 ${palace.id}`
}

function collectPalaceOptions(data: PalaceGroupedListResponse): PalaceOption[] {
  const seen = new Set<number>()
  const list: PalaceOption[] = []
  const push = (palace: Pick<PalaceGroupedItem, 'id' | 'resolved_title' | 'title'> | null | undefined) => {
    const id = Number(palace?.id)
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) return
    seen.add(id)
    list.push({ id, title: palaceTitle(palace!) })
  }
  for (const group of data.groups || []) {
    for (const palace of group.palaces || []) push(palace)
  }
  for (const palace of data.ungrouped || []) push(palace)
  for (const subject of data.subjects || []) {
    for (const group of subject.chapter_groups || []) {
      for (const palace of group.palaces || []) push(palace)
    }
    for (const palace of subject.ungrouped_palaces || []) push(palace)
  }
  return list
}

export function QuizProgressClearDialog({
  open,
  onOpenChange,
  questionReady,
  defaultPalaceId,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  questionReady: boolean
  defaultPalaceId: number | null
  onConfirm: (choice: QuizProgressClearChoice) => void
}) {
  const [scope, setScope] = useState<QuizProgressClearScope>('question')
  const [palaces, setPalaces] = useState<PalaceOption[]>([])
  const [selectedPalaceId, setSelectedPalaceId] = useState<number | null>(defaultPalaceId)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setScope(questionReady ? 'question' : 'palace')
    setSelectedPalaceId(defaultPalaceId)
  }, [defaultPalaceId, open, questionReady])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void getPalacesGroupedApi()
      .then((data) => {
        if (!cancelled) setPalaces(collectPalaceOptions(data))
      })
      .catch(() => {
        if (!cancelled) setPalaces([])
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const options = useMemo(() => {
    if (defaultPalaceId != null && !palaces.some((item) => item.id === defaultPalaceId)) {
      return [{ id: defaultPalaceId, title: '当前宫殿' }, ...palaces]
    }
    return palaces
  }, [defaultPalaceId, palaces])

  const palaceId = selectedPalaceId ?? options[0]?.id ?? null
  const canConfirm = scope === 'question'
    ? questionReady
    : scope === 'palace'
      ? palaceId != null
      : true

  const confirm = () => {
    if (!canConfirm) return
    onConfirm({
      scope,
      palaceId: scope === 'palace' ? palaceId : null,
    })
    onOpenChange(false)
  }
  useConfirmEnter(open, panelRef, confirm)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={panelRef}
        className="max-w-md"
        floatingId="quiz-progress-clear"
        data-confirm-dialog={open ? 'open' : undefined}
      >
        <DialogHeader>
          <DialogTitle>清除做题进度</DialogTitle>
          <DialogDescription>
            选择范围。题目保留，作答次数也不变。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <label className="flex items-start gap-2">
            <input
              type="radio"
              className="mt-1"
              name="quiz-progress-clear-scope"
              aria-label="当前题"
              checked={scope === 'question'}
              disabled={!questionReady}
              onChange={() => setScope('question')}
            />
            <span>
              <span className="font-medium">当前题</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">只清除正在看的这道题。</span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              className="mt-1"
              name="quiz-progress-clear-scope"
              aria-label="指定宫殿"
              checked={scope === 'palace'}
              onChange={() => setScope('palace')}
            />
            <span className="min-w-0 flex-1">
              <span className="font-medium">指定宫殿</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">清除所选宫殿里的已答记录。</span>
              {scope === 'palace' ? (
                <select
                  aria-label="指定宫殿"
                  className="mt-2 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={palaceId ?? ''}
                  onChange={(event) => setSelectedPalaceId(Number(event.target.value))}
                >
                  {options.length === 0 ? <option value="">没有可选宫殿</option> : null}
                  {options.map((palace) => (
                    <option key={palace.id} value={palace.id}>{palace.title}</option>
                  ))}
                </select>
              ) : null}
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              className="mt-1"
              name="quiz-progress-clear-scope"
              aria-label="全部题"
              checked={scope === 'all'}
              onChange={() => setScope('all')}
            />
            <span>
              <span className="font-medium">全部题</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">清除所有题目的已答记录。</span>
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button variant="destructive" disabled={!canConfirm} onClick={confirm}>清除</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
