import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, FileText, LoaderCircle, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Textarea } from '@/shared/components/ui/textarea'
import { EmptyState } from '@/shared/components/state-placeholders'
import { cn } from '@/shared/lib/utils'
import type {
  MiniPalaceSummary,
  PalaceQuizOcrSource,
  PalaceQuizQuestion,
} from '@/shared/api/contracts'
import { getPalaceQuizOcrSourcesApi, reviewQuizQuestionQualityApi, transitionQuizQuestionLifecycleApi } from '@/entities/quiz/api'
import {
  canManuallyEditQuestion,
  getQuestionOwnershipLabel,
  getQuestionTypeLabel,
  type PalaceQuizScopeKey,
  type QuestionFormState,
} from '@/features/palace-quiz/model/palaceQuizPage'
import { QuestionSourceBadge } from '@/features/palace-quiz/components/palaceQuizCards'

export function PalaceQuizManagePanel({
  palaceId,
  questions,
  miniPalaces,
  questionScope,
  onScopeChange,
  filteredQuestions,
  selectedQuestionIds,
  allVisibleQuestionsSelected,
  manageBulkDeleting,
  manageDeletingId,
  editingQuestionId,
  manageSaving,
  questionForm,
  setQuestionForm,
  onToggleQuestionSelection,
  onToggleSelectAllVisibleQuestions,
  onClearSelection,
  onBatchDeleteQuestions,
  onStartCreateQuestion,
  onEditQuestion,
  onDeleteQuestion,
  onSaveQuestion,
  onResetForm,
  onReviewUpdated,
}: {
  palaceId: number | null
  questions: PalaceQuizQuestion[]
  miniPalaces: MiniPalaceSummary[]
  questionScope: PalaceQuizScopeKey
  onScopeChange: (scope: PalaceQuizScopeKey, label: string) => void
  filteredQuestions: PalaceQuizQuestion[]
  selectedQuestionIds: number[]
  allVisibleQuestionsSelected: boolean
  manageBulkDeleting: boolean
  manageDeletingId: number | null
  editingQuestionId: number | null
  manageSaving: boolean
  questionForm: QuestionFormState
  setQuestionForm: React.Dispatch<React.SetStateAction<QuestionFormState>>
  onToggleQuestionSelection: (questionId: number, checked: boolean) => void
  onToggleSelectAllVisibleQuestions: (checked: boolean) => void
  onClearSelection: () => void
  onBatchDeleteQuestions: () => Promise<void>
  onStartCreateQuestion: () => void
  onEditQuestion: (question: PalaceQuizQuestion) => void
  onDeleteQuestion: (questionId: number) => Promise<void>
  onSaveQuestion: () => Promise<void>
  onResetForm: () => void
  onReviewUpdated: () => Promise<void>
}) {
  const [ocrSources, setOcrSources] = useState<PalaceQuizOcrSource[]>([])
  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrError, setOcrError] = useState('')
  const [expandedOcrId, setExpandedOcrId] = useState<number | null>(null)
  const [reviewingQuestionId, setReviewingQuestionId] = useState<number | null>(null)

  const handleLifecycle = async (question: PalaceQuizQuestion, status: 'published' | 'rejected') => {
    setReviewingQuestionId(question.id)
    try {
      if (status === 'published') await reviewQuizQuestionQualityApi(question.id)
      await transitionQuizQuestionLifecycleApi(question.id, status)
      await onReviewUpdated()
    } finally {
      setReviewingQuestionId(null)
    }
  }

  const loadOcrSources = useCallback(async () => {
    if (!palaceId) return
    setOcrLoading(true)
    setOcrError('')
    try {
      const result = await getPalaceQuizOcrSourcesApi(palaceId)
      setOcrSources(result.items)
      setExpandedOcrId((current) =>
        current && result.items.some((item) => item.id === current) ? current : null,
      )
    } catch (nextError) {
      setOcrError(nextError instanceof Error ? nextError.message : '加载原始 OCR 失败。')
    } finally {
      setOcrLoading(false)
    }
  }, [palaceId])

  useEffect(() => {
    setOcrSources([])
    setExpandedOcrId(null)
    if (palaceId) void loadOcrSources()
  }, [loadOcrSources, palaceId])

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_380px]">
      <Card className="border-border/70 bg-card/92">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">题库列表</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={selectedQuestionIds.length === 0 || manageBulkDeleting}
              onClick={() => void onBatchDeleteQuestions()}
            >
              {manageBulkDeleting ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              批量删除所选
            </Button>
            <Button type="button" size="sm" onClick={onStartCreateQuestion}>
              <Plus className="size-4" />
              新增题目
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={questionScope === 'all' ? 'default' : 'outline'}
              onClick={() => onScopeChange('all', '全部题目')}
            >
              全部
            </Button>
            <Button
              type="button"
              size="sm"
              variant={questionScope === 'palace' ? 'default' : 'outline'}
              onClick={() => onScopeChange('palace', '大宫殿')}
            >
              大宫殿
            </Button>
            {miniPalaces.map((miniPalace) => (
              <Button
                key={miniPalace.id}
                type="button"
                size="sm"
                variant={questionScope === `mini:${miniPalace.id}` ? 'default' : 'outline'}
                onClick={() => onScopeChange(`mini:${miniPalace.id}`, miniPalace.name)}
              >
                {miniPalace.name}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-background/60 px-3 py-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                aria-label="全选当前题目"
                type="checkbox"
                checked={allVisibleQuestionsSelected}
                disabled={filteredQuestions.length === 0 || manageBulkDeleting}
                onChange={(event) => onToggleSelectAllVisibleQuestions(event.target.checked)}
              />
              <span>全选当前列表</span>
            </label>
            <span className="text-muted-foreground">已选 {selectedQuestionIds.length} 题</span>
            {selectedQuestionIds.length > 0 ? (
              <Button type="button" size="sm" variant="ghost" onClick={onClearSelection}>
                清空选择
              </Button>
            ) : null}
          </div>
          {filteredQuestions.length === 0 ? (
            <EmptyState
              variant={questions.length === 0 ? 'create' : 'search'}
              title={questions.length === 0 ? '题库里还没有题目' : '当前范围没有题目'}
              description={
                questions.length === 0
                  ? '可以先在右侧手动新增一道题，或到 AI 生成里预览后保存到题库。'
                  : '切换到全部题目，或为这个训练关卡单独新增题目。'
              }
              action={
                questions.length === 0 ? (
                  <Button type="button" size="sm" variant="outline" onClick={onStartCreateQuestion}>
                    <Plus className="mr-2 size-4" />
                    手动新增题目
                  </Button>
                ) : null
              }
            />
          ) : (
            <div className="grid gap-2 xl:grid-cols-2">
              {filteredQuestions.map((question, index) => (
                <div
                  key={question.id}
                  className={cn(
                    'rounded-xl border px-3 py-3',
                    editingQuestionId === question.id
                      ? 'border-primary/40 bg-primary/5'
                      : 'border-border/70 bg-background/70',
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <input
                        aria-label={`选择题目 ${question.stem}`}
                        type="checkbox"
                        className="mt-1"
                        checked={selectedQuestionIds.includes(question.id)}
                        disabled={manageBulkDeleting || manageDeletingId === question.id}
                        onChange={(event) =>
                          onToggleQuestionSelection(question.id, event.target.checked)
                        }
                      />
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="secondary">#{index + 1}</Badge>
                          <Badge variant="outline">
                            {getQuestionTypeLabel(question.question_type)}
                          </Badge>
                          <Badge
                            variant={question.mini_palace_id == null ? 'secondary' : 'outline'}
                          >
                            {getQuestionOwnershipLabel(question)}
                          </Badge>
                        </div>
                        <div className="line-clamp-3 text-sm font-medium leading-6">
                          {question.stem}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <QuestionSourceBadge sourceMeta={question.source_meta} compact />
                          <Badge variant={question.lifecycle_status === 'published' ? 'secondary' : 'outline'}>
                            {question.lifecycle_status === 'published' ? '正式题' : question.lifecycle_status === 'candidate' ? '待审核' : question.lifecycle_status === 'temporary' ? '临时题' : '已拒绝'}
                          </Badge>
                          {question.question_type === 'multiple_choice' ? (
                            <span className="text-[11px] text-muted-foreground">
                              对 {question.correct_count} / 错 {question.incorrect_count}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      {question.lifecycle_status !== 'published' && question.lifecycle_status !== 'rejected' ? (
                        <>
                          <Button type="button" size="sm" className="h-8 px-2.5" disabled={reviewingQuestionId === question.id} onClick={() => void handleLifecycle(question, 'published')}>审核发布</Button>
                          <Button type="button" size="sm" variant="ghost" className="h-8 px-2.5" disabled={reviewingQuestionId === question.id} onClick={() => void handleLifecycle(question, 'rejected')}>拒绝</Button>
                        </>
                      ) : null}
                      {canManuallyEditQuestion(question.question_type) ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 px-2.5"
                          onClick={() => onEditQuestion(question)}
                        >
                          编辑
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 px-2.5"
                        disabled={manageBulkDeleting || manageDeletingId === question.id}
                        onClick={() => void onDeleteQuestion(question.id)}
                      >
                        删除
                        {manageDeletingId === question.id ? (
                          <LoaderCircle className="size-4 animate-spin" />
                        ) : (
                          <Trash2 className="size-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card className="border-border/70 bg-card/92">
          <CardHeader>
            <CardTitle className="text-base">
              {editingQuestionId != null ? '编辑题目' : '手动新增题目'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
          <div className="grid gap-2">
            <span className="text-sm font-medium">题型</span>
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={questionForm.question_type}
              onChange={(event) =>
                setQuestionForm((current) => ({
                  ...current,
                  question_type: event.target.value as QuestionFormState['question_type'],
                }))
              }
            >
              <option value="multiple_choice">选择题</option>
              <option value="short_answer">简答题</option>
            </select>
          </div>

          <div className="grid gap-2">
            <span className="text-sm font-medium">题干</span>
            <Textarea
              value={questionForm.stem}
              onChange={(event) =>
                setQuestionForm((current) => ({
                  ...current,
                  stem: event.target.value,
                }))
              }
              placeholder="输入题干"
              rows={4}
            />
          </div>

          {questionForm.question_type === 'multiple_choice' ? (
            <>
              <div className="grid gap-2">
                <span className="text-sm font-medium">选项</span>
                {questionForm.options.map((option, index) => (
                  <div key={option.id || index} className="flex gap-2">
                    <Input
                      value={option.id}
                      onChange={(event) =>
                        setQuestionForm((current) => ({
                          ...current,
                          options: current.options.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, id: event.target.value } : item,
                          ),
                        }))
                      }
                      className="w-16"
                    />
                    <Input
                      value={option.text}
                      onChange={(event) =>
                        setQuestionForm((current) => ({
                          ...current,
                          options: current.options.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, text: event.target.value } : item,
                          ),
                        }))
                      }
                      placeholder={`选项 ${index + 1}`}
                    />
                  </div>
                ))}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setQuestionForm((current) => ({
                        ...current,
                        options: [
                          ...current.options,
                          {
                            id: String.fromCharCode(65 + current.options.length),
                            text: '',
                          },
                        ],
                      }))
                    }
                  >
                    新增选项
                  </Button>
                </div>
              </div>

              <div className="grid gap-2">
                <span className="text-sm font-medium">正确答案</span>
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={questionForm.correct_option_id}
                  onChange={(event) =>
                    setQuestionForm((current) => ({
                      ...current,
                      correct_option_id: event.target.value,
                    }))
                  }
                >
                  {questionForm.options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.id}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <div className="grid gap-2">
              <span className="text-sm font-medium">参考答案</span>
              <Textarea
                value={questionForm.reference_answer}
                onChange={(event) =>
                  setQuestionForm((current) => ({
                    ...current,
                    reference_answer: event.target.value,
                  }))
                }
                placeholder="输入参考答案"
                rows={4}
              />
            </div>
          )}

          <div className="grid gap-2">
            <span className="text-sm font-medium">解析</span>
            <Textarea
              value={questionForm.analysis}
              onChange={(event) =>
                setQuestionForm((current) => ({
                  ...current,
                  analysis: event.target.value,
                }))
              }
              placeholder="输入解析"
              rows={5}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={manageSaving} onClick={() => void onSaveQuestion()}>
              {manageSaving ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              保存题目
            </Button>
            <Button type="button" variant="outline" onClick={onResetForm}>
              重置表单
            </Button>
          </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/92">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="size-4" />
              原始 OCR
            </CardTitle>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={ocrLoading || !palaceId}
              onClick={() => void loadOcrSources()}
            >
              <RefreshCw className={cn('size-4', ocrLoading && 'animate-spin')} />
              刷新
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {ocrError ? <p className="text-sm text-destructive">{ocrError}</p> : null}
            {ocrSources.length === 0 && !ocrLoading ? (
              <p className="text-sm text-muted-foreground">暂无已记录的 OCR 来源。</p>
            ) : (
              <div className="space-y-2">
                {ocrSources.map((source) => {
                  const expanded = expandedOcrId === source.id
                  const previewText = source.raw_text.trim() || source.image_path || source.page_key
                  return (
                    <div
                      key={source.id}
                      className="rounded-lg border border-border/70 bg-background/70 p-3"
                    >
                      <button
                        type="button"
                        className="flex w-full items-start justify-between gap-3 text-left"
                        onClick={() => setExpandedOcrId(expanded ? null : source.id)}
                      >
                        <span className="min-w-0 space-y-1">
                          <span className="block truncate text-sm font-medium">
                            {source.source_set} · {source.page_key}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            页码 {source.page_number ?? '-'} · {source.import_batch}
                          </span>
                        </span>
                        <Badge variant="outline">{expanded ? '收起' : '查看'}</Badge>
                      </button>
                      {expanded ? (
                        <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-xs leading-5">
                          {source.raw_text || '该来源仅记录了上传文件，没有可用 OCR 文本。'}
                        </pre>
                      ) : (
                        <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
                          {previewText}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}



