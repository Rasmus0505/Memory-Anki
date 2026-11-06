import { BookOpen, FileText, LoaderCircle, MoreHorizontal, RotateCcw, Shuffle } from 'lucide-react'
import { useCopyQuizQuestionsText } from '@/modules/quiz/public'
import type { PalaceQuizQuestion } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'
import { QuizWrongExportMenu } from '@/widgets/quiz-wrong-export'

/**
 * Right-side actions of the 关联题目 window. Kept out of the dialog so the
 * answering chrome stays below the architecture file-size limit.
 *
 * 复制导图 and 打乱选项 fold into 更多 so 导出错题 fits without pushing the
 * question body down.
 */
export function NodeBoundQuizHeaderActions({
  palaceId,
  questions,
  wrongQuestions,
  copyingOutline,
  onCopyOutline,
  onOpenPalace,
  canShuffle,
  shuffling = false,
  onShuffle,
  currentQuestion,
  canShuffleOptions,
  canRestoreOptions,
  onShuffleOptions,
  onRestoreOptions,
  onOpenClearProgress,
  actionsDisabled = false,
}: {
  /** The palace 复制导图/查看宫殿 read; null hides both. */
  palaceId: number | null
  /** 复制题目 copies every question loaded in this window. */
  questions: readonly PalaceQuizQuestion[]
  /** Questions answered wrong in this window; 导出错题 reads these. */
  wrongQuestions: readonly PalaceQuizQuestion[]
  copyingOutline: boolean
  onCopyOutline: (palaceId: number) => void
  onOpenPalace: () => void
  /** Only a multi-question window has an order to shuffle. */
  canShuffle: boolean
  shuffling?: boolean
  onShuffle: () => void
  currentQuestion: PalaceQuizQuestion | null
  canShuffleOptions: boolean
  canRestoreOptions: boolean
  onShuffleOptions: () => void
  onRestoreOptions: () => void
  onOpenClearProgress: () => void
  /** 快捷键 panel is open: keep the row in place, just stop the actions. */
  actionsDisabled?: boolean
}) {
  const { copying: copyingQuestions, copyQuestions } = useCopyQuizQuestionsText()
  // The toolbar keeps one fixed set of slots: a control that stops applying is
  // disabled, never removed. Adding/removing a button used to reflow the whole
  // header into a second row and shove the question body down with it.
  const optionShuffleAvailable = canRestoreOptions
    || (currentQuestion?.question_type === 'multiple_choice' && canShuffleOptions)
  return (
    <div className="flex shrink-0 flex-nowrap items-center justify-end gap-2">
      {palaceId != null ? (
        <>
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
      <QuizWrongExportMenu wrongQuestions={wrongQuestions} />
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label="打乱题库"
        title="只打乱还没答的题，已答的题留在原位"
        disabled={shuffling || !canShuffle || actionsDisabled}
        onClick={onShuffle}
      >
        {shuffling ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <Shuffle className="size-4" />
        )}
        <span className="hidden sm:inline">打乱题库</span>
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label="清除进度"
        title="清除当前宫殿或全部宫殿的已答记录"
        disabled={actionsDisabled}
        onClick={onOpenClearProgress}
      >
        <RotateCcw className="size-4" />
        清除进度
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="sm" variant="outline" aria-label="更多操作" title="更多操作">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {palaceId != null ? (
            <DropdownMenuItem disabled={copyingOutline} onSelect={() => onCopyOutline(palaceId)}>
              复制导图
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            disabled={!optionShuffleAvailable || actionsDisabled}
            onSelect={canRestoreOptions ? onRestoreOptions : onShuffleOptions}
          >
            {canRestoreOptions ? '恢复选项' : '打乱选项'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
