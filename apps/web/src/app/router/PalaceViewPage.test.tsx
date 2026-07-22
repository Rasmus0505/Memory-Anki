import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PalaceViewPage from '@/app/router/PalaceViewPage'
import { RouteResidencyProvider } from '@/shared/routing/RouteResidency'

const mocks = vi.hoisted(() => ({
  useTimedSession: vi.fn(),
  useGlobalTimerRegistration: vi.fn(),
  setSceneActive: vi.fn(),
}))

const timer = {
  sessionId: 'palace-view-session',
  effectiveSeconds: 0,
  idleSeconds: 0,
  pauseCount: 0,
  status: 'idle' as const,
  startedAt: null,
  durationEdited: false,
  glowState: 'idle' as const,
  focusRound: {
    roundIndex: 1,
    startedAtEffectiveSeconds: 0,
    acknowledgedIntervalCount: 0,
    goalCelebrated: false,
  },
  start: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  setSceneActive: mocks.setSceneActive,
  leaveScene: vi.fn(),
  registerActivity: vi.fn(),
  logEvent: vi.fn(),
  acknowledgeFocusInterval: vi.fn(),
  acknowledgeFocusGoal: vi.fn(),
  startNextFocusRound: vi.fn(),
  adjustDuration: vi.fn(),
  getEffectiveSeconds: vi.fn(() => 0),
  complete: vi.fn(),
  reset: vi.fn(),
}

vi.mock('@/shared/hooks/useTimedSession', () => ({
  useTimedSession: (...args: unknown[]) => mocks.useTimedSession(...args),
}))

vi.mock('@/shared/components/session/GlobalTimerProvider', () => ({
  useGlobalTimerRegistration: (...args: unknown[]) => mocks.useGlobalTimerRegistration(...args),
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

describe('PalaceViewPage timer registration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useTimedSession.mockReturnValue(timer)
  })

  it('registers the active read-only palace route so page clicks can start or resume its timer', async () => {
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
    expect(mocks.useTimedSession).toHaveBeenCalledWith({
      kind: 'practice',
      title: '测试宫殿 · 宫殿学习',
      palaceId: 101,
      automationScene: 'practice',
      sourceKind: 'palace',
      persistKey: 'palace_view:101',
    })
    expect(mocks.useGlobalTimerRegistration).toHaveBeenCalledWith({
      scene: 'practice',
      title: '测试宫殿 · 宫殿学习',
      timer,
      isRouteActive: true,
      becameActiveAt: 42,
      routePath: '/palaces/101',
    })
    await waitFor(() => {
      expect(mocks.setSceneActive).toHaveBeenCalledWith(true, { source: 'route_active' })
    })
  })
})
