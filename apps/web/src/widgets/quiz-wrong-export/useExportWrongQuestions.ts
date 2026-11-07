import { useCallback, useRef, useState } from 'react'
import { getPalaceEditorApi } from '@/modules/content/public'
import { getPalaceQuizQuestionsApi, type QuizRuntimeState } from '@/modules/quiz/public'
import type { PalaceQuizQuestion } from '@/shared/api/contracts'
import { toast } from '@/shared/feedback/toast'
import { buildMindMapOutlineText } from '@/shared/lib/mindMapOutlineText'
import {
  buildWrongQuestionsText,
  buildWrongQuestionsWithPalacesText,
  type PalaceExportSection,
} from './exportWrongQuestionsText'

export type WrongQuestionsExportMode = 'wrong-only' | 'with-palaces'

/**
 * Copy this round's wrong questions. 「完整宫殿」 additionally reads each
 * involved palace's mind map and complete question bank, because the wrong
 * question alone loses the context that explains it.
 */
export function useExportWrongQuestions() {
  const [exporting, setExporting] = useState<WrongQuestionsExportMode | null>(null)
  const requestRef = useRef(0)

  const loadPalaceSections = useCallback(async (
    wrongQuestions: readonly PalaceQuizQuestion[],
  ) => {
    const palaceIds = Array.from(new Set(
      wrongQuestions
        .map((question) => question.palace_id)
        .filter((palaceId): palaceId is number => Number.isInteger(palaceId) && palaceId > 0),
    ))
    const loaded = await Promise.all(palaceIds.map(async (palaceId): Promise<PalaceExportSection | null> => {
      try {
        const [editor, questions] = await Promise.all([
          getPalaceEditorApi(palaceId),
          getPalaceQuizQuestionsApi(palaceId),
        ])
        const title = editor.palace?.title ?? ''
        return {
          palaceId,
          title,
          outline: buildMindMapOutlineText(editor.editor_doc, { title }),
          questions: questions.items ?? [],
        }
      } catch {
        return null
      }
    }))
    const palaces = loaded.filter((section): section is PalaceExportSection => section != null)
    return { palaces, missing: palaceIds.length - palaces.length }
  }, [])

  const exportWrongQuestions = useCallback(async (
    wrongQuestions: readonly PalaceQuizQuestion[],
    mode: WrongQuestionsExportMode,
    questionStates?: Readonly<Record<number, QuizRuntimeState>>,
  ) => {
    if (wrongQuestions.length === 0) {
      toast.info('本轮还没有答错的题。')
      return
    }
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      toast.error('当前环境不支持写入剪贴板。')
      return
    }

    const requestId = requestRef.current + 1
    requestRef.current = requestId
    setExporting(mode)
    try {
      let text = buildWrongQuestionsText(wrongQuestions)
      let missingPalaces = 0
      if (mode === 'with-palaces') {
        const { palaces, missing } = await loadPalaceSections(wrongQuestions)
        missingPalaces = missing
        text = buildWrongQuestionsWithPalacesText({ wrongQuestions, palaces, questionStates })
      }
      if (requestRef.current !== requestId) return
      await navigator.clipboard.writeText(text)
      if (requestRef.current !== requestId) return
      if (missingPalaces > 0) {
        toast.warning(
          `已复制 ${wrongQuestions.length} 道错题；有 ${missingPalaces} 个宫殿的资料没取到。`,
        )
      } else if (mode === 'with-palaces') {
        toast.success(`已复制 ${wrongQuestions.length} 道错题，以及涉及宫殿的脑图与全部题目。`)
      } else {
        toast.success(`已复制 ${wrongQuestions.length} 道错题，含题干、答案与解析。`)
      }
    } catch (error) {
      if (requestRef.current !== requestId) return
      toast.error(error instanceof Error ? error.message : '导出错题失败。')
    } finally {
      if (requestRef.current === requestId) setExporting(null)
    }
  }, [loadPalaceSections])

  return { exporting, exportWrongQuestions }
}
