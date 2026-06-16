import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  baseQuestions,
  batchCreateChapterQuizQuestionsApiMock,
  classifyPalaceQuizQuestionsToMiniPalacesApiMock,
  getPalaceApiMock,
  getSubjectsApiMock,
  getSubjectTreeApiMock,
  palaceResponse,
  pdfControllerMock,
  previewPalaceQuizGenerationFromPdfStreamApiMock,
  recoverAndSavePalaceQuizGenerationFromAiLogApiMock,
  refreshSubjectDocumentsMock,
  renderPage,
  setupPalaceQuizPageTest,
  uploadSubjectDocumentApiMock,
} from '@/features/palace-quiz/PalaceQuizPage.test-utils'

describe('PalaceQuizPage generation flows', () => {
  beforeEach(setupPalaceQuizPageTest)

  it('shows chapter-range controls and saves grouped preview', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'AI生成' }))
    fireEvent.click(screen.getByRole('button', { name: '归类已有题库' }))
    expect(await screen.findByText('本次写入 1 道小宫殿题。')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('例如：3,4,8-10'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: '加入本次资料集' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /按小宫殿分类保存/ }))
    fireEvent.click(screen.getByRole('button', { name: '生成预览' }))

    await waitFor(() => {
      expect(previewPalaceQuizGenerationFromPdfStreamApiMock).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          classify_by_mini_palace: true,
          enable_secondary_review: false,
          selected_chapter_id: 1,
        }),
        expect.any(Object),
      )
    })

    fireEvent.click(await screen.findByRole('button', { name: '保存到题库' }))
    await waitFor(() => {
      expect(recoverAndSavePalaceQuizGenerationFromAiLogApiMock).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          ai_call_log_id: 'log-preview',
          selected_chapter_id: 1,
          classify_by_mini_palace: true,
        }),
      )
    })
    expect(batchCreateChapterQuizQuestionsApiMock).not.toHaveBeenCalled()
    expect(classifyPalaceQuizQuestionsToMiniPalacesApiMock).toHaveBeenCalled()
  })

  it('falls back to direct batch save when preview has no ai log id', async () => {
    previewPalaceQuizGenerationFromPdfStreamApiMock.mockResolvedValueOnce({
      palace_id: 1,
      questions: [
        {
          question_type: 'multiple_choice',
          stem: '直接保存题目',
          options: [
            { id: 'A', text: '选项A' },
            { id: 'B', text: '选项B' },
          ],
          answer_payload: { correct_option_id: 'A' },
          analysis: '解析',
          source_meta: {
            source_kind: 'subject_pdf',
            subject_document_id: 9,
            page_numbers: [3],
            image_names: ['page-3.png'],
            extra_prompt: '',
            ai_call_log_id: null,
            generated_at: '2026-06-15T00:00:00',
            generation_mode: 'subject_pdf',
          },
        },
      ],
      source_meta: {
        source_kind: 'subject_pdf',
        subject_document_id: 9,
        page_numbers: [3],
        image_names: ['page-3.png'],
        extra_prompt: '',
        ai_call_log_id: null,
        generated_at: '2026-06-15T00:00:00',
        generation_mode: 'subject_pdf',
      },
      ai_call_log_id: null,
      grouped_questions: null,
    })

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'AI生成' }))
    fireEvent.change(screen.getByPlaceholderText('例如：3,4,8-10'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: '加入本次资料集' }))
    fireEvent.click(screen.getByRole('button', { name: '生成预览' }))
    fireEvent.click(await screen.findByRole('button', { name: '保存到题库' }))

    await waitFor(() => {
      expect(batchCreateChapterQuizQuestionsApiMock).toHaveBeenCalledWith(
        1,
        expect.arrayContaining([
          expect.objectContaining({
            source_chapter_id: 1,
            classified_chapter_id: null,
          }),
        ]),
      )
    })
  })

  it('collects multiple pdf sources before generating preview', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'AI生成' }))
    fireEvent.change(screen.getByPlaceholderText('例如：3,4,8-10'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: '加入本次资料集' }))

    const roleSelect = screen.getByDisplayValue('题目') as HTMLSelectElement
    fireEvent.change(roleSelect, { target: { value: 'answer' } })
    fireEvent.click(screen.getByRole('button', { name: '生成预览' }))

    await waitFor(() => {
      expect(previewPalaceQuizGenerationFromPdfStreamApiMock).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          pdf_sources: [
            expect.objectContaining({
              subject_document_id: 9,
              page_selection: [3],
              role_hint: 'answer',
            }),
          ],
          selected_chapter_id: 1,
        }),
        expect.any(Object),
      )
    })
  })

  it('renders secondary review toggle and sends it when enabled', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'AI生成' }))
    fireEvent.change(screen.getByPlaceholderText('例如：3,4,8-10'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: '加入本次资料集' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /二次筛选/ }))
    fireEvent.click(screen.getByRole('button', { name: '生成预览' }))

    await waitFor(() => {
      expect(previewPalaceQuizGenerationFromPdfStreamApiMock).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ enable_secondary_review: true, selected_chapter_id: 1 }),
        expect.any(Object),
      )
    })
  })

  it('stores generation history and regenerates from it', async () => {
    pdfControllerMock.rangePrompt = '只生成本章重点题'
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'AI生成' }))
    fireEvent.change(screen.getByPlaceholderText('例如：3,4,8-10'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: '加入本次资料集' }))
    fireEvent.click(screen.getByRole('button', { name: '生成预览' }))
    await waitFor(() => {
      expect(previewPalaceQuizGenerationFromPdfStreamApiMock).toHaveBeenCalledTimes(1)
    })
    fireEvent.click(screen.getAllByRole('button', { name: '重新生成' })[0])
    await waitFor(() => {
      expect(previewPalaceQuizGenerationFromPdfStreamApiMock).toHaveBeenCalledTimes(2)
    })
  })

  it('loads a saved history item back into the source panel', async () => {
    window.localStorage.setItem(
      'memory_anki_palace_quiz_generation_history_1',
      JSON.stringify([
        {
          id: 'history-1',
          createdAt: '2026-06-15T08:00:00.000Z',
          sourceKind: 'subject-pdf',
          title: 'questions.pdf',
          extraPrompt: '按大题拆分并提高难度',
          enableSecondaryReview: true,
          classifyByMiniPalace: true,
          selectedChapterId: 101,
          selectedChapterPath: '生物 / 第三章 / 第二节',
          pdfSources: [
            {
              subject_document_id: 9,
              document_name: 'questions.pdf',
              page_selection: [3],
              role_hint: 'question',
            },
          ],
          imageFileNames: [],
          previewQuestionCount: 2,
          savableQuestionCount: 1,
          aiCallLogId: 'log-preview',
        },
      ]),
    )

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'AI生成' }))
    fireEvent.click(screen.getByRole('button', { name: '导入到左侧' }))
    expect(pdfControllerMock.setSelectedSubjectId).toHaveBeenCalledWith(2)
    expect(await screen.findByText('生物 / 第三章 / 第二节')).toBeTruthy()
  })

  it('opens the range dialog and lets the user switch to a child chapter', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'AI生成' }))
    fireEvent.click(screen.getByRole('button', { name: '选择范围' }))
    await screen.findByText(
      '选择本次 AI 生成题目所属的章节范围。一次只能选择一个章节节点，也支持直接选择父级大章节整章生成。',
    )
    fireEvent.click(screen.getByRole('button', { name: /第二节/ }))
    fireEvent.click(screen.getByRole('button', { name: '确认范围' }))
    expect(await screen.findByText('生物 / 第三章 / 第二节')).toBeTruthy()
  })

  it('allows selecting an ancestor chapter when only a child chapter is explicitly bound', async () => {
    getPalaceApiMock.mockResolvedValueOnce({
      ...palaceResponse,
      primary_chapter_id: 101,
      primary_chapter: { id: 101, name: '第二节', subject_id: 2, parent_id: 1 },
      chapters: [
        { id: 1, name: '第三章', subject_id: 2, parent_id: null, is_explicit: false, subject: { id: 2, name: '生物' } },
        { id: 101, name: '第二节', subject_id: 2, parent_id: 1, is_explicit: true, subject: { id: 2, name: '生物' } },
      ],
    })

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'AI生成' }))
    fireEvent.click(screen.getByRole('button', { name: '选择范围' }))
    fireEvent.click(await screen.findByRole('button', { name: /第三章/ }))
    fireEvent.click(screen.getByRole('button', { name: '确认范围' }))
    expect(await screen.findByText('生物 / 第三章')).toBeTruthy()
  })

  it('opens the file picker from the upload button', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click')
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'AI生成' }))
    fireEvent.click(screen.getByRole('button', { name: '上传新 PDF 到资料库' }))
    expect(clickSpy).toHaveBeenCalled()
    clickSpy.mockRestore()
  })

  it('uploads the selected pdf and refreshes the subject documents', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'AI生成' }))
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement | null
    const file = new File(['%PDF-1.4'], 'uploaded.pdf', { type: 'application/pdf' })
    fireEvent.change(fileInput!, { target: { files: [file] } })
    await waitFor(() => {
      expect(uploadSubjectDocumentApiMock).toHaveBeenCalledWith(2, file)
    })
    await waitFor(() => {
      expect(refreshSubjectDocumentsMock).toHaveBeenCalled()
    })
    expect(getSubjectsApiMock).toHaveBeenCalled()
    expect(getSubjectTreeApiMock).toHaveBeenCalled()
  })
})
