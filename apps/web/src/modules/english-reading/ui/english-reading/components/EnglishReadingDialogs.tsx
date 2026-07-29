import { LoaderCircle } from 'lucide-react'
import type {
  ReadingDifficultyDelta,
  ReadingDifficultyDirection,
} from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { cn } from '@/shared/lib/utils'

/**
 * Residual reading chrome: regenerate-difficulty dialog only.
 * Dictionary + sentence-translation UI removed in favor of english-lookup.
 */
export function EnglishReadingDialogs({
  regenerateDialogOpen,
  generating,
  regenerateDirection,
  regenerateDelta,
  readingDifficultyOptions,
  onCloseRegenerateDialog,
  onSetRegenerateDirection,
  onSetRegenerateDelta,
  onConfirmRegenerate,
  formatDifficultyDelta,
}: {
  regenerateDialogOpen: boolean
  generating: boolean
  regenerateDirection: ReadingDifficultyDirection
  regenerateDelta: ReadingDifficultyDelta
  readingDifficultyOptions: ReadonlyArray<ReadingDifficultyDelta>
  onCloseRegenerateDialog: () => void
  onSetRegenerateDirection: (direction: ReadingDifficultyDirection) => void
  onSetRegenerateDelta: (delta: ReadingDifficultyDelta) => void
  onConfirmRegenerate: () => void
  formatDifficultyDelta: (value: ReadingDifficultyDelta) => string
}) {
  return (
    <Dialog
      open={regenerateDialogOpen}
      onOpenChange={(open) => !generating && !open && onCloseRegenerateDialog()}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <div>
            <DialogTitle>重新生成内容</DialogTitle>
            <div className="mt-1 text-sm text-muted-foreground">
              本次会对当前整篇文章重新生成，不会只调整未读部分。
            </div>
          </div>
          <DialogClose onClick={onCloseRegenerateDialog} />
        </DialogHeader>
        <div className="space-y-5 px-6 py-5">
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                {
                  value: 'easier' as const,
                  title: '降低难度',
                  description: '把这篇文章调得更容易读进去。',
                },
                {
                  value: 'same' as const,
                  title: '重新生成',
                  description: '保持当前难度，刷新一版新的阅读稿。',
                },
                {
                  value: 'harder' as const,
                  title: '提升难度',
                  description: '把这篇文章调得更有挑战一些。',
                },
              ] as const
            ).map((option) => {
              const active = regenerateDirection === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={generating}
                  onClick={() => onSetRegenerateDirection(option.value)}
                  className={cn(
                    'rounded-lg border px-4 py-4 text-left transition-all',
                    active
                      ? 'border-primary bg-primary text-primary-foreground shadow-card'
                      : 'border-border/70 bg-background/80 hover:border-border hover:bg-background',
                    generating && 'cursor-not-allowed opacity-70',
                  )}
                >
                  <div className="text-sm font-semibold">{option.title}</div>
                  <div
                    className={cn(
                      'mt-2 text-xs leading-5',
                      active ? 'text-primary-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {option.description}
                  </div>
                </button>
              )
            })}
          </div>

          <div className="rounded-lg border border-border/70 bg-background/75 px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="reading-regenerate-delta" className="text-sm font-medium">
                难度变化幅度
              </Label>
              <span className="text-sm font-semibold text-primary">
                {formatDifficultyDelta(regenerateDelta)}
              </span>
            </div>
            <Input
              id="reading-regenerate-delta"
              type="range"
              min="0.5"
              max="2"
              step="0.5"
              value={regenerateDelta}
              disabled={generating}
              onChange={(event) =>
                onSetRegenerateDelta(
                  Number(event.currentTarget.value) as ReadingDifficultyDelta,
                )
              }
              className="mt-4"
            />
            <div className="mt-2 flex justify-between text-xs text-muted-foreground">
              {readingDifficultyOptions.map((option) => (
                <span key={option}>{option}</span>
              ))}
            </div>
            <div className="mt-3 text-xs text-muted-foreground">
              选择“重新生成”时会忽略这个幅度，并按当前难度刷新内容。
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 border-t px-6 py-4">
          <Button variant="outline" onClick={onCloseRegenerateDialog} disabled={generating}>
            取消
          </Button>
          <Button onClick={onConfirmRegenerate} disabled={generating}>
            {generating ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
            确认生成
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
