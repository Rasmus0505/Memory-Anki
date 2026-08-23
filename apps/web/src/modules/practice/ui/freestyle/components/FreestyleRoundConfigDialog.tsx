import { useEffect, useState } from 'react'
import { Save, SlidersHorizontal } from 'lucide-react'
import { getPalacesGroupedApi, getSubjectTreeApi } from '@/modules/content/public'
import {
  applyFreestyleQuickPreset,
  FREESTYLE_QUICK_PRESETS,
  sanitizeFreestyleFeedConfig,
  type FreestyleQuickPresetId,
} from '@/modules/practice/domain/feedConfig'
import { flattenPalaceOptions } from '@/modules/practice/ui/freestyle/model/freestyle-cards'
import {
  buildFreestylePalaceScopeSubjects,
  type FreestylePalaceScopeSubject,
} from '@/modules/practice/ui/freestyle/model/freestyle-palace-scope'
import { FreestylePalacePickerDialog } from './FreestylePalacePickerDialog'
import { FreestyleTrainingConfigForm } from './FreestyleTrainingConfigForm'
import type {
  FreestyleFeedConfig,
  FreestylePalaceContext,
  FreestyleTrainingStream,
} from '@/shared/api/contracts'
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

/**
 * Between-rounds decision, on its own surface. Sharing a dialog with the in-round
 * plan list forced a 76rem two-column layout that collapsed into one long scroll
 * on a phone, and mixed a 1-second glance with a slow deliberate edit.
 */
export function FreestyleRoundConfigDialog({
  open,
  config,
  onOpenChange,
  onSaveConfig,
}: {
  open: boolean
  config: FreestyleFeedConfig
  onOpenChange: (open: boolean) => void
  onSaveConfig: (config: FreestyleFeedConfig) => void
}) {
  const [draft, setDraft] = useState(() => sanitizeFreestyleFeedConfig(config))
  const [palaces, setPalaces] = useState<FreestylePalaceContext[]>([])
  const [scopeSubjects, setScopeSubjects] = useState<FreestylePalaceScopeSubject[]>([])
  const [pickerStream, setPickerStream] = useState<FreestyleTrainingStream | null>(null)

  useEffect(() => {
    if (!open) setPickerStream(null)
  }, [open])

  useEffect(() => {
    if (open) setDraft(sanitizeFreestyleFeedConfig(config))
  }, [config, open])

  useEffect(() => {
    if (!open) return
    let active = true
    void getPalacesGroupedApi().then(async (value) => {
      const subjectIds = (value.subjects ?? [])
        .map((item) => item.subject?.id)
        .filter((id): id is number => Boolean(id))
      if (active) {
        setPalaces(flattenPalaceOptions(value))
        setScopeSubjects(buildFreestylePalaceScopeSubjects(value))
      }
      const trees = typeof getSubjectTreeApi === 'function'
        ? await Promise.all(
            subjectIds.map(async (id) => {
              try {
                return await getSubjectTreeApi(id)
              } catch {
                return null
              }
            }),
          )
        : []
      const resolvedTrees = trees.filter((tree): tree is NonNullable<typeof tree> => Boolean(tree))
      if (active && resolvedTrees.length > 0) {
        setScopeSubjects(buildFreestylePalaceScopeSubjects(value, resolvedTrees))
      }
    }).catch(() => {
      if (active) {
        setPalaces([])
        setScopeSubjects([])
      }
    })
    return () => { active = false }
  }, [open])

  const applyQuickPreset = (presetId: FreestyleQuickPresetId) => {
    setDraft((current) => applyFreestyleQuickPreset(current, presetId, palaces))
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          floatingId="freestyle-round-config"
          data-testid="freestyle-round-config-dialog"
          className="flex max-h-[min(70dvh,100dvh-2rem)] w-[min(34rem,calc(100vw-1rem))] min-w-0 flex-col overflow-hidden rounded-2xl border-border/70 bg-background p-0 shadow-2xl"
        >
          <DialogHeader>
            <div className="min-w-0">
              <DialogTitle className="flex items-center gap-2">
                <SlidersHorizontal className="size-5 text-primary" />随心配置
              </DialogTitle>
              <DialogDescription>
                保存后重排尚未开始的卡片，保留本轮已完成和已排除状态。
              </DialogDescription>
            </div>
            <DialogClose onClick={() => onOpenChange(false)} />
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
            <section className="mb-3 space-y-2 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3">
              <div>
                <div className="text-sm font-semibold">快捷预设</div>
                <div className="text-xs leading-5 text-muted-foreground">
                  一键切换本轮要刷的内容范围。
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {FREESTYLE_QUICK_PRESETS.map((preset) => (
                  <Button
                    key={preset.id}
                    type="button"
                    variant="outline"
                    className="h-auto min-h-14 justify-start px-3 py-2 text-left"
                    onClick={() => applyQuickPreset(preset.id)}
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{preset.label}</span>
                      <span className="block truncate text-[11px] font-normal text-muted-foreground">
                        {preset.description}
                      </span>
                    </span>
                  </Button>
                ))}
              </div>
            </section>
            <FreestyleTrainingConfigForm
              config={draft}
              scopeSubjects={scopeSubjects}
              onOpenPalacePicker={setPickerStream}
              onChange={setDraft}
            />
          </div>

          <DialogFooter className="shrink-0 flex-col-reverse gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => onOpenChange(false)}
            >
              关闭
            </Button>
            <Button
              type="button"
              className="w-full sm:w-auto"
              onClick={() => {
                onSaveConfig(sanitizeFreestyleFeedConfig(draft))
                onOpenChange(false)
              }}
            >
              <Save className="size-4" />保存配置并重排
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <FreestylePalacePickerDialog
        open={pickerStream != null}
        subjects={scopeSubjects}
        value={pickerStream ? draft.streams[pickerStream].specific_palace_ids : []}
        onOpenChange={(next) => { if (!next) setPickerStream(null) }}
        onConfirm={(ids) => {
          if (!pickerStream) return
          const next = sanitizeFreestyleFeedConfig({
            ...draft,
            streams: {
              ...draft.streams,
              [pickerStream]: {
                ...draft.streams[pickerStream],
                specific_palace_ids: ids,
              },
            },
          })
          setDraft(next)
          setPickerStream(null)
          onSaveConfig(next)
        }}
      />
    </>
  )
}
