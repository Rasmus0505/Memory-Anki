import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProfileFeedbackPage from '@/features/profile/ProfileFeedbackPage'

const emitTimerCelebration = vi.fn()
const launchCelebrationPreset = vi.fn()

vi.mock('@/shared/components/session/timer-celebration', () => ({
  emitTimerCelebration: (...args: unknown[]) => emitTimerCelebration(...args),
}))

vi.mock('@/shared/components/celebration', async () => {
  const actual = await vi.importActual<typeof import('@/shared/components/celebration')>(
    '@/shared/components/celebration',
  )
  return {
    ...actual,
    launchCelebrationPreset: (...args: unknown[]) => launchCelebrationPreset(...args),
  }
})

vi.mock('@/shared/components/mindmap-host', () => ({
  MindMapFrame: () => <div data-testid="mindmap-frame">mindmap</div>,
}))

vi.mock('@/shared/components/mindmap-host/useMindMapFeedback', () => ({
  useMindMapFeedbackAudio: () => ({
    playEvent: vi.fn(),
    playComboMilestone: vi.fn(),
  }),
}))

vi.mock('@/features/review/hooks/useReviewFeedback', () => ({
  useReviewFeedback: () => ({
    settings: {},
    comboCount: 0,
    maxComboCount: 0,
    nextMilestone: null,
    milestoneLabel: null,
    allClearReady: false,
    feedbackFlashState: 'idle' as const,
    progressPercent: 0,
    progressTone: 'neutral' as const,
    surpriseText: null,
    completionCeremonyActive: false,
    animationEnabled: false,
    soundEnabled: false,
    milestoneCelebration: null,
    reviewFxSignal: null,
    emitManualEvent: vi.fn(),
    runCompletionCeremony: vi.fn(),
  }),
  usePrefersReducedMotion: () => false,
}))

vi.mock('@/entities/review/model/useRevealSession', () => ({
  useRevealSession: () => ({
    root: { id: 'root', children: [] },
    revealMap: { root: 'revealed' },
    visibleEditorState: null,
    totalNodeCount: 1,
    visibleNonRootCount: 0,
    revealedNonRootCount: 0,
    handleNodeClick: vi.fn(),
    handleNodeContextMenu: vi.fn(),
    handleNodeHover: vi.fn(),
    handleSpacePour: vi.fn(),
    reset: vi.fn(),
    setRevealMap: vi.fn(),
    nodeMap: {},
    parsedDoc: null,
    docFingerprint: '{}',
    checkpointRevealComplete: false,
    completed: false,
  }),
}))

describe('ProfileFeedbackPage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    emitTimerCelebration.mockReset()
    launchCelebrationPreset.mockReset()
  })

  it('renders key sections', () => {
    render(
      <MemoryRouter initialEntries={['/profile/feedback']}>
        <ProfileFeedbackPage />
      </MemoryRouter>,
    )

    expect(screen.getByText('反馈配置')).toBeTruthy()
    expect(screen.getByText('翻卡反馈设置')).toBeTruthy()
    expect(screen.getByText('实时预览台')).toBeTruthy()
    expect(screen.getByText('脑图宿主页预览窗口')).toBeTruthy()
    expect(screen.getByTestId('mindmap-frame')).toBeTruthy()
  })

  it('renders the five confetti type buttons with new labels', () => {
    render(
      <MemoryRouter initialEntries={['/profile/feedback']}>
        <ProfileFeedbackPage />
      </MemoryRouter>,
    )

    for (const label of ['庆祝', '爆发', '写实', '星爆', '庆典']) {
      expect(screen.getAllByRole('button', { name: label }).length).toBeGreaterThan(0)
    }
    // 形容词强度档位应已彻底移除
    expect(screen.queryByText('轻提示')).toBeNull()
    expect(screen.queryByText('电影感')).toBeNull()
  })

  it('previews the confetti type immediately when its board is clicked', () => {
    render(
      <MemoryRouter initialEntries={['/profile/feedback']}>
        <ProfileFeedbackPage />
      </MemoryRouter>,
    )

    // 点击任一场景卡片里的"爆发"板块（4 个场景卡片各有一个，取第一个）
    const burstBoards = screen.getAllByRole('button', { name: '爆发' })
    fireEvent.click(burstBoards[0])

    expect(launchCelebrationPreset).toHaveBeenCalledWith(
      expect.objectContaining({ preset: 'fireworks' }),
    )
  })

  it('renders timer preview buttons and routes them correctly', () => {
    render(
      <MemoryRouter initialEntries={['/profile/feedback']}>
        <ProfileFeedbackPage />
      </MemoryRouter>,
    )

    // 需要先展开计时器设置（点击计时器卡片中的"展开"按钮，它是第二个）
    const expandButtons = screen.getAllByRole('button', { name: '展开' })
    // 第一个是"进阶设置"展开，第二个是"计时器反馈设置"展开
    fireEvent.click(expandButtons[1])

    // 计时器预览在右侧预览台中
    fireEvent.click(screen.getByRole('button', { name: '二级子间隔' }))
    fireEvent.click(screen.getByRole('button', { name: '一级总目标' }))

    expect(emitTimerCelebration).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ kind: 'secondary' }),
    )
    expect(emitTimerCelebration).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ kind: 'primary' }),
    )
  })
})
