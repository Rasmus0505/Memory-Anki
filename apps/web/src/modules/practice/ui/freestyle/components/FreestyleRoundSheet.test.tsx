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
    expect(screen.getByText('本轮 2 张')).toBeTruthy()
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

  it('states an empty round plainly', () => {
    renderSheet({ cards: [], roundPlan: null })

    expect(screen.getByText('当前还没有本轮安排。')).toBeTruthy()
  })

  it('splits leftover and today into two blocks and rejects cross-block drag', () => {
    const cards = [card('one'), card('two')]
    const base = createRoundPlan('round-1', cards, config)
    const { onReorder } = renderSheet({
      cards,
      roundPlan: {
        ...base,
        today: '2026-09-18',
        cardsById: {
          ...base.cardsById,
          one: { ...base.cardsById.one, enteredOn: '2026-09-17' },
          two: { ...base.cardsById.two, enteredOn: '2026-09-18' },
        },
      },
    })

    expect(screen.getByTestId('round-plan-cohort-carried').textContent).toContain('此前欠账')
    expect(screen.getByTestId('round-plan-cohort-today').textContent).toContain('今天新增')
    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      setData: vi.fn(),
      getData: vi.fn(() => 'two'),
    }
    act(() => {
      fireEvent.dragStart(screen.getByTestId('round-plan-card-two'), { dataTransfer })
      fireEvent.drop(screen.getByTestId('round-plan-card-one'), { dataTransfer })
    })
    expect(onReorder).not.toHaveBeenCalled()
  })

  it('styles completed retry rows differently from unfinished retry rows', () => {
    const source = card('one')
    const other = card('two')
    const retry = {
      ...card('retry:round-1:one:1'),
      source_card_id: 'one',
      occurrence_kind: 'retry' as const,
      retry_attempt: 1,
    }
    const pendingRetry = {
      ...card('retry:round-1:two:2'),
      source_card_id: 'two',
      occurrence_kind: 'retry' as const,
      retry_attempt: 2,
    }
    const cards = [source, other, retry, pendingRetry]
    const base = createRoundPlan('round-1', cards, config)
    renderSheet({
      cards,
      currentIndex: 0,
      queueState: {
        ...DEFAULT_QUEUE_STATE,
        roundId: 'round-1',
        currentCardId: 'one',
        completedIds: ['retry:round-1:one:1'],
      },
      roundPlan: {
        ...base,
        cardsById: {
          ...base.cardsById,
          'retry:round-1:one:1': {
            ...base.cardsById['retry:round-1:one:1'],
            occurrenceKind: 'retry',
            retryAttempt: 1,
            sourceCardId: 'one',
            status: 'completed',
          },
          'retry:round-1:two:2': {
            ...base.cardsById['retry:round-1:two:2'],
            occurrenceKind: 'retry',
            retryAttempt: 2,
            sourceCardId: 'two',
            status: 'retry',
          },
        },
      },
    })

    const doneRow = screen.getByTestId('round-plan-card-retry:round-1:one:1')
    const pendingRow = screen.getByTestId('round-plan-card-retry:round-1:two:2')
    expect(doneRow.getAttribute('data-retry')).toBe('done')
    expect(pendingRow.getAttribute('data-retry')).toBe('pending')
    expect(doneRow.textContent).toContain('重练已过')
    expect(pendingRow.textContent).toContain('待重练')
    expect(pendingRow.className).toContain('bg-amber-500/10')
    expect(doneRow.className).toContain('bg-emerald-500/8')
  })

  it('keeps a completed retry row filled when the live glance has no rating yet', () => {
    const retry = {
      ...card('retry:round-1:one:1'),
      source_card_id: 'one',
      occurrence_kind: 'retry' as const,
      retry_attempt: 1,
    }
    const cards = [card('one'), retry]
    const base = createRoundPlan('round-1', cards, config)
    renderSheet({
      cards,
      currentIndex: 1,
      queueState: {
        ...DEFAULT_QUEUE_STATE,
        roundId: 'round-1',
        currentCardId: retry.id,
        completedIds: [retry.id],
        unitEncountersByCardId: {
          [retry.id]: {
            encounterId: 'enc-retry',
            unitRevision: 1,
            status: 'open',
            sessionId: 'session-retry',
            selectedRating: null,
            passed: null,
            retryAfterCards: 0,
          },
        },
      },
      roundPlan: {
        ...base,
        cardsById: {
          ...base.cardsById,
          [retry.id]: {
            ...base.cardsById[retry.id],
            occurrenceKind: 'retry',
            retryAttempt: 1,
            sourceCardId: 'one',
            status: 'completed',
          },
        },
      },
    })

    const row = screen.getByTestId(`round-plan-card-${retry.id}`)
    expect(row.getAttribute('data-retry')).toBe('done')
    expect(row.getAttribute('data-fill')).toBe('completed')
    expect(row.textContent).toContain('当前 · 已过')
  })
})
