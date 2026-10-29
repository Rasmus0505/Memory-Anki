import { useCallback, useRef, useState } from 'react'
import { toast } from '@/shared/feedback/toast'
import {
  buildQuizQuestionsCopyText,
  type QuizCopyQuestion,
} from './quizQuestionCopyText'

/**
 * 复制题目: put the whole answering window's questions (stem, options, answer,
 * 解析) on the clipboard as plain text. The request id keeps a stale write from
 * clearing the busy state of a newer copy.
 */
export function useCopyQuizQuestionsText() {
  const [copying, setCopying] = useState(false)
  const requestRef = useRef(0)

  const copyQuestions = useCallback(async (questions: readonly QuizCopyQuestion[]) => {
    const text = buildQuizQuestionsCopyText(questions)
    if (!text) {
      toast.error('这个窗口还没有可复制的题目。')
      return
    }
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      toast.error('当前环境不支持写入剪贴板。')
      return
    }
    const requestId = requestRef.current + 1
    requestRef.current = requestId
    setCopying(true)
    try {
      await navigator.clipboard.writeText(text)
      if (requestRef.current !== requestId) return
      toast.success(`已复制 ${questions.length} 道题，含选项、答案与解析。`)
    } catch (error) {
      if (requestRef.current !== requestId) return
      toast.error(error instanceof Error ? error.message : '复制题目失败。')
    } finally {
      if (requestRef.current === requestId) setCopying(false)
    }
  }, [])

  return { copying, copyQuestions }
}
