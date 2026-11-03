import { ArrowUpToLine, BookOpen, Copy, FileText, LoaderCircle, MoreHorizontal, RotateCcw, Shuffle } from 'lucide-react'
import { useCopyQuizQuestionsText } from '@/modules/quiz/public'
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
 * Phones keep only 查看宫殿 in the header; the other four secondary actions sit
 * behind one 更多 button so the header stays a single row and the question body
 * gets the height back. From `sm` up every action renders inline as before.
 */
export function FreestyleScopeQuizHeaderActions({
  copyPalaceId,
  lookupPalaceId,
  questions,
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
  const { copying: copyingQuestions, copyQuestions } = useCopyQuizQuestionsText()
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
  const optionShuffleTitle = canRestoreOptions
    ? '恢复当前题首次打乱前的顺序'
    : '只打乱当前题的选项'
  const handleOptionShuffle = canRestoreOptions ? onRestoreOptions : onShuffleOptions
  const optionShuffleIcon = canRestoreOptions
    ? <RotateCcw className="size-4" />
    : <Shuffle className="size-4" />

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

      <div className="hidden flex-nowrap items-center justify-end gap-2 sm:flex">
        {hasOutline ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label="复制导图"
            title="复制导图的文字层级，可粘贴给 AI 作为作答背景"
            disabled={copyingOutline}
            onClick={() => onCopyOutline(copyPalaceId)}
          >
            {copyingOutline ? <LoaderCircle className="size-4 animate-spin" /> : <Copy className="size-4" />}
            <span>复制导图</span>
          </Button>
        ) : null}
        {hasQuestions ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label="复制题目"
            title="复制本窗口全部题目的题干、选项、答案与解析"
            disabled={copyingQuestions}
            onClick={() => void copyQuestions(questions)}
          >
            {copyingQuestions ? <LoaderCircle className="size-4 animate-spin" /> : <FileText className="size-4" />}
            <span>复制题目</span>
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={optionShuffleLabel}
          title={optionShuffleTitle}
          disabled={optionShuffleDisabled}
          onClick={handleOptionShuffle}
        >
          {optionShuffleIcon}
          <span>{optionShuffleLabel}</span>
        </Button>
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
          title="清除当前题、指定宫殿或全部题的已答记录"
          disabled={actionsDisabled}
          onClick={onOpenClearProgress}
        >
          <RotateCcw className="size-4" />
          <span>清除进度</span>
        </Button>
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
            {hasQuestions ? (
              <DropdownMenuItem disabled={copyingQuestions} onSelect={() => void copyQuestions(questions)}>
                复制题目
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
