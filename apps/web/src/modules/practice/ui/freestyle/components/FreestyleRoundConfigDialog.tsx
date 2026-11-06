import { useEffect, useState } from 'react'
import { Archive, Save, SlidersHorizontal } from 'lucide-react'
import { getPalacesGroupedApi, getSubjectTreeApi } from '@/modules/content/public'
import { sanitizeFreestyleFeedConfig } from '@/modules/practice/domain/feedConfig'
import {
  buildFreestylePalaceScopeSubjects,
  type FreestylePalaceScopeSubject,
} from '@/modules/practice/ui/freestyle/model/freestyle-palace-scope'
import {
  OVERLAP_PROGRESS_PROMPT_TITLE,
  overlapProgressPromptCopy,
  type FreestyleConfigSaveChoice,
} from '@/modules/practice/ui/freestyle/model/overlapProgressChoice'
import { FreestyleTrainingConfigForm, summarizeRoundConfig } from './FreestyleTrainingConfigForm'
import type { FreestyleFeedConfig } from '@/shared/api/contracts'
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
  mode = 'replan',
  scopeLocked = false,
  settlementCount = 0,
  onSettleCompleted,
}: {
  open: boolean
  config: FreestyleFeedConfig
  onOpenChange: (open: boolean) => void
  onSaveConfig: (config: FreestyleFeedConfig, choice?: FreestyleConfigSaveChoice) => void
  /** Settlement 「再来一轮」 uses nextRound; in-round HUD uses replan. */
  mode?: 'replan' | 'nextRound'
  /** Single-palace review cannot widen the round to other palaces. */
  scopeLocked?: boolean
  /** Cards already rated and ready to settle out of this round. */
  settlementCount?: number
  onSettleCompleted?: () => void
}) {
  const [draft, setDraft] = useState(() => sanitizeFreestyleFeedConfig(config))
  const [pendingSave, setPendingSave] = useState<FreestyleFeedConfig | null>(null)
  const [scopeSubjects, setScopeSubjects] = useState<FreestylePalaceScopeSubject[]>([])

  useEffect(() => {
    if (!open) setPendingSave(null)
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
        setScopeSubjects([])
      }
    })
    return () => { active = false }
  }, [open])

  // 随心 is the memory-palace feed. 刷题 lives in the 做题 window, so a save
  // never carries a quiz or mixed stream no matter what an old config said.
  const palaceOnly = (value: FreestyleFeedConfig) => sanitizeFreestyleFeedConfig({
    ...value,
    training_mode: 'memory_palace',
    mixed_modes: ['memory_palace'],
  })

  const commitSave = (choice?: FreestyleConfigSaveChoice) => {
    const next = palaceOnly(pendingSave ?? draft)
    onSaveConfig(next, choice)
    setPendingSave(null)
    onOpenChange(false)
  }

  const requestSave = () => {
    const next = palaceOnly(draft)
    if (mode === 'nextRound') {
      commitSave()
      return
    }
    setPendingSave(next)
  }

  const cancelOverlapPrompt = () => {
    setPendingSave(null)
  }

  const summaryRows = summarizeRoundConfig(draft, scopeSubjects)

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          floatingId="freestyle-round-config"
          data-testid="freestyle-round-config-dialog"
          className="flex max-h-[min(88dvh,100dvh-1.5rem)] w-[min(56rem,calc(100vw-1rem))] min-w-0 flex-col overflow-hidden rounded-2xl border-border/70 bg-background p-0 shadow-2xl"
        >
          <DialogHeader>
            <div className="min-w-0">
              <DialogTitle className="flex items-center gap-2">
                <SlidersHorizontal className="size-5 text-primary" />随心配置
              </DialogTitle>
              <DialogDescription>
                {mode === 'nextRound'
                  ? '确认后开始全新一轮：按当前配置重新生成队列，并清空本轮做题进度。'
                  : '保存后会询问是否保留和新配置重复的进度。保留则继续这一轮，只重排还没开始的卡片。'}
              </DialogDescription>
            </div>
            <DialogClose onClick={() => onOpenChange(false)} />
          </DialogHeader>

          <dl
            data-testid="freestyle-config-summary"
            aria-label="本轮将这样出题"
            className="grid shrink-0 grid-cols-1 gap-x-4 gap-y-1.5 border-b border-border/60 bg-muted/30 px-4 py-3 text-sm sm:grid-cols-[auto_1fr] sm:px-5"
          >
            {summaryRows.map((row) => (
              <div key={row.label} className="contents">
                <dt className="font-medium text-muted-foreground sm:text-right">{row.label}</dt>
                <dd className="min-w-0 text-foreground">{row.value}</dd>
              </div>
            ))}
          </dl>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
            <FreestyleTrainingConfigForm
              config={draft}
              scopeSubjects={scopeSubjects}
              onChange={setDraft}
              scopeLocked={scopeLocked}
            />
          </div>

          <DialogFooter className="shrink-0 flex-col-reverse gap-2 sm:flex-row">
            {onSettleCompleted ? (
              <Button
                type="button"
                variant="outline"
                className="w-full sm:mr-auto sm:w-auto"
                disabled={settlementCount === 0}
                onClick={onSettleCompleted}
              >
                <Archive className="size-4" />
                {settlementCount ? `结算已完成 ${settlementCount}` : '没有可结算的'}
              </Button>
            ) : null}
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
              onClick={requestSave}
            >
              <Save className="size-4" />
              {mode === 'nextRound' ? '开始下一轮' : '保存配置并重排'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {pendingSave != null && mode !== 'nextRound' ? (
        <Dialog open onOpenChange={(next) => { if (!next) cancelOverlapPrompt() }}>
          <DialogContent
            floatingId="freestyle-overlap-progress"
            data-testid="freestyle-overlap-progress-dialog"
            className="flex w-[min(28rem,calc(100vw-1rem))] min-w-0 flex-col overflow-hidden rounded-2xl border-border/70 bg-background p-0 shadow-2xl"
          >
            <DialogHeader>
              <div className="min-w-0">
                <DialogTitle>{OVERLAP_PROGRESS_PROMPT_TITLE}</DialogTitle>
                <DialogDescription>{overlapProgressPromptCopy()}</DialogDescription>
              </div>
              <DialogClose onClick={cancelOverlapPrompt} />
            </DialogHeader>
            <DialogFooter className="shrink-0 flex-col-reverse gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => commitSave('keep-overlap')}
              >
                保留，继续这一轮
              </Button>
              <Button
                type="button"
                className="w-full sm:w-auto"
                onClick={() => commitSave('start-fresh')}
              >
                不保留，开启新一轮
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
