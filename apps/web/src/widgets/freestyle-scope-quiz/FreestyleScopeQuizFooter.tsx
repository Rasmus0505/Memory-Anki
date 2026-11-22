import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
import type { QuizRuntimeState } from '@/modules/quiz/public'
import { Button } from '@/shared/components/ui/button'

export function FreestyleScopeQuizFooter({
  questionCount,
  answeredCount,
  index,
  currentState,
  scopeLabel,
  navigationLocked = false,
  goToIndex,
  onFinish,
}: {
  questionCount: number
  answeredCount: number
  index: number
  currentState: QuizRuntimeState
  scopeLabel: string
  /** The inline question editor is open; paging would discard its draft. */
  navigationLocked?: boolean
  goToIndex: (nextIndex: number) => void
  onFinish: () => void
}) {
  // A question being rewritten owns the window: ← / → and 上一题 / 下一题 would
  // throw the draft away with no way back, so they wait for 保存 or 取消编辑.
  const lockedTitle = navigationLocked ? '先保存或取消编辑再换题' : undefined
  return (
    // The centered phone shell already pads past the home-indicator area, so
    // the footer keeps a plain padding — counting the safe area twice used to
    // stack a second blank band under the buttons and squeeze the answers.
    <div className="flex shrink-0 items-center justify-between gap-2 border-t px-4 py-3">
      <span className="min-w-0 flex-1 truncate text-xs tabular-nums text-muted-foreground">
        {questionCount > 1
          ? `已答 ${answeredCount} / ${questionCount} · ${scopeLabel}`
          : currentState.resolved
            ? '已作答'
            : '待作答'}
      </span>
      <div className="flex shrink-0 items-center gap-1.5">
        {currentState.resolved && index < questionCount - 1 && !navigationLocked ? (
          <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">Enter / 空格 下一题</span>
        ) : null}
        {questionCount > 1 ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label="上一题"
              title={lockedTitle}
              disabled={index <= 0 || navigationLocked}
              onClick={() => goToIndex(Math.max(0, index - 1))}
            >
              <ChevronLeft className="size-4" />
              <span className="hidden sm:inline">上一题</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant={currentState.resolved ? 'default' : 'outline'}
              aria-label="下一题"
              title={lockedTitle}
              disabled={index >= questionCount - 1 || navigationLocked}
              onClick={() => goToIndex(Math.min(questionCount - 1, index + 1))}
            >
              下一题
              <ChevronRight className="size-4" />
            </Button>
          </>
        ) : null}
        {index >= questionCount - 1 && currentState.resolved && !navigationLocked ? (
          <Button type="button" size="sm" onClick={onFinish}>
            <Check className="size-4" />
            完成
          </Button>
        ) : null}
      </div>
    </div>
  )
}
