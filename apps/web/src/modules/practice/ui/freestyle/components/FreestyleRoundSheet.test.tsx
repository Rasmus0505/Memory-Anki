import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { FreestyleCard, FreestyleFeedConfig } from '@/shared/api/contracts'
import { DEFAULT_QUEUE_STATE } from '@/modules/practice/domain/queueState'
import { createRoundPlan } from '@/modules/practice/domain/roundPlan'
import { FreestyleRoundSheet } from './FreestyleRoundSheet'

const config = {
  content: { mindmap_branch: true, anki_card: true, quiz_question: true },
  palace_order: 'finish_palace_then_next',
  queue_length: 50,
  specific_palace_ids: [],
  seed: 17,
} as unknown as FreestyleFeedConfig

const card = (id: string): FreestyleCard => ({
  id,
  type: 'mindmap_branch',
  content_type: 'mindmap_branch',
  palace_id: 1,
  palace_title: '宫殿 A',
  anchor_uid: `${id}-anchor`,
  context_path: [{ uid: `${id}-anchor`, text: id }],
  node_uids: [`${id}-node`],
  node_count: 1,
  unit_id: `${id}-unit`,
  unit_revision: 1,
})

function renderSheet(overrides: Partial<Parameters<typeof FreestyleRoundSheet>[0]> = {}) {
  const cards = [card('one'), card('two')]
  const callbacks = {
    onOpenChange: vi.fn(),
    onJump: vi.fn(),
    onExclude: vi.fn(),
    onRestore: vi.fn(),
    onReorder: vi.fn(),
    onResetRound: vi.fn(),
    onOpenConfig: vi.fn(),
  }
  const props = {
    open: true,
    cards,
    currentIndex: 0,
    queueState: { ...DEFAULT_QUEUE_STATE, roundId: 'round-1', currentCardId: 'one' },
    roundPlan: createRoundPlan('round-1', cards, config, {
      candidate_count: 8,
      scheduled_count: 2,
      queue_limit: 50,
      limit_reached: false,
    }),
    queueLimit: 50,
    ...callbacks,
    ...overrides,
  }
  render(<FreestyleRoundSheet {...props} />)
  return callbacks
}

describe('FreestyleRoundSheet', () => {
  it('groups the round by palace and reports the scheduled counts', async () => {
    renderSheet()

    expect(await screen.findByText('宫殿 A')).toBeTruthy()
    expect(screen.getByText('本轮 2 张 · 今天库里还到期 6 张没进本轮 · 上限 50')).toBeTruthy()
  })

  it('supports batch exclusion', () => {
    const { onExclude } = renderSheet()

    fireEvent.click(screen.getByRole('checkbox', { name: '选择one' }))
    fireEvent.click(screen.getByRole('button', { name: '排除选中' }))
    expect(onExclude).toHaveBeenCalledWith(['one'])
  })

  it('marks the current card and shows a drop placeholder while reordering', () => {
    const { onReorder } = renderSheet()

    expect(screen.getByTestId('round-plan-card-one').className).toContain('bg-emerald-500/12')
    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      setData: vi.fn(),
      getData: vi.fn(() => 'one'),
    }
    act(() => {
      fireEvent.dragStart(screen.getByTestId('round-plan-card-two'), { dataTransfer })
      fireEvent.dragOver(screen.getByTestId('round-plan-card-one'), { dataTransfer })
    })
    expect(screen.getByTestId('round-plan-drop-placeholder')).toBeTruthy()
    act(() => {
      fireEvent.drop(screen.getByTestId('round-plan-card-one'), { dataTransfer })
    })
    expect(onReorder).toHaveBeenCalledWith(['two', 'one'])
  })

  it('jumps to a card that is still live in the queue', () => {
    const { onJump } = renderSheet()

    fireEvent.click(screen.getByRole('button', { name: 'one' }))
    expect(onJump).toHaveBeenCalledWith('one')
  })

  it('hands configuration to its own surface instead of sharing this one', () => {
    const { onOpenConfig } = renderSheet()

    fireEvent.click(screen.getByRole('button', { name: '调整配置' }))
    expect(onOpenConfig).toHaveBeenCalledTimes(1)
  })

  it('shows rebuild progress and blocks duplicate clicks', async () => {
    const { onResetRound } = renderSheet({ loading: true })

    await screen.findByText('宫殿 A')
    const button = screen.getByRole('button', { name: '正在安排...' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    act(() => fireEvent.click(button))
    expect(onResetRound).not.toHaveBeenCalled()
  })

  it('states an empty round plainly', () => {
    renderSheet({ cards: [], roundPlan: null })

    expect(screen.getByText('当前还没有本轮安排。')).toBeTruthy()
  })
})
