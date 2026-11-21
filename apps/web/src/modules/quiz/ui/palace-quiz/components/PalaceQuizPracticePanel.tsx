import { useMemo } from 'react'
import { Search } from 'lucide-react'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import type { PalaceSegmentSummary, PalaceQuizQuestion } from '@/shared/api/contracts'
import type { PalaceQuizScopeKey } from '@/modules/quiz/ui/palace-quiz/model/palaceQuizPage'

function filterQuestionText(question: PalaceQuizQuestion, keyword: string): boolean {
  return [question.stem, question.analysis, question.source_meta?.extra_prompt]
    .some((value) => value?.toLocaleLowerCase().includes(keyword))
}

export function PalaceQuizPracticePanel({
  questions,
  onStartPractice,
  miniPalaces,
  questionScope,
  rootQuestionCount,
  filteredQuestions,
  search,
  onSearchChange,
  onViewKnowledge,
  onScopeFeedback,
  resetAttemptsLoading,
  onResetVisibleAttempts,
}: {
  questions: PalaceQuizQuestion[]
  miniPalaces: PalaceSegmentSummary[]
  onStartPractice: (questionId?: number) => void
  questionScope: PalaceQuizScopeKey
  rootQuestionCount: number
  filteredQuestions: PalaceQuizQuestion[]
  search: string
  onSearchChange: (value: string) => void
  onViewKnowledge: (question: PalaceQuizQuestion) => void
  onScopeFeedback: (scope: PalaceQuizScopeKey, label: string) => void
  resetAttemptsLoading: boolean
  onResetVisibleAttempts: () => void
}) {
  const visibleQuestions = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase()
    return keyword ? filteredQuestions.filter((question) => filterQuestionText(question, keyword)) : filteredQuestions
  }, [filteredQuestions, search])

  return (
    <div className="space-y-4">
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
          <Badge variant="secondary" className="ml-2">{rootQuestionCount}</Badge>
        </Button>
        {miniPalaces.map((miniPalace) => (
          <Button
            key={miniPalace.id}
            type="button"
            size="sm"
            variant={questionScope === `segment:${miniPalace.id}` ? 'default' : 'outline'}
            onClick={() => onScopeFeedback(`segment:${miniPalace.id}`, miniPalace.name)}
          >
            {miniPalace.name}
            <Badge variant="secondary" className="ml-2">
              {questions.filter((question) => question.segment_ids?.includes(miniPalace.id)).length}
            </Badge>
          </Button>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={filteredQuestions.length === 0 || resetAttemptsLoading}
          onClick={onResetVisibleAttempts}
        >
          清空当前范围进度
        </Button>
      </div>

      <label className="relative block max-w-lg">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.currentTarget.value)}
          placeholder="搜索题目"
          aria-label="搜索题目"
          className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>

      {visibleQuestions.length === 0 ? (
        <Card className="border-border/70 bg-card/92">
          <CardContent className="flex min-h-55 items-center justify-center text-sm text-muted-foreground">
            {questions.length === 0
              ? '这个宫殿还没有题目，先去“管理”手动新增。'
              : search.trim() ? '没有匹配的题目。' : '当前范围下还没有题目。'}
          </CardContent>
        </Card>
      ) : (
        <>
          <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border/70 bg-card/90 px-4 py-4">
            <h2 className="font-medium">{visibleQuestions.length} 道关联题目</h2>
            <Button type="button" onClick={() => onStartPractice(visibleQuestions[0]?.id)}>
              开始做题
            </Button>
          </section>
          <ol className="space-y-2">
            {visibleQuestions.map((question) => (
              <li key={question.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-card/90 px-4 py-3">
                <Button type="button" variant="ghost" className="min-h-10 grow justify-start whitespace-normal text-left" onClick={() => onStartPractice(question.id)}>
                  <span className="mr-2 text-xs text-muted-foreground">{question.question_type === 'multiple_choice' ? '选择题' : question.question_type === 'short_answer' ? '简答题' : '题目'}</span>
                  {question.stem}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => onViewKnowledge(question)}>
                  查看知识点
                </Button>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  )
}
