import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  batchCreateChapterQuizQuestionsApiMock,
  classifyPalaceQuizQuestionsToMiniPalacesApiMock,
  getPalaceApiMock,
  getSubjectsApiMock,
  getSubjectTreeApiMock,
  palaceResponse,
  previewPalaceQuizGenerationFromImagesApiMock,
  previewPalaceQuizGenerationFromTextFilesApiMock,
  renderPage,
  setupPalaceQuizPageTest,
} from '@/features/palace-quiz/PalaceQuizPage.test-utils'

describe('PalaceQuizPage generation flows', () => {
  beforeEach(setupPalaceQuizPageTest)

  it('generates from image files and saves the preview to the selected chapter', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'AI生成' }))
    fireEvent.click(screen.getByRole('button', { name: '归类已有题库' }))
    expect(await screen.findByText('本次写入 1 道训练关卡题。')).toBeTruthy()

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement | null
    const imageFile = new File(['image'], 'bio-question.png', { type: 'image/png' })
    fireEvent.change(fileInput!, { target: { files: [imageFile] } })
    fireEvent.click(screen.getByRole('checkbox', { name: /按训练关卡分类保存/ }))
    fireEvent.click(screen.getByRole('button', { name: '生成预览' }))

    await waitFor(() => {
      expect(previewPalaceQuizGenerationFromImagesApiMock).toHaveBeenCalledWith(
        1,
        [imageFile],
        '',
        true,
        1,
        {},
      )
    })

    fireEvent.click(await screen.findByRole('button', { name: '保存到题库' }))
    await waitFor(() => {
      expect(batchCreateChapterQuizQuestionsApiMock).toHaveBeenCalledWith(
        1,
        expect.arrayContaining([
          expect.objectContaining({
            source_chapter_id: 1,
            classified_chapter_id: 101,
          }),
        ]),
        'append',
        expect.objectContaining({ palaceId: 1, ocrSources: [] }),
      )
    })
    expect(classifyPalaceQuizQuestionsToMiniPalacesApiMock).toHaveBeenCalled()
  })

  it('sends overwrite mode when saving a generated image preview with coverage selected', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'AI生成' }))

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement | null
    const imageFile = new File(['image'], 'overwrite.png', { type: 'image/png' })
    fireEvent.change(fileInput!, { target: { files: [imageFile] } })
    fireEvent.click(screen.getByRole('button', { name: '生成预览' }))
    fireEvent.click(await screen.findByRole('button', { name: '覆盖当前范围' }))
    fireEvent.click(screen.getByRole('button', { name: '保存到题库' }))

    await waitFor(() => {
      expect(batchCreateChapterQuizQuestionsApiMock).toHaveBeenCalledWith(
        1,
        expect.arrayContaining([expect.objectContaining({ stem: '细胞的控制中心是？' })]),
        'overwrite',
        expect.objectContaining({ palaceId: 1, ocrSources: [] }),
      )
    })
  })

  it('stores generation history and can load image configuration back into the source panel', async () => {
    window.localStorage.setItem(
      'memory_anki_palace_quiz_generation_history_1',
      JSON.stringify([
        {
          id: 'history-1',
          createdAt: '2026-06-15T08:00:00.000Z',
          sourceKind: 'image-single',
          title: 'question.png',
          extraPrompt: '提高难度',
          enableSecondaryReview: true,
          classifyByMiniPalace: true,
          selectedChapterId: 101,
          selectedChapterPath: '生物 / 第三章 / 第二节',
          imageFileNames: ['question.png'],
          previewQuestionCount: 2,
          savableQuestionCount: 1,
          aiCallLogId: 'log-preview',
        },
      ]),
    )

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'AI生成' }))
    fireEvent.click(screen.getByRole('button', { name: '导入到左侧' }))
    expect(await screen.findByText('生物 / 第三章 / 第二节')).toBeTruthy()
    expect(screen.getByText('文件历史会回填提示词和开关，但仍需重新上传源文件。')).toBeTruthy()
  })

  it('opens the range dialog and lets the user switch to a child chapter', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'AI生成' }))
    fireEvent.click(screen.getByRole('button', { name: '选择范围' }))
    await screen.findByText(
      '选择本次 AI 生成题目所属的章节范围。一次只能选择一个章节，也支持直接选择父级大章节整章生成。',
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

  it('supports text file manual import from the generation panel', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'AI生成' }))
    fireEvent.click(screen.getByRole('button', { name: '文本/手动导入' }))

    expect(await screen.findByText('文本文件导入说明')).toBeTruthy()
    expect(screen.getByText('给 AI 的格式修正提示词')).toBeTruthy()

    const fileInput = document.querySelector(
      'input[accept*=".txt"]',
    ) as HTMLInputElement | null
    const questionFile = new File(['单项选择题'], 'bio_questions.txt', { type: 'text/plain' })
    const answerFile = new File(['1.【答案】A'], 'bio_answers.txt', { type: 'text/plain' })
    fireEvent.change(fileInput!, { target: { files: [questionFile, answerFile] } })
    fireEvent.click(screen.getByRole('button', { name: '生成预览' }))

    await waitFor(() => {
      expect(previewPalaceQuizGenerationFromTextFilesApiMock).toHaveBeenCalledWith(
        1,
        [questionFile, answerFile],
        '',
        false,
        1,
        {},
      )
    })
    expect(await screen.findByText('简述细胞核的作用。')).toBeTruthy()
    expect(getSubjectsApiMock).toHaveBeenCalled()
    expect(getSubjectTreeApiMock).toHaveBeenCalled()
  })
})
