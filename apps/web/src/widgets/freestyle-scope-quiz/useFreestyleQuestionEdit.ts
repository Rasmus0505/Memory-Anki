import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'

import { updatePalaceQuizQuestionApi } from '@/modules/quiz/domain/quiz-entity/api'
import { buildDraftFromForm, type QuizQuestionFormState } from '@/modules/quiz/domain/quiz-entity'
import type { PalaceQuizQuestion } from '@/shared/api/contracts'
import { toast } from '@/shared/feedback/toast'

/**
 * In-overlay question editing.
 *
 * The do-question window is where a bad stem or a wrong answer key is actually
 * noticed, so editing happens here instead of sending the learner to Palace
 * Quiz → 题库管理 and losing the round's position. Saving rewrites the question
 * in this window *and* clears its answered state: the old answer belongs to the
 * old text, and keeping 「已答对」 on a rewritten question would be a lie the
 * progress rail repeats for the rest of the round.
 */
export function useFreestyleQuestionEdit({
  current,
  setQuestions,
  resetLocalAnswer,
}: {
  current: PalaceQuizQuestion | null
  setQuestions: Dispatch<SetStateAction<PalaceQuizQuestion[]>>
  resetLocalAnswer: (questionId: number) => void
}) {
  const [editingQuestionId, setEditingQuestionId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  const openEditor = useCallback(() => {
    if (!current) return
    setEditingQuestionId(current.id)
  }, [current])

  const closeEditor = useCallback(() => setEditingQuestionId(null), [])

  const save = useCallback(async (form: QuizQuestionFormState) => {
    if (!current) return
    const questionId = current.id
    const draft = buildDraftFromForm(form)
    setSaving(true)
    try {
      const response = await updatePalaceQuizQuestionApi(questionId, draft)
      const saved = response.item
      setQuestions((items) =>
        items.map((item) => {
          if (item.id !== questionId) return item
          // A rewrite that duplicates another question merges into that row. The
          // round still points at this id, so keep the card but say so.
          if (saved && saved.id !== questionId) {
            return { ...item, ...saved, id: questionId }
          }
          return saved ? { ...item, ...saved } : item
        }),
      )
      resetLocalAnswer(questionId)
      if (saved && saved.id !== questionId) {
        toast.info('这道题与题库里已有题目重复，已合并到那一题；重新打开做题后生效。')
      } else {
        toast.success('题目已更新，作答记录已清空，可以重新作答。')
      }
      setEditingQuestionId(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存题目失败，请检查内容后再试。')
    } finally {
      setSaving(false)
    }
  }, [current, resetLocalAnswer, setQuestions])

  return {
    /** True while the open editor belongs to the question on screen. */
    editing: current != null && editingQuestionId === current.id,
    editingQuestionId,
    saving,
    openEditor,
    closeEditor,
    save,
  }
}
