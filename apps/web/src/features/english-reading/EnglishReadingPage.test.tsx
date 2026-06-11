import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadingMaterial, ReadingProfile, ReadingVersion, ReadingWorkspaceResponse } from '@/shared/api/contracts'
import EnglishReadingPage from '@/features/english-reading/EnglishReadingPage'

const mocks = vi.hoisted(() => ({
  completeEnglishReadingMaterialApiMock: vi.fn(),
  createEnglishReadingMaterialApiMock: vi.fn(),
  deleteEnglishReadingMaterialApiMock: vi.fn(),
  generateEnglishReadingVersionApiMock: vi.fn(),
  getEnglishReadingMaterialApiMock: vi.fn(),
  getEnglishReadingWorkspaceApiMock: vi.fn(),
  getEnglishReadingVersionApiMock: vi.fn(),
  updateEnglishReadingMaterialApiMock: vi.fn(),
  updateEnglishReadingProfileApiMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  timer: {
    effectiveSeconds: 180,
    idleSeconds: 0,
    pauseCount: 0,
    status: 'idle',
    adjustDuration: vi.fn(),
    complete: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    registerActivity: vi.fn(),
    reset: vi.fn(),
    resume: vi.fn(),
    start: vi.fn(),
  },
}))

vi.mock('@/features/english-reading/api/englishReadingApi', () => ({
  completeEnglishReadingMaterialApi: mocks.completeEnglishReadingMaterialApiMock,
  createEnglishReadingMaterialApi: mocks.createEnglishReadingMaterialApiMock,
  deleteEnglishReadingMaterialApi: mocks.deleteEnglishReadingMaterialApiMock,
  generateEnglishReadingVersionApi: mocks.generateEnglishReadingVersionApiMock,
  getEnglishReadingMaterialApi: mocks.getEnglishReadingMaterialApiMock,
  getEnglishReadingWorkspaceApi: mocks.getEnglishReadingWorkspaceApiMock,
  getEnglishReadingVersionApi: mocks.getEnglishReadingVersionApiMock,
  updateEnglishReadingMaterialApi: mocks.updateEnglishReadingMaterialApiMock,
  updateEnglishReadingProfileApi: mocks.updateEnglishReadingProfileApiMock,
}))

vi.mock('@/shared/hooks/useTimedSession', () => ({
  useTimedSession: () => ({
    ...mocks.timer,
  }),
}))

vi.mock('@/shared/components/session/SessionTimerBar', () => ({
  SessionTimerBar: () => <div data-testid="session-timer-bar" />,
}))

vi.mock('sonner', () => ({
  toast: {
    error: mocks.toastErrorMock,
    success: mocks.toastSuccessMock,
  },
}))

function buildProfile(overrides: Partial<ReadingProfile> = {}): ReadingProfile {
  return {
    declaredCefr: 'B1',
    workingLexicalI: 2.4,
    workingSyntacticI: 2.25,
    xp: 28,
    levelProgress: 28,
    confidence: 0.61,
    ...overrides,
  }
}

function buildMaterial(overrides: Partial<ReadingMaterial> = {}): ReadingMaterial {
  return {
    id: 42,
    title: 'Important acquisition was recalcitrant.',
    sourceType: 'paste',
    originalFilename: '',
    wordCount: 4,
    latestVersionId: 7,
    createdAt: '2026-06-10T08:00:00',
    updatedAt: '2026-06-10T08:00:00',
    ...overrides,
  }
}

function buildWorkspace(overrides: Partial<ReadingWorkspaceResponse> = {}): ReadingWorkspaceResponse {
  return {
    profile: buildProfile(),
    stats: {
      totalMaterials: 3,
      generatedMaterials: 2,
      completedSessions: 1,
      todayReadingSeconds: 420,
      weeklyReadingSeconds: 1260,
      totalReadingSeconds: 3600,
    },
    recentMaterials: [
      buildMaterial(),
      buildMaterial({
        id: 43,
        title: 'Napoleon reading material',
        latestVersionId: null,
      }),
    ],
    ...overrides,
  }
}

