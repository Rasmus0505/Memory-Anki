import { useEffect, useMemo, useState } from 'react'
import { toast } from '@/shared/feedback/toast'
import type { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'
import type { PalaceQuizQuestion } from '@/shared/api/contracts'
import {
  batchDeletePalaceQuizQuestionsApi,
  createPalaceQuizQuestionApi,
  deletePalaceQuizQuestionApi,
  updatePalaceQuizQuestionApi,
} from '@/features/palace-quiz/api/palaceQuizApi'
import {
  buildDraftFromForm,
  buildEmptyQuestionForm,
  buildQuestionFormFromQuestion,
  canManuallyEditQuestion,
  type QuestionFormState,
} from '@/features/palace-quiz/model/palaceQuizPage'

export function usePalaceQuizManagement({
  palaceId,
  questions,
  visibleQuestionIds,
  filteredQuestions,
  refreshQuestions,
  removeQuestionStates,
  registerQuizActivity,
  emitQuizFeedback,
}: {
  palaceId: number | null
  questions: PalaceQuizQuestion[]
  visibleQuestionIds: number[]
  filteredQuestions: PalaceQuizQuestion[]
  refreshQuestions: () => Promise<void>
  removeQuestionStates: (questionIds: number[]) => void
  registerQuizActivity: (source: string) => void
  emitQuizFeedback: (
    event: Parameters<typeof dispatchGlobalFeedback>[0],
    options?: Parameters<typeof dispatchGlobalFeedback>[1],
  ) => void
}) {
  const [editingQuestionId, setEditingQuestionId] = useState<number | null>(null)
  const [questionForm, setQuestionForm] = useState<QuestionFormState>(buildEmptyQuestionForm)
  const [manageSaving, setManageSaving] = useState(false)
  const [manageDeletingId, setManageDeletingId] = useState<number | null>(null)
  const [manageBulkDeleting, setManageBulkDeleting] = useState(false)
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<number[]>([])

  const allVisibleQuestionsSelected = useMemo(
    () =>
      visibleQuestionIds.length > 0 &&
      visibleQuestionIds.every((questionId) => selectedQuestionIds.includes(questionId)),
    [selectedQuestionIds, visibleQuestionIds],
  )

  useEffect(() => {
    setSelectedQuestionIds((current) =>
      current.filter((questionId) => questions.some((question) => question.id === questionId)),
    )
  }, [questions])

  const handleStartCreateQuestion = () => {
    registerQuizActivity('manage_create_start')
    emitQuizFeedback('quiz_manage_create_start', { label: '新增题目', audioScope: 'local' })
    setEditingQuestionId(null)
    setQuestionForm(buildEmptyQuestionForm())
  }

  const handleEditQuestion = (question: PalaceQuizQuestion) => {
    if (!canManuallyEditQuestion(question.question_type)) {
      toast.message('这类题目前只支持做题、查看和删除，暂不支持手工编辑。')
      return false
    }
    registerQuizActivity('manage_edit_question')
    emitQuizFeedback('quiz_manage_edit_start', { label: '编辑题目', audioScope: 'local' })
    setEditingQuestionId(question.id)
    setQuestionForm(buildQuestionFormFromQuestion(question))
    return true
  }

  const resetEditingState = () => {
    setEditingQuestionId(null)
    setQuestionForm(buildEmptyQuestionForm())
  }

  const handleSaveQuestion = async () => {
    if (!palaceId) return
    registerQuizActivity('manage_save_question')
    emitQuizFeedback('quiz_manage_save', {
      label: editingQuestionId != null ? '更新题目' : '保存题目',
      audioScope: 'global',
    })
    setManageSaving(true)
    try {
      const draft = buildDraftFromForm(questionForm)
      if (editingQuestionId != null) {
        await updatePalaceQuizQuestionApi(editingQuestionId, draft)
        toast.success('题目已更新')
      } else {
        await createPalaceQuizQuestionApi(palaceId, draft)
        toast.success('题目已新增')
      }
      emitQuizFeedback('quiz_manage_save', {
        label: editingQuestionId != null ? '已更新' : '已新增',
        audioScope: 'global',
      })
      await refreshQuestions()
      resetEditingState()
    } catch (nextError) {
      emitQuizFeedback('quiz_error_persist_failed', { label: '保存失败', audioScope: 'global' })
      toast.error(nextError instanceof Error ? nextError.message : '保存题目失败。')
    } finally {
      setManageSaving(false)
    }
  }

  const handleDeleteQuestion = async (questionId: number) => {
    if (!window.confirm('确定删除这道题吗？')) return
    registerQuizActivity('manage_delete_question')
    emitQuizFeedback('quiz_manage_delete', { label: '删除题目', audioScope: 'local' })
    setManageDeletingId(questionId)
    try {
      await deletePalaceQuizQuestionApi(questionId)
      toast.success('题目已删除')
      emitQuizFeedback('quiz_manage_delete', { label: '已删除', audioScope: 'local' })
      await refreshQuestions()
      setSelectedQuestionIds((current) => current.filter((item) => item !== questionId))
      removeQuestionStates([questionId])
      if (editingQuestionId === questionId) {
        resetEditingState()
      }
    } catch (nextError) {
      emitQuizFeedback('quiz_error_persist_failed', { label: '删除失败', audioScope: 'global' })
      toast.error(nextError instanceof Error ? nextError.message : '删除题目失败。')
    } finally {
      setManageDeletingId(null)
    }
  }

  const handleToggleQuestionSelection = (questionId: number, checked: boolean) => {
    setSelectedQuestionIds((current) => {
      if (checked) {
        if (current.includes(questionId)) return current
        return [...current, questionId]
      }
      return current.filter((item) => item !== questionId)
    })
  }

  const handleToggleSelectAllVisibleQuestions = (checked: boolean) => {
    setSelectedQuestionIds((current) => {
      if (checked) {
        const next = new Set(current)
        visibleQuestionIds.forEach((questionId) => next.add(questionId))
        return Array.from(next)
      }
      const visibleSet = new Set(visibleQuestionIds)
      return current.filter((questionId) => !visibleSet.has(questionId))
    })
  }

  const handleBatchDeleteQuestions = async () => {
    if (selectedQuestionIds.length === 0) return
    if (!window.confirm(`确定批量删除所选的 ${selectedQuestionIds.length} 道题吗？`)) return
    registerQuizActivity('manage_batch_delete_questions')
    emitQuizFeedback('quiz_manage_batch_delete', { label: '批量删除', audioScope: 'global' })
    setManageBulkDeleting(true)
    try {
      await batchDeletePalaceQuizQuestionsApi(selectedQuestionIds)
      toast.success(`已删除 ${selectedQuestionIds.length} 道题目`)
      emitQuizFeedback('quiz_manage_batch_delete', { label: '批量删除完成', audioScope: 'global' })
      const deletedIds = [...selectedQuestionIds]
      await refreshQuestions()
      setSelectedQuestionIds([])
      removeQuestionStates(deletedIds)
      if (editingQuestionId != null && deletedIds.includes(editingQuestionId)) {
        resetEditingState()
      }
    } catch (nextError) {
      emitQuizFeedback('quiz_error_persist_failed', { label: '批量删除失败', audioScope: 'global' })
      toast.error(nextError instanceof Error ? nextError.message : '批量删除题目失败。')
    } finally {
      setManageBulkDeleting(false)
    }
  }

  return {
    editingQuestionId,
    questionForm,
    setQuestionForm,
    manageSaving,
    manageDeletingId,
    manageBulkDeleting,
    selectedQuestionIds,
    setSelectedQuestionIds,
    allVisibleQuestionsSelected,
    handleStartCreateQuestion,
    handleEditQuestion,
    handleSaveQuestion,
    handleDeleteQuestion,
    handleToggleQuestionSelection,
    handleToggleSelectAllVisibleQuestions,
    handleBatchDeleteQuestions,
    resetEditingState,
  }
}
