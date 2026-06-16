import { Button } from '@/shared/components/ui/button'
import { Badge } from '@/shared/components/ui/badge'
import { Card, CardContent } from '@/shared/components/ui/card'
import { QuizQuestionCard } from '@/features/palace-quiz/components/palaceQuizCards'
import type { QuizRuntimeState } from '@/features/palace-quiz/QuizQuestionInteraction'
import type { MiniPalaceSummary, PalaceQuizQuestion } from '@/shared/api/contracts'
import type { PalaceQuizScopeKey, PalaceQuizViewMode } from '@/features/palace-quiz/model/palaceQuizPage'

export function PalaceQuizPracticePanel({
  questions,
  miniPalaces,
  questionScope,
  setQuestionScope,
  rootQuestionCount,
  viewMode,
  setViewMode,
  filteredQuestions,
  currentQuestion,
  currentQuestionIndex,
  setCurrentQuestionIndex,
  questionStates,
  onChoiceSelect,
  onStateChange,
  onShortAnswerSubmit,
  onShortAnswerFeedback,
  onReset,
  onEdit,
  onScopeFeedback,
  onViewFeedback,
  onNavigateFeedback,
}: {
  questions: PalaceQuizQuestion[]
  miniPalaces: MiniPalaceSummary[]
  questionScope: PalaceQuizScopeKey
  setQuestionScope: (value: PalaceQuizScopeKey) => void
  rootQuestionCount: number
  viewMode: PalaceQuizViewMode
  setViewMode: (value: PalaceQuizViewMode) => void
  filteredQuestions: PalaceQuizQuestion[]
  currentQuestion: PalaceQuizQuestion | null
  currentQuestionIndex: number
  setCurrentQuestionIndex: React.Dispatch<React.SetStateAction<number>>
  questionStates: Record<number, QuizRuntimeState>
  onChoiceSelect: (question: PalaceQuizQuestion, optionId: string) => void
  onStateChange: (questionId: number, updater: (current: QuizRuntimeState) => QuizRuntimeState) => void
  onShortAnswerSubmit: (questionId: number) => void
  onShortAnswerFeedback: (question: PalaceQuizQuestion) => void
  onReset: (questionId: number) => void
  onEdit: (question: PalaceQuizQuestion) => void
  onScopeFeedback: (scope: PalaceQuizScopeKey, label: string) => void
  onViewFeedback: (viewMode: PalaceQuizViewMode, label: string) => void
  onNavigateFeedback: (direction: 'prev' | 'next') => void
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={viewMode === 'single' ? 'default' : 'outline'}
          size="sm"
          onClick={() => onViewFeedback('single', '逐题模式')}
        >
          逐题模式
        </Button>
        <Button
          type="button"
          variant={viewMode === 'list' ? 'default' : 'outline'}
          size="sm"
          onClick={() => onViewFeedback('list', '整页列表')}
        >
          整页列表
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={questionScope === 'all' ? 'default' : 'outline'}
          onClick={() => onScopeFeedback('all', '全部题目')}
        >
          全部
        </Button>
        <Button
          type="button"
          size="sm"
          variant={questionScope === 'palace' ? 'default' : 'outline'}
          onClick={() => onScopeFeedback('palace', '大宫殿')}
        >
          大宫殿
          <Badge variant="secondary" className="ml-2">
            {rootQuestionCount}
          </Badge>
        </Button>
        {miniPalaces.map((miniPalace) => (
          <Button
            key={miniPalace.id}
            type="button"
            size="sm"
            variant={questionScope === `mini:${miniPalace.id}` ? 'default' : 'outline'}
            onClick={() => onScopeFeedback(`mini:${miniPalace.id}`, miniPalace.name)}
          >
            {miniPalace.name}
            <Badge variant="secondary" className="ml-2">
              {questions.filter((question) => question.mini_palace_id === miniPalace.id).length}
            </Badge>
          </Button>
        ))}
      </div>

      {filteredQuestions.length === 0 ? (
        <Card className="border-border/70 bg-card/92">
          <CardContent className="flex min-h-[220px] items-center justify-center text-sm text-muted-foreground">
            {questions.length === 0
              ? '这个宫殿还没有题目，先去“管理”手动新增，或者到“AI生成”里预览后保存。'
              : '当前范围下还没有题目。'}
          </CardContent>
        </Card>
      ) : viewMode === 'single' && currentQuestion ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card/90 px-4 py-3 text-sm">
            <div>
              第 {currentQuestionIndex + 1} / {filteredQuestions.length} 题
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={currentQuestionIndex <= 0}
                onClick={() => onNavigateFeedback('prev')}
              >
                上一题
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={currentQuestionIndex >= filteredQuestions.length - 1}
                onClick={() => onNavigateFeedback('next')}
              >
                下一题
              </Button>
            </div>
          </div>
          <QuizQuestionCard
            question={currentQuestion}
            state={questionStates[currentQuestion.id]}
            onChoiceSelect={onChoiceSelect}
            onStateChange={onStateChange}
            onShortAnswerSubmit={onShortAnswerSubmit}
            onShortAnswerFeedback={onShortAnswerFeedback}
            onReset={onReset}
            onEdit={onEdit}
          />
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredQuestions.map((question) => (
            <QuizQuestionCard
              key={question.id}
              question={question}
              state={questionStates[question.id]}
              compact
              onChoiceSelect={onChoiceSelect}
              onStateChange={onStateChange}
              onShortAnswerSubmit={onShortAnswerSubmit}
              onShortAnswerFeedback={onShortAnswerFeedback}
              onReset={onReset}
              onEdit={onEdit}
            />
          ))}
        </div>
      )}
    </div>
  )
}