function buildVersion(overrides: Partial<ReadingVersion> = {}): ReadingVersion {
  return {
    id: 7,
    materialId: 42,
    declaredCefr: 'B1',
    workingLexicalI: 2.4,
    workingSyntacticI: 2.25,
    targetCefr: 'B2',
    targetLexicalI: 3.15,
    targetSyntacticI: 2.9,
    renderBlocks: [
      {
        id: 'paragraph-1',
        sentences: [
          {
            id: 'sentence-1',
            sentenceAnnotationId: 'sentence-1-annotation',
            displayText: 'Crucial acquisition was stubborn.',
            parts: [
              { text: 'Crucial', spanAnnotationId: 'span-1' },
              { text: ' ' },
              { text: 'acquisition', spanAnnotationId: 'span-2' },
              { text: ' was ' },
              { text: 'stubborn', spanAnnotationId: 'span-3' },
              { text: '.' },
            ],
          },
        ],
      },
    ],
    spanAnnotations: [
      {
        id: 'span-1',
        kind: 'yellow',
        originalText: 'Important',
        displayText: 'Crucial',
        sourceCefr: 'A1',
        targetCefr: 'B1',
        explainZh: '更地道的升级表达。',
      },
      {
        id: 'span-2',
        kind: 'green',
        originalText: 'acquisition',
        displayText: 'acquisition',
        sourceCefr: 'B2',
        targetCefr: 'B2',
        explainZh: '原文天然处在 i+1 区间。',
      },
      {
        id: 'span-3',
        kind: 'red',
        originalText: 'recalcitrant',
        displayText: 'stubborn',
        sourceCefr: 'C1',
        targetCefr: 'A2',
        explainZh: '先降阶，保证顺读。',
      },
    ],
    sentenceAnnotations: [
      {
        id: 'sentence-1-annotation',
        kind: 'syntax_simplified',
        originalText: 'Important acquisition was recalcitrant.',
        displayText: 'Crucial acquisition was stubborn.',
        skeletonHints: ['主语', '谓语'],
      },
    ],
    summary: {
      wordCount: 4,
      comfortCount: 1,
      growthCount: 2,
      greenCount: 1,
      yellowCount: 1,
      redCount: 1,
      sentenceSimplifiedCount: 1,
      workingLexicalI: 2.4,
      workingSyntacticI: 2.25,
      targetLexicalI: 3.15,
      targetSyntacticI: 2.9,
      targetCefr: 'B2',
    },
    createdAt: '2026-06-10T08:00:01',
    ...overrides,
  }
}

