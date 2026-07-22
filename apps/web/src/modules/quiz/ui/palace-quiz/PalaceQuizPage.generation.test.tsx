import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  addQuizPdfSourceApiMock,
  addQuizTextSourceApiMock,
  batchCreateChapterQuizQuestionsApiMock,
  buildWorkspaceJob,
  extractMatchQuizJobApiMock,
  generateQuizWorkspacePreviewApiMock,
  listQuizGenerationJobsApiMock,
  renderPage,
  setupPalaceQuizPageTest,
  updateQuizMatchingApiMock,
  workspaceQuestion,
} from '@/modules/quiz/ui/palace-quiz/PalaceQuizPage.test-utils'

describe('PalaceQuizPage unified generation workspace', () => {
  beforeEach(setupPalaceQuizPageTest)

  it('shows one unified question and answer workspace without single-image or batch-image tabs', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'AI生成' }))
    expect(await screen.findByText('AI 题库生成工作台')).toBeTruthy()
    expect(screen.getByText('题目来源')).toBeTruthy()
    expect(screen.getByText('答案来源')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '单图' })).toBeNull()
    expect(screen.queryByRole('button', { name: '多图' })).toBeNull()
  })

  it('adds independent question text and answer PDF sources', async () => {
    const jobWithSources = buildWorkspaceJob({
      sources: [
        { id: 1, role: 'question', source_type: 'text', sort_order: 0, display_name: '题目文本', original_name: '', mime_type: '', file_size: 0, text_content: '题目', pdf_asset_id: null, page_numbers: [], config: {} },
        { id: 2, role: 'answer', source_type: 'pdf', sort_order: 1, display_name: '生物题库', original_name: '', mime_type: '', file_size: 0, text_content: '', pdf_asset_id: 7, page_numbers: [20, 21], config: {} },
      ],
    })
    listQuizGenerationJobsApiMock.mockResolvedValue({ items: [jobWithSources] })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'AI生成' }))
    const textareas = await screen.findAllByPlaceholderText(/粘贴.*来源文本/)
    fireEvent.change(textareas[0], { target: { value: '1. 细胞的控制中心是什么？' } })
    fireEvent.click(screen.getAllByRole('button', { name: '添加文本' })[0])
    await waitFor(() => expect(addQuizTextSourceApiMock).toHaveBeenCalled())

    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[1], { target: { value: '7' } })
    const pageInputs = screen.getAllByPlaceholderText('页码：1-10,15')
    fireEvent.change(pageInputs[1], { target: { value: '20-21' } })
    fireEvent.click(screen.getAllByRole('button', { name: '添加' })[1])
    await waitFor(() => expect(addQuizPdfSourceApiMock).toHaveBeenCalledWith('job-1', expect.objectContaining({ role: 'answer', pdf_asset_id: 7, page_expression: '20-21' })))
  })

  it('extracts mixed sources, allows matching edits, and generates a preview', async () => {
    listQuizGenerationJobsApiMock.mockResolvedValue({ items: [buildWorkspaceJob({
      sources: [{ id: 1, role: 'question', source_type: 'image', sort_order: 0, display_name: 'question.png', original_name: 'question.png', mime_type: 'image/png', file_size: 10, text_content: '', pdf_asset_id: null, page_numbers: [], config: {} }],
    })] })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'AI生成' }))
    fireEvent.click(await screen.findByRole('button', { name: '解析并匹配' }))
    await waitFor(() => expect(extractMatchQuizJobApiMock).toHaveBeenCalled())
    const questionEditor = await screen.findByDisplayValue(workspaceQuestion.stem)
    fireEvent.change(questionEditor, { target: { value: '细胞的遗传控制中心是？' } })
    fireEvent.click(await screen.findByRole('button', { name: '保存修正' }))
    await waitFor(() => expect(updateQuizMatchingApiMock).toHaveBeenCalledWith('job-1', expect.arrayContaining([expect.objectContaining({ question_text: '细胞的遗传控制中心是？' })])))
    fireEvent.click(screen.getByRole('button', { name: '确认并生成题库' }))
    await waitFor(() => expect(generateQuizWorkspacePreviewApiMock).toHaveBeenCalledWith('job-1'))
  })

  it('saves a persistent preview with overwrite mode to the selected chapter', async () => {
    listQuizGenerationJobsApiMock.mockResolvedValue({ items: [buildWorkspaceJob({
      status: 'preview', preview: { palace_id: 1, questions: [workspaceQuestion], source_meta: { source_kind: 'workspace', generation_mode: 'workspace' }, ai_call_log_id: null, warnings: [], generation_stats: { returned_count: 1, savable_count: 1, skipped_count: 0 }, grouped_questions: null },
    })] })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'AI生成' }))
    const saveModeSelect = await screen.findByDisplayValue('追加保存')
    fireEvent.change(saveModeSelect, { target: { value: 'overwrite' } })
    await screen.findByDisplayValue('覆盖章节题库')
    fireEvent.click(screen.getByRole('button', { name: '保存到题库' }))
    await waitFor(() => expect(batchCreateChapterQuizQuestionsApiMock).toHaveBeenCalledWith(1, expect.arrayContaining([expect.objectContaining({ stem: workspaceQuestion.stem })]), 'overwrite', expect.objectContaining({ palaceId: 1 })))
  })

  it('opens the existing range dialog from the workspace', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'AI生成' }))
    fireEvent.click(await screen.findByRole('button', { name: '修改范围' }))
    const description = await screen.findByText('选择本次 AI 生成题目所属的章节范围。一次只能选择一个章节，也支持直接选择父级大章节整章生成。')
    fireEvent.click(screen.getByRole('button', { name: '确认范围' }))
    await waitFor(() => expect(description.isConnected).toBe(false))
  })

  it('clears obsolete local generation history without deleting the formal question bank', async () => {
    window.localStorage.setItem('memory_anki_palace_quiz_generation_history_1', '[{"id":"legacy"}]')
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'AI生成' }))
    await screen.findByText('AI 题库生成工作台')
    await waitFor(() => expect(window.localStorage.getItem('memory_anki_palace_quiz_generation_history_1')).toBeNull())
  })
})
