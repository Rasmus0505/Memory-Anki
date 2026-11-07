import { ArrowUpToLine, BookOpen, LoaderCircle, MoreHorizontal, RotateCcw, Shuffle } from 'lucide-react'
import type { QuizRuntimeState } from '@/modules/quiz/public'
import { QuizCopyQuestionsMenu } from '@/widgets/quiz-wrong-export/QuizCopyQuestionsMenu'
import type { PalaceQuizQuestion } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'

/**
 * Right-side actions of the 做题 overlay header. Kept out of the dialog so the
 * answering chrome stays below the architecture file-size limit.
 *
 * The row stays one line by keeping only the actions used mid-answer inline.
 * 复制导图 and 打乱选项 sit behind 更多 on desktop; phones fold every secondary
 * action there, so the question body keeps the height.
 */
export function FreestyleScopeQuizHeaderActions({
  copyPalaceId,
  lookupPalaceId,
  questions,
  wrongQuestions,
  questionStates,
  currentQuestion,
  copyingOutline,
  onCopyOutline,
  onOpenPalace,
  canShuffle,
  shuffling,
  onShuffle,
  onShuffleOptions,
  onRestoreOptions,
  canShuffleOptions,
  canRestoreOptions,
  onOpenClearProgress,
  prioritizeWrong,
  onPrioritizeWrongChange,
  actionsDisabled = false,
}: {
  /** Palace whose mind map 复制导图 reads; usually the current question's palace. */
  copyPalaceId: number | null
  /** Palace 查看宫殿 opens (may be a bound palace override). */
  lookupPalaceId: number | null
  /** 复制题目 copies every question loaded in this window. */
  questions: readonly PalaceQuizQuestion[]
  /** Questions answered wrong so far this round; 导出错题 reads these. */
  wrongQuestions: readonly PalaceQuizQuestion[]
  questionStates: Readonly<Record<number, QuizRuntimeState>>
  currentQuestion: PalaceQuizQuestion | null
  copyingOutline: boolean
  onCopyOutline: (palaceId: number) => void
  onOpenPalace: () => void
  /** Only a multi-question pool has an order to shuffle. */
  canShuffle: boolean
  shuffling: boolean
  onShuffle: () => void
  onShuffleOptions: () => void
  onRestoreOptions: () => void
  canShuffleOptions: boolean
  canRestoreOptions: boolean
  onOpenClearProgress: () => void
  prioritizeWrong: boolean
  onPrioritizeWrongChange: (enabled: boolean) => void
  /** 做题配置 / 快捷键 panel is open: keep the row, just stop the actions. */
  actionsDisabled?: boolean
}) {
  const hasOutline = copyPalaceId != null
  const hasQuestions = questions.length > 0
  const canShuffleCurrentOptions = currentQuestion?.question_type === 'multiple_choice'
    && (currentQuestion.options?.length ?? 0) > 1
  // One slot, two states: 打乱选项 / 恢复选项 share a button so turning an
  // order into "restorable" never adds a control and reflows the header.
  const optionShuffleAvailable = canRestoreOptions
    || (canShuffleCurrentOptions && canShuffleOptions)
  const optionShuffleDisabled = !optionShuffleAvailable || actionsDisabled
  const optionShuffleLabel = canRestoreOptions ? '恢复选项' : '打乱选项'
  const handleOptionShuffle = canRestoreOptions ? onRestoreOptions : onShuffleOptions

  return (
    <div className="flex min-w-0 items-center justify-end gap-2">
      <Button type="button" size="sm" variant={prioritizeWrong ? 'default' : 'outline'}
        aria-label="错题优先" aria-pressed={prioritizeWrong}
        title="答错后只把这道题对应的复习单元排到前面，同一宫殿的其他单元不动"
        onClick={() => onPrioritizeWrongChange(!prioritizeWrong)}>
        <ArrowUpToLine className="size-4" />
        <span className="hidden sm:inline">错题优先</span>
      </Button>
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

      {hasQuestions ? <QuizCopyQuestionsMenu questions={questions} currentQuestion={currentQuestion} wrongQuestions={wrongQuestions} questionStates={questionStates} fallbackPalaceId={copyPalaceId} /> : null}

      <div className="hidden flex-nowrap items-center justify-end gap-2 sm:flex">
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label="打乱题库"
          title="只打乱还没答的题，已答的题留在原位"
          disabled={shuffling || !canShuffle || actionsDisabled}
          onClick={onShuffle}
        >
          {shuffling ? <LoaderCircle className="size-4 animate-spin" /> : <Shuffle className="size-4" />}
          <span>打乱题库</span>
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
          <span>清除进度</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="sm" variant="outline" aria-label="更多操作" title="更多操作">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {hasOutline ? (
              <DropdownMenuItem disabled={copyingOutline} onSelect={() => onCopyOutline(copyPalaceId)}>
                复制导图
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem disabled={optionShuffleDisabled} onSelect={handleOptionShuffle}>
              {optionShuffleLabel}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="sm:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="sm" variant="outline" aria-label="更多操作" title="更多操作">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {hasOutline ? (
              <DropdownMenuItem disabled={copyingOutline} onSelect={() => onCopyOutline(copyPalaceId)}>
                复制导图
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem disabled={optionShuffleDisabled} onSelect={handleOptionShuffle}>
              {optionShuffleLabel}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={shuffling || !canShuffle || actionsDisabled} onSelect={onShuffle}>
              打乱题库
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" disabled={actionsDisabled} onSelect={onOpenClearProgress}>
              清除进度
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
