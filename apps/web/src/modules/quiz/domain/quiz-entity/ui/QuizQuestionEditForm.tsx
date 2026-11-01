import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'

import type { PalaceQuizQuestion } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Input } from '@/shared/components/ui/input'
import { Textarea } from '@/shared/components/ui/textarea'
import { toast } from '@/shared/feedback/toast'
import { cn } from '@/shared/lib/utils'

import {
  buildDraftFromForm,
  buildQuestionFormFromQuestion,
  type QuizQuestionFormState,
} from '../model/quizQuestionForm'

/**
 * In-place editor for one hand-written question.
 *
 * Lives in the Quiz entity because both the Palace Quiz management card and the
 * do-question overlays edit the same fields; a second copy would drift the
 * multi-select answer handling apart. The host owns the save call and decides
 * what happens to the question afterwards (the overlays also clear the answered
 * state so the edited question can be taken again).
 */
export function QuizQuestionEditForm({
  question,
  saving = false,
  onSave,
  onCancel,
  className,
}: {
  question: PalaceQuizQuestion
  saving?: boolean
  /** Called with the normalized draft, after local validation passes. */
  onSave: (form: QuizQuestionFormState) => void | Promise<void>
  onCancel: () => void
  className?: string
}) {
  const [form, setForm] = useState<QuizQuestionFormState>(() =>
    buildQuestionFormFromQuestion(question),
  )

  useEffect(() => {
    setForm(buildQuestionFormFromQuestion(question))
  }, [question])

  const isChoice = form.question_type === 'multiple_choice'
  const editingOriginal =
    question.original_content != null
  const update = (patch: Partial<QuizQuestionFormState>) =>
    setForm((current) => ({ ...current, ...patch }))

  const toggleCorrect = (optionId: string, checked: boolean) => {
    setForm((current) => {
      const next = checked
        ? [...current.correct_option_ids.filter((item) => item !== optionId), optionId]
        : current.correct_option_ids.filter((item) => item !== optionId)
      const order = current.options.map((option) => option.id)
      return {
        ...current,
        correct_option_ids: next.sort((a, b) => order.indexOf(a) - order.indexOf(b)),
      }
    })
  }

  const submit = () => {
    try {
      buildDraftFromForm(form)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '题目内容不完整。')
      return
    }
    void onSave(form)
  }

  return (
    <div
      className={cn('space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-3', className)}
      data-quiz-question-edit="true"
      data-testid="quiz-question-edit-form"
    >
      {editingOriginal ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
          当前显示的是 AI 变体；这里改的是原始真题内容。保存后变体仍保留在历史版本里，可随时恢复。
        </p>
      ) : null}

      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">题干</span>
        <Textarea
          aria-label="题干"
          value={form.stem}
          rows={4}
          onChange={(event) => update({ stem: event.target.value })}
        />
      </div>

      {isChoice ? (
        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">选项</span>
          {form.options.map((option, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                aria-label={`选项 ${index + 1} 标号`}
                value={option.id}
                className="h-9 w-14 shrink-0 text-center"
                onChange={(event) =>
                  update({
                    // Renaming an option carries its 「正确」 mark along.
                    correct_option_ids: form.correct_option_ids.map((item) =>
                      item === option.id ? event.target.value : item,
                    ),
                    options: form.options.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, id: event.target.value } : item,
                    ),
                  })
                }
              />
              <Input
                aria-label={`选项 ${index + 1} 内容`}
                value={option.text}
                placeholder={`选项 ${index + 1}`}
                onChange={(event) =>
                  update({
                    options: form.options.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, text: event.target.value } : item,
                    ),
                  })
                }
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`删除选项 ${index + 1}`}
                title="删除这个选项"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                disabled={form.options.length <= 2}
                onClick={() =>
                  update({
                    options: form.options.filter((_, itemIndex) => itemIndex !== index),
                    correct_option_ids: form.correct_option_ids.filter(
                      (item) => item !== option.id,
                    ),
                  })
                }
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
          <div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                update({
                  options: [
                    ...form.options,
                    {
                      id: String.fromCharCode(65 + form.options.length),
                      text: '',
                    },
                  ],
                })
              }
            >
              <Plus className="size-3.5" />
              新增选项
            </Button>
          </div>

          <span className="mt-1 text-xs font-medium text-muted-foreground">
            正确答案（多选题勾选多个）
          </span>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {form.options.map((option) => {
              const checked = form.correct_option_ids.includes(option.id)
              return (
                <label
                  key={option.id}
                  className="flex items-center gap-1.5 text-sm"
                  title={option.text}
                >
                  <Checkbox
                    aria-label={`选项 ${option.id} 是正确答案`}
                    checked={checked}
                    onCheckedChange={(value) => toggleCorrect(option.id, value === true)}
                  />
                  {option.id}
                </label>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">参考答案</span>
          <Textarea
            aria-label="参考答案"
            value={form.reference_answer}
            rows={3}
            onChange={(event) => update({ reference_answer: event.target.value })}
          />
        </div>
      )}

      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">解析</span>
        <Textarea
          aria-label="解析"
          value={form.analysis}
          rows={4}
          onChange={(event) => update({ analysis: event.target.value })}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" loading={saving} loadingText="保存中" onClick={submit}>
          保存题目
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={saving} onClick={onCancel}>
          取消编辑
        </Button>
        <span className="text-[11px] text-muted-foreground">
          保存后这道题的作答记录会清空，可以重新作答。
        </span>
      </div>
    </div>
  )
}
