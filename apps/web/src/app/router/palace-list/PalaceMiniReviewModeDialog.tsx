import * as React from 'react'
import type { MiniReviewMode, PalaceGroupedItem } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { cn } from '@/shared/lib/utils'

interface PalaceMiniReviewModeDialogProps {
  palace: PalaceGroupedItem | null
  saving?: boolean
  onClose: () => void
  onSave: (palaceId: number, mode: MiniReviewMode) => void
}

const MODE_OPTIONS: Array<{
  value: MiniReviewMode
  title: string
  description: string
}> = [
  {
    value: 'independent',
    title: '独立复习',
    description: '宫殿和小宫殿各自保留正式复习记录，列表里都会继续显示。',
  },
  {
    value: 'mini_only',
    title: '小宫殿接管复习',
    description: '有小宫殿时，列表和书架只关注小宫殿的正式复习，主宫殿记录保留但不再提示。',
  },
]

export function PalaceMiniReviewModeDialog({
  palace,
  saving = false,
  onClose,
  onSave,
}: PalaceMiniReviewModeDialogProps) {
  const open = palace !== null
  const [mode, setMode] = React.useState<MiniReviewMode>('independent')

  React.useEffect(() => {
    if (!palace) return
    setMode(palace.mini_review_mode ?? 'independent')
  }, [palace])

  const miniPalaceCount = palace?.mini_palaces?.length ?? 0

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>配置小宫殿复习归属</DialogTitle>
          <DialogClose onClick={onClose} />
        </DialogHeader>

        {palace ? (
          <div className="space-y-4 px-6 py-5">
            <div className="space-y-1">
              <div className="text-sm font-medium text-foreground">
                {palace.resolved_title || palace.title || '未命名宫殿'}
              </div>
              <div className="text-sm text-muted-foreground">
                {miniPalaceCount > 0
                  ? `当前已有 ${miniPalaceCount} 个小宫殿，这里决定书架和列表里谁来代表正式复习进度。`
                  : '当前还没有小宫殿，设置会在创建小宫殿后生效。'}
              </div>
            </div>

            <div className="grid gap-3">
              {MODE_OPTIONS.map((option) => {
                const active = mode === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={cn(
                      'rounded-2xl border px-4 py-4 text-left transition-colors',
                      active
                        ? 'border-sky-400 bg-sky-50 shadow-sm'
                        : 'border-border/70 bg-background/80 hover:bg-muted/40',
                    )}
                    onClick={() => setMode(option.value)}
                  >
                    <div className="text-sm font-semibold text-foreground">{option.title}</div>
                    <div className="mt-1 text-sm text-muted-foreground">{option.description}</div>
                  </button>
                )
              })}
            </div>

            <div className="flex items-center justify-end gap-3 border-t pt-4">
              <Button variant="outline" onClick={onClose} disabled={saving}>
                取消
              </Button>
              <Button
                onClick={() => onSave(palace.id, mode)}
                disabled={saving}
              >
                {saving ? '保存中...' : '保存配置'}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
