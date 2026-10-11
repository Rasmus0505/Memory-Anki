import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PalaceViewPage from '@/app/router/PalaceViewPage'
import { RouteResidencyProvider } from '@/shared/routing/RouteResidency'

const mocks = vi.hoisted(() => ({
  usePalacePracticeMode: vi.fn(),
}))

vi.mock('@/shared/hooks/useMindMapDocumentSession', () => ({
  useMindMapDocumentSession: () => ({
    meta: {
      id: 101,
      title: '测试宫殿',
      description: '',
      mastered: false,
      attachments: [],
      chapters: [],
    },
    editorState: {
      editor_doc: {
        root: {
          data: { text: '测试宫殿', uid: 'root-1' },
          children: [],
        },
      },
      editor_config: {},
      editor_local_config: {},
    },
    isLoading: false,
    error: null,
  }),
}))

vi.mock('@/widgets/quiz-launcher', () => ({
  useQuizLauncher: () => ({ openQuizLauncher: vi.fn() }),
}))

vi.mock('@/modules/content/public', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/content/public')>()
  return {
    ...actual,
    usePalacePracticeMode: (...args: unknown[]) => mocks.usePalacePracticeMode(...args),
  }
})

vi.mock('@/modules/content/ui/mindmap-editor', () => ({
  MindMapEditorSurface: React.forwardRef(function MindMapEditorSurfaceMock(
    _props: unknown,
    ref: React.ForwardedRef<unknown>,
  ) {
    React.useImperativeHandle(ref, () => ({
      enterFullscreen: vi.fn(),
      exitFullscreen: vi.fn(),
      toggleUiCleared: vi.fn(),
    }))
    return <div data-testid="palace-view-mindmap" />
  }),
  MindMapPageToolbar: () => <div data-testid="palace-view-toolbar" />,
}))

describe('PalaceViewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.usePalacePracticeMode.mockReturnValue({
      editorMode: 'edit',
      activeMindMapEditorState: null,
      handleInlinePracticeNodeClick: vi.fn(),
      handleInlinePracticeNodeContextMenu: vi.fn(),
    })
  })

  it('renders the read-only palace route and forwards study route state', async () => {
    render(
      <MemoryRouter initialEntries={['/palaces/101']}>
        <RouteResidencyProvider
          value={{
            isActive: true,
            pathname: '/palaces/101',
            fullPath: '/palaces/101',
            becameActiveAt: 42,
          }}
        >
          <Routes>
            <Route path="/palaces/:id" element={<PalaceViewPage />} />
          </Routes>
        </RouteResidencyProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByText('测试宫殿')).toBeTruthy()
    expect(mocks.usePalacePracticeMode).toHaveBeenCalledWith(expect.objectContaining({
      palaceId: 101,
      currentNodeUid: null,
      onCurrentNodeUid: expect.any(Function),
      studyRoute: '/palaces/101',
      isActive: true,
    }))
  })
})
