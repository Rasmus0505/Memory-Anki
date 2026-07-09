import {
  QuizQuestionInteraction,
  type QuizRuntimeState,
} from '@/features/palace-quiz/QuizQuestionInteraction'
import {
  QUESTION_TYPE_ACCENT,
  QUESTION_TYPE_DISPLAY,
} from '@/features/freestyle/model/freestyle-labels'
import type { FreestyleQuizCard } from '@/shared/api/contracts'
import { Badge } from '@/shared/components/ui/badge'
import { cn } from '@/shared/lib/utils'

export function FreestyleQuizCardView({
  card,
  state,
  answeredBefore,
  onStateChange,
  onChoiceResolve,
  onShortAnswerSubmit,
  onRequestShortAnswerFeedback,
}: {
  card: FreestyleQuizCard
  state: QuizRuntimeState | undefined
  answeredBefore: boolean
  onStateChange: (updater: (current: QuizRuntimeState) => QuizRuntimeState) => void
  onChoiceResolve: (optionId: string, isCorrect: boolean) => void
  onShortAnswerSubmit: () => void
  onRequestShortAnswerFeedback: () => void
}) {
  const palaceTitle = card.palace_context.resolved_title || card.palace_context.title
  const miniName = card.mini_palace_context?.name
  const chapterName = card.chapter_context?.name
  const accent = QUESTION_TYPE_ACCENT[card.question.question_type]
  const isCorrect = state?.correct === true
  const isIncorrect = state?.correct === false
  const isResolved = state?.resolved === true
  return (
    <div className="mx-auto flex min-h-[min(760px,calc(100vh-140px))] w-full max-w-[calc(100vw-3rem)] flex-col justify-center px-0 py-16 sm:max-w-4xl sm:px-4">
      <div
        className={cn(
          'rounded-2xl border bg-zinc-900/82 p-4 text-zinc-50 shadow-[0_8px_40px_rgba(0,0,0,0.6)] backdrop-blur-md sm:p-6',
          isResolved && isCorrect
            ? 'border-emerald-500/30 shadow-[0_0_24px_rgba(16,185,129,0.12),0_8px_40px_rgba(0,0,0,0.6)]'
            : isResolved && isIncorrect
              ? 'border-red-500/30 shadow-[0_0_24px_rgba(239,68,68,0.12),0_8px_40px_rgba(0,0,0,0.6)]'
              : 'border-white/10',
        )}
      >
        {accent ? (
          <div className="mb-4 flex min-w-0 items-center gap-2">
            <div
              className="h-1.5 w-8 shrink-0 rounded-full"
              style={{ backgroundColor: `hsl(${accent.hue} 70% 60%)` }}
            />
            <span className="shrink-0 text-xs font-medium" style={{ color: `hsl(${accent.hue} 70% 70%)` }}>
              {accent.label}
            </span>
            <span className="text-zinc-700">·</span>
            <span className="min-w-0 truncate text-xs text-zinc-500">{palaceTitle}</span>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge className="border-white/10 bg-white/8 text-zinc-200">{palaceTitle}</Badge>
            {miniName ? <Badge className="border-white/10 bg-white/5 text-zinc-300">{miniName}</Badge> : null}
            {chapterName ? <Badge className="border-white/10 bg-white/5 text-zinc-300">{chapterName}</Badge> : null}
            <Badge className="border-white/10 bg-white/5 text-zinc-300">
              {QUESTION_TYPE_DISPLAY[card.question.question_type] ?? card.question.question_type}
            </Badge>
          </div>
          <Badge
            className={cn(
              'border-white/10 bg-white/5 text-zinc-400',
              !answeredBefore && 'border-emerald-300/30 bg-emerald-300/10 text-emerald-200',
            )}
          >
            {answeredBefore ? '已做过' : '新题'}
          </Badge>
        </div>
        <div className="mt-5 whitespace-pre-wrap text-xl font-semibold leading-8 sm:text-2xl">
          {card.question.stem}
        </div>
        <div className="mt-6">
          <QuizQuestionInteraction
            question={card.question}
            state={state}
            compact
            onStateChange={onStateChange}
            onChoiceResolve={onChoiceResolve}
            onShortAnswerSubmit={onShortAnswerSubmit}
            onRequestShortAnswerFeedback={onRequestShortAnswerFeedback}
          />
        </div>
      </div>
    </div>
  )
}
