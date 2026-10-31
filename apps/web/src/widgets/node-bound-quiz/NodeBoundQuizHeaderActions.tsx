import { BookOpen, Copy, FileText, LoaderCircle, RotateCcw, Shuffle } from 'lucide-react'
import { useCopyQuizQuestionsText } from '@/modules/quiz/public'
import type { PalaceQuizQuestion } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'

/**
 * Right-side actions of the 关联题目 window. Kept out of the dialog so the
 * answering chrome stays below the architecture file-size limit.
 */
export function NodeBoundQuizHeaderActions({
  palaceId,
  questions,
  copyingOutline,
  onCopyOutline,
  onOpenPalace,
  canShuffle,
  shuffling = false,
  onShuffle,
  onOpenClearProgress,
}: {
  /** The palace 复制导图/查看宫殿 read; null hides both. */
  palaceId: number | null
  /** 复制题目 copies every question loaded in this window. */
  questions: readonly PalaceQuizQuestion[]
  copyingOutline: boolean
  onCopyOutline: (palaceId: number) => void
  onOpenPalace: () => void
  /** Only a multi-question window has an order to shuffle. */
  canShuffle: boolean
  shuffling?: boolean
  onShuffle: () => void
  onOpenClearProgress: () => void
}) {
  const { copying: copyingQuestions, copyQuestions } = useCopyQuizQuestionsText()
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
      {palaceId != null ? (
        <>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label="复制导图"
            title="复制导图的文字层级，可粘贴给 AI 作为作答背景"
            disabled={copyingOutline}
            onClick={() => onCopyOutline(palaceId)}
          >
            {copyingOutline ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Copy className="size-4" />
            )}
            <span className="hidden sm:inline">复制导图</span>
          </Button>
          {questions.length > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label="复制题目"
              title="复制本窗口全部题目的题干、选项、答案与解析"
              disabled={copyingQuestions}
              onClick={() => void copyQuestions(questions)}
            >
              {copyingQuestions ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <FileText className="size-4" />
              )}
              <span className="hidden sm:inline">复制题目</span>
            </Button>
          ) : null}
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
        </>
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