describe('EnglishReadingPage', () => {
  beforeEach(() => {
    mocks.completeEnglishReadingMaterialApiMock.mockReset()
    mocks.createEnglishReadingMaterialApiMock.mockReset()
    mocks.deleteEnglishReadingMaterialApiMock.mockReset()
    mocks.generateEnglishReadingVersionApiMock.mockReset()
    mocks.getEnglishReadingMaterialApiMock.mockReset()
    mocks.getEnglishReadingWorkspaceApiMock.mockReset()
    mocks.getEnglishReadingVersionApiMock.mockReset()
    mocks.updateEnglishReadingMaterialApiMock.mockReset()
    mocks.updateEnglishReadingProfileApiMock.mockReset()
    mocks.toastErrorMock.mockReset()
    mocks.toastSuccessMock.mockReset()
    mocks.timer.adjustDuration.mockReset()
    mocks.timer.complete.mockClear()
    mocks.timer.pause.mockReset()
    mocks.timer.registerActivity.mockReset()
    mocks.timer.reset.mockReset()
    mocks.timer.resume.mockReset()
    mocks.timer.start.mockReset()
    mocks.getEnglishReadingWorkspaceApiMock.mockResolvedValue(buildWorkspace())
    mocks.createEnglishReadingMaterialApiMock.mockResolvedValue(buildMaterial())
    mocks.generateEnglishReadingVersionApiMock.mockResolvedValue(buildVersion())
    mocks.getEnglishReadingMaterialApiMock.mockResolvedValue(buildMaterial())
    mocks.getEnglishReadingVersionApiMock.mockResolvedValue(buildVersion())
    mocks.updateEnglishReadingMaterialApiMock.mockImplementation(async (materialId: number, payload: { title: string }) =>
      buildMaterial({ id: materialId, title: payload.title }),
    )
    mocks.deleteEnglishReadingMaterialApiMock.mockResolvedValue({ deletedMaterialId: 43 })
  })

  it('creates i+1 material and expands the original sentence skeleton on click', async () => {
    render(
      <MemoryRouter initialEntries={['/english-reading']}>
        <EnglishReadingPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('建立我的 i')).toBeTruthy()
    expect(screen.getByText('最近阅读材料')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('直接粘贴英文文章全文，或者上传 txt / md / pdf 文件。'), {
      target: { value: 'Important acquisition was recalcitrant.' },
    })
    fireEvent.click(screen.getByRole('button', { name: '开始定制我的 i+1 材料' }))

    await waitFor(() => {
      expect(mocks.createEnglishReadingMaterialApiMock).toHaveBeenCalledWith({
        text: 'Important acquisition was recalcitrant.',
        file: null,
      })
    })
    expect(mocks.generateEnglishReadingVersionApiMock).toHaveBeenCalledWith(42, { mode: 'initial' })

    expect(await screen.findByText('Crucial')).toBeTruthy()
    expect(screen.getByText('acquisition')).toBeTruthy()
    expect(screen.getByText('stubborn')).toBeTruthy()

    fireEvent.click(screen.getByText('Crucial').closest('button')!)

    expect(await screen.findByText('原句骨架')).toBeTruthy()
    expect(screen.getAllByText('Important acquisition was recalcitrant.').length).toBeGreaterThan(0)
    expect(mocks.timer.start).toHaveBeenCalled()
    expect(mocks.toastSuccessMock).toHaveBeenCalledWith('i+1 阅读材料已生成。')
  })

  it('opens regenerate dialog and regenerates at the same difficulty by default', async () => {
    render(
      <MemoryRouter initialEntries={['/english-reading?material=42']}>
        <EnglishReadingPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Crucial')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '重新生成内容' }))

    expect(await screen.findByText('难度变化幅度')).toBeTruthy()
    expect(screen.getByText('0.5 级')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '确认生成' }))

    await waitFor(() => {
      expect(mocks.generateEnglishReadingVersionApiMock).toHaveBeenLastCalledWith(42, {
        mode: 'regenerate',
        difficultyDirection: 'same',
      })
    })
    expect(mocks.toastSuccessMock).toHaveBeenLastCalledWith('已重新生成当前内容。')
  })

  it('regenerates with easier direction and selected delta', async () => {
    render(
      <MemoryRouter initialEntries={['/english-reading?material=42']}>
        <EnglishReadingPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Crucial')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '重新生成内容' }))
    fireEvent.click(screen.getByRole('button', { name: /降低难度/ }))
    fireEvent.change(screen.getByLabelText('难度变化幅度'), {
      target: { value: '1.5' },
    })

    expect(screen.getByText('1.5 级')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '确认生成' }))

    await waitFor(() => {
      expect(mocks.generateEnglishReadingVersionApiMock).toHaveBeenLastCalledWith(42, {
        mode: 'regenerate',
        difficultyDirection: 'easier',
        difficultyDelta: 1.5,
      })
    })
    expect(mocks.toastSuccessMock).toHaveBeenLastCalledWith('已按更简单的难度重新生成。')
  })

  it('regenerates with harder direction', async () => {
    render(
      <MemoryRouter initialEntries={['/english-reading?material=42']}>
        <EnglishReadingPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Crucial')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '重新生成内容' }))
    fireEvent.click(screen.getByRole('button', { name: /提升难度/ }))
    fireEvent.click(screen.getByRole('button', { name: '确认生成' }))

    await waitFor(() => {
      expect(mocks.generateEnglishReadingVersionApiMock).toHaveBeenLastCalledWith(42, {
        mode: 'regenerate',
        difficultyDirection: 'harder',
        difficultyDelta: 0.5,
      })
    })
    expect(mocks.toastSuccessMock).toHaveBeenLastCalledWith('已按更高的难度重新生成。')
  })

  it('keeps regenerate dialog open when regeneration fails', async () => {
    mocks.generateEnglishReadingVersionApiMock.mockRejectedValueOnce(new Error('生成失败'))

    render(
      <MemoryRouter initialEntries={['/english-reading?material=42']}>
        <EnglishReadingPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Crucial')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '重新生成内容' }))
    fireEvent.click(screen.getByRole('button', { name: '确认生成' }))

    await waitFor(() => {
      expect(mocks.toastErrorMock).toHaveBeenCalledWith('生成失败')
    })
    expect(screen.getByText('难度变化幅度')).toBeTruthy()
  })

  it('accepts drag-and-drop file upload and uses the dropped file as the active source', async () => {
    render(
      <MemoryRouter initialEntries={['/english-reading']}>
        <EnglishReadingPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('建立我的 i')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('直接粘贴英文文章全文，或者上传 txt / md / pdf 文件。'), {
      target: { value: 'This text should not be uploaded.' },
    })

    const droppedFile = new File(['# Reader\n\nHello world'], 'reader.md', { type: 'text/markdown' })
    fireEvent.drop(screen.getByTestId('reading-file-dropzone'), {
      dataTransfer: {
        files: [droppedFile],
      },
    })

    expect(screen.getByText('已选择文件：reader.md')).toBeTruthy()
    expect(screen.getByText('当前将按文件导入生成。继续编辑上方正文可切回粘贴导入。')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '开始定制我的 i+1 材料' }))

    await waitFor(() => {
      expect(mocks.createEnglishReadingMaterialApiMock).toHaveBeenCalledWith({
        text: '',
        file: droppedFile,
      })
    })
  })

  it('opens a recent material from history and loads its version', async () => {
    render(
      <MemoryRouter initialEntries={['/english-reading']}>
        <EnglishReadingPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Napoleon reading material')).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: /打开/i })[1])

    await waitFor(() => {
      expect(mocks.getEnglishReadingMaterialApiMock).toHaveBeenCalledWith(43)
      expect(mocks.getEnglishReadingVersionApiMock).toHaveBeenCalledWith(43)
    })
  })

  it('resets the reading timer only once when a version is loaded', async () => {
    render(
      <MemoryRouter initialEntries={['/english-reading?material=42']}>
        <EnglishReadingPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Crucial')).toBeTruthy()

    await waitFor(() => {
      expect(mocks.timer.reset).toHaveBeenCalledTimes(1)
    })
    expect(mocks.timer.start).toHaveBeenCalledTimes(1)
  })

  it('renders the final sentence part text instead of stale annotation display text', async () => {
    mocks.generateEnglishReadingVersionApiMock.mockResolvedValue(
      buildVersion({
        renderBlocks: [
          {
            id: 'paragraph-1',
            sentences: [
              {
                id: 'sentence-1',
                sentenceAnnotationId: 'sentence-1-annotation',
                displayText: 'Sharper acquisition was stubborn.',
                parts: [
                  { text: 'Sharper', spanAnnotationId: 'span-1' },
                  { text: ' ' },
                  { text: 'acquisition', spanAnnotationId: 'span-2' },
                  { text: ' was ' },
                  { text: 'stubborn', spanAnnotationId: 'span-3' },
                  { text: '.' },
                ],
              },
            ],
          },
        ],
        spanAnnotations: [
          {
            id: 'span-1',
            kind: 'yellow',
            originalText: 'Important',
            displayText: 'Important',
            sourceCefr: 'A1',
            targetCefr: 'B1',
            explainZh: '更地道的升级表达。',
          },
          buildVersion().spanAnnotations[1],
          buildVersion().spanAnnotations[2],
        ],
        sentenceAnnotations: [
          {
            id: 'sentence-1-annotation',
            kind: 'syntax_simplified',
            originalText: 'Important acquisition was recalcitrant.',
            displayText: 'Sharper acquisition was stubborn.',
            skeletonHints: ['主语', '谓语'],
          },
        ],
      }),
    )

    render(
      <MemoryRouter initialEntries={['/english-reading']}>
        <EnglishReadingPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('建立我的 i')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('直接粘贴英文文章全文，或者上传 txt / md / pdf 文件。'), {
      target: { value: 'Important acquisition was recalcitrant.' },
    })
    fireEvent.click(screen.getByRole('button', { name: '开始定制我的 i+1 材料' }))

    expect(await screen.findByText('Sharper')).toBeTruthy()
  })

  it('allows renaming and deleting a recent material from history', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('Napoleon renamed')
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(
      <MemoryRouter initialEntries={['/english-reading']}>
        <EnglishReadingPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Napoleon reading material')).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1])
    await waitFor(() => {
      expect(mocks.updateEnglishReadingMaterialApiMock).toHaveBeenCalledWith(43, { title: 'Napoleon renamed' })
    })
    expect(await screen.findByText('Napoleon renamed')).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1])
    await waitFor(() => {
      expect(mocks.deleteEnglishReadingMaterialApiMock).toHaveBeenCalledWith(43)
    })
    expect(screen.queryByText('Napoleon renamed')).toBeNull()

    promptSpy.mockRestore()
    confirmSpy.mockRestore()
  })
})
