import { useEffect, useState } from 'react'
import { getPalacesGroupedApi, getSubjectTreeApi } from '@/modules/content/public'
import { sanitizeFreestyleFeedConfig } from '@/modules/practice/domain/feedConfig'
import {
  buildFreestylePalaceScopeSubjects,
  type FreestylePalaceScopeSubject,
} from '@/modules/practice/ui/freestyle/model/freestyle-palace-scope'
import type { FreestyleFeedConfig, FreestyleTrainingStream } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { FreestylePalacePickerDialog } from './FreestylePalacePickerDialog'
import { FreestyleTrainingConfigForm } from './FreestyleTrainingConfigForm'

export function FreestyleFeedSettingsDialog({
  open,
  config,
  onOpenChange,
  onSave,
}: {
  open: boolean
  config: FreestyleFeedConfig
  onOpenChange: (open: boolean) => void
  onSave: (config: FreestyleFeedConfig) => void
}) {
  const [draft, setDraft] = useState(() => sanitizeFreestyleFeedConfig(config))
  const [scopeSubjects, setScopeSubjects] = useState<FreestylePalaceScopeSubject[]>([])
  const [pickerStream, setPickerStream] = useState<FreestyleTrainingStream | null>(null)

  useEffect(() => {
    if (open) setDraft(sanitizeFreestyleFeedConfig(config))
  }, [config, open])

  useEffect(() => {
    if (!open) return
    let active = true
    void getPalacesGroupedApi()
      .then(async (data) => {
        const subjectIds = (data.subjects ?? [])
          .map((item) => item.subject?.id)
          .filter((id): id is number => Boolean(id))
        if (active) setScopeSubjects(buildFreestylePalaceScopeSubjects(data))
        const trees = await Promise.all(subjectIds.map(async (id) => {
          try {
            return await getSubjectTreeApi(id)
          } catch {
            return null
          }
        }))
        const resolved = trees.filter((tree): tree is NonNullable<typeof tree> => Boolean(tree))
        if (active && resolved.length) setScopeSubjects(buildFreestylePalaceScopeSubjects(data, resolved))
      })
      .catch(() => {
        if (active) setScopeSubjects([])
      })
    return () => { active = false }
  }, [open])

  const updatePicker = (ids: number[]) => {
    if (!pickerStream) return
    setDraft((current) => sanitizeFreestyleFeedConfig({
      ...current,
      streams: {
        ...current.streams,
        [pickerStream]: {
          ...current.streams[pickerStream],
          specific_palace_ids: ids,
        },
      },
    }))
  }

  return (
    <>
      <Dialog open={open && pickerStream == null} onOpenChange={onOpenChange}>
        <DialogContent
          floatingId="freestyle-feed-settings"
          className="flex max-h-[min(92vh,100dvh-1rem)] w-[min(42rem,calc(100vw-1rem))] min-w-0 flex-col overflow-hidden rounded-2xl border-border/70 bg-background p-0 shadow-2xl"
        >
          <DialogHeader>
            <div className="min-w-0">
              <DialogTitle>随心模式设置</DialogTitle>
              <DialogDescription className="mt-1">先选训练方向，再配置这一轮要出现的内容。</DialogDescription>
            </div>
            <DialogClose onClick={() => onOpenChange(false)} />
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
            <FreestyleTrainingConfigForm
              config={draft}
              scopeSubjects={scopeSubjects}
              onChange={setDraft}
              onOpenPalacePicker={setPickerStream}
            />
          </div>

          <DialogFooter className="shrink-0 flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" className="min-h-11 w-full sm:min-h-9 sm:w-auto" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="button" className="min-h-11 w-full sm:min-h-9 sm:w-auto" onClick={() => { onSave(sanitizeFreestyleFeedConfig(draft)); onOpenChange(false) }}>保存并重排剩余队列</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FreestylePalacePickerDialog
        open={pickerStream != null}
        subjects={scopeSubjects}
        value={pickerStream ? draft.streams[pickerStream].specific_palace_ids : []}
        onOpenChange={(next) => { if (!next) setPickerStream(null) }}
        onConfirm={updatePicker}
      />
    </>
  )
}
