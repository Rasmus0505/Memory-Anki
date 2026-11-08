import { useState } from 'react'
import { FileText, LoaderCircle } from 'lucide-react'
import { getPalaceEditorApi } from '@/modules/content/public'
import { buildQuizQuestionCopyBlock, type QuizRuntimeState } from '@/modules/quiz/public'
import { formatQuizAnswerInfo } from './quizAnswerCopyText'
import type { PalaceQuizQuestion } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu'
import { toast } from '@/shared/feedback/toast'
import { buildMindMapOutlineText } from '@/shared/lib/mindMapOutlineText'
import { useExportWrongQuestions } from './useExportWrongQuestions'

export function QuizCopyQuestionsMenu({ questions, currentQuestion, wrongQuestions, questionStates, fallbackPalaceId, actionsDisabled = false }: {
  questions: readonly PalaceQuizQuestion[]
  currentQuestion: PalaceQuizQuestion | null
  wrongQuestions: readonly PalaceQuizQuestion[]
  questionStates: Readonly<Record<number, QuizRuntimeState>>
  fallbackPalaceId: number | null
  actionsDisabled?: boolean
}) {
  const [includeOutline, setIncludeOutline] = useState(false)
  const [includeAnswerInfo, setIncludeAnswerInfo] = useState(false)
  const [copying, setCopying] = useState(false)
  const { exporting, exportWrongQuestions } = useExportWrongQuestions()
  const copy = async (selected: readonly PalaceQuizQuestion[]) => {
    if (!selected.length || copying) return
    if (!navigator.clipboard?.writeText) {
      toast.error('当前环境不支持写入剪贴板。')
      return
    }
    setCopying(true)
    try {
      const text = selected.map((question, index) => {
        const block = buildQuizQuestionCopyBlock(question, index)
        return includeAnswerInfo ? `${block}\n${formatQuizAnswerInfo(question, questionStates[question.id])}` : block
      }).join('\n\n')
      let result = text
      if (includeOutline) {
        const ids = [...new Set(selected.map((question) => question.palace_id ?? fallbackPalaceId))]
        if (ids.some((id) => id == null)) throw new Error('无法确定题目所属宫殿，未复制。')
        const outlines = await Promise.all(ids.map(async (id) => {
          const response = await getPalaceEditorApi(id as number)
          const outline = buildMindMapOutlineText(response.editor_doc, { title: response.palace?.title ?? '' })
          if (!outline) throw new Error('有宫殿没有可复制的导图内容，未复制。')
          return outline
        }))
        result = `${outlines.join('\n\n────────\n\n')}\n\n────────\n\n${text}`
      }
      await navigator.clipboard.writeText(result)
      toast.success(`已复制 ${selected.length} 道题${includeOutline ? '，附带导图' : ''}。`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '复制题目失败。')
    } finally {
      setCopying(false)
    }
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="sm" variant="outline" aria-label="复制题目" disabled={actionsDisabled || copying || exporting != null || !currentQuestion}>
          {copying || exporting != null ? <LoaderCircle className="size-4 animate-spin" /> : <FileText className="size-4" />}
          <span className="hidden sm:inline">复制题目</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={actionsDisabled || !currentQuestion} onSelect={() => { if (currentQuestion) void copy([currentQuestion]) }}>导出本题</DropdownMenuItem>
        <DropdownMenuItem disabled={actionsDisabled || !questions.length} onSelect={() => void copy(questions)}>导出全部题</DropdownMenuItem>
        <DropdownMenuItem disabled={actionsDisabled || !wrongQuestions.length} onSelect={() => void copy(wrongQuestions)}>导出全部错题</DropdownMenuItem>
        <DropdownMenuItem disabled={actionsDisabled || !wrongQuestions.length} onSelect={() => void exportWrongQuestions(wrongQuestions, 'with-palaces', includeAnswerInfo ? questionStates : undefined)}>错题 + 完整宫殿</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem role="menuitemcheckbox" aria-checked={includeOutline} onSelect={(event) => { event.preventDefault(); setIncludeOutline((value) => !value) }}>
          <span aria-hidden="true" className="mr-2 w-4">{includeOutline ? '✓' : ''}</span>附带导图
        </DropdownMenuItem>
        <DropdownMenuItem role="menuitemcheckbox" aria-checked={includeAnswerInfo} onSelect={(event) => { event.preventDefault(); setIncludeAnswerInfo((value) => !value) }}>
          <span aria-hidden="true" className="mr-2 w-4">{includeAnswerInfo ? '✓' : ''}</span>答题信息
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
