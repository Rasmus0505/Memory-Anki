import { BookOpen, Copy, LoaderCircle, RotateCcw, Shuffle } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'

/**
 * Right-side actions of the 做题 overlay header. Kept out of the dialog so the
 * answering chrome stays below the architecture file-size limit.
 */
export function FreestyleScopeQuizHeaderActions({
  copyPalaceId,
  lookupPalaceId,
  copyingOutline,
  onCopyOutline,
  onOpenPalace,
  canShuffle,
  shuffling,
  onShuffle,
  onOpenClearProgress,
}: {
  /** Palace whose mind map 复制导图 reads; usually the current question's palace. */
  copyPalaceId: number | null
  /** Palace 查看宫殿 opens (may be a bound palace override). */
  lookupPalaceId: number | null
  copyingOutline: boolean
  onCopyOutline: (palaceId: number) => void
  onOpenPalace: () => void
  /** Only a multi-question pool has an order to shuffle. */
  canShuffle: boolean
  shuffling: boolean
  onShuffle: () => void
  onOpenClearProgress: () => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      {copyPalaceId != null ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label="复制导图"
          title="复制导图的文字层级，可粘贴给 AI 作为作答背景"
          disabled={copyingOutline}
          onClick={() => onCopyOutline(copyPalaceId)}
        >
          {copyingOutline ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Copy className="size-4" />
          )}
          <span className="hidden sm:inline">复制导图</span>
        </Button>
      ) : null}
      {lookupPalaceId != null ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label="查看宫殿"
          title="查看宫殿和思维导图"
          onClick={onOpenPalace}
        >
          <BookOpen className="size-4" />
          查看宫殿
        </Button>
      ) : null}
      {canShuffle ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label="打乱题库"
          title="只打乱还没答的题，已答的题留在原位"
          disabled={shuffling}
          onClick={onShuffle}
        >
          {shuffling ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Shuffle className="size-4" />
          )}
          <span className="hidden sm:inline">打乱题库</span>
        </Button>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label="清除进度"
        title="清除当前题、指定宫殿或全部题的已答记录"
        onClick={onOpenClearProgress}
      >
        <RotateCcw className="size-4" />
        清除进度
      </Button>
    </div>
  )
}
