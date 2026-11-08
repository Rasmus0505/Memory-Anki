import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getPalacesGroupedApi } from '@/modules/content/domain/palace-entity/api'
import { getSubjectsApi, getSubjectTreeApi } from '@/modules/content/domain/knowledge-entity/api'
import { resetPalaceDirectoryViewState } from '@/modules/content/ui/palace-edit/model/palaceDirectoryViewState'
import type { RoundPalaceStatus } from '@/modules/content/ui/palace-edit/components/palaceDirectoryTreeChrome'
import { FreestylePalaceDirectoryPanel } from './FreestylePalaceDirectoryPanel'

vi.mock('@/modules/content/domain/palace-entity/api', () => ({
  getPalacesGroupedApi: vi.fn(),
}))
vi.mock('@/modules/content/domain/knowledge-entity/api', () => ({
  getSubjectsApi: vi.fn(),
  getSubjectTreeApi: vi.fn(),
}))

const subject = { id: 1, name: '中国教育史', color: '#6366f1', sort_order: 0 }

function palace(id: number, title: string) {
  return {
    id,
    title,
    resolved_title: title,
    description: '',
    created_at: null,
    next_review_at: null,
    has_due_review: false,
    review_status: 'scheduled' as const,
    review_unit_count: 0,
    due_review_unit_count: 0,
    permanent_mark_count: 0,
    title_mode: 'sync',
    manual_title: '',
    grouping_mode: 'auto',
    manual_group_chapter_id: null,
    binding_status: 'bound',
    primary_chapter_id: 10,
    primary_chapter: null,
    resolved_subject: subject,
    resolved_parent_chapter: null,
    group_id: null,
    group_sort_order: 0,
  }
}

function renderPanel(
  collapsed = false,
  hidden = false,
  queuedPalaces?: ReadonlyMap<number, RoundPalaceStatus>,
) {
  const onSelectPalace = vi.fn()
  const onCollapsedChange = vi.fn()
  const view = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <FreestylePalaceDirectoryPanel
          currentPalaceId={11}
          queuedPalaces={queuedPalaces}
          collapsed={collapsed}
          onCollapsedChange={onCollapsedChange}
          onSelectPalace={onSelectPalace}
          hidden={hidden}
        >
          <div data-testid="freestyle-stage">stage</div>
        </FreestylePalaceDirectoryPanel>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { onSelectPalace, onCollapsedChange, ...view }
}

beforeEach(() => {
  resetPalaceDirectoryViewState()
  vi.mocked(getSubjectsApi).mockResolvedValue([subject] as never)
  vi.mocked(getSubjectTreeApi).mockResolvedValue({
    subject,
    chapters: [{ id: 10, name: '第二节 汉代', children: [] }],
  } as never)
  vi.mocked(getPalacesGroupedApi).mockResolvedValue({
    groups: [],
    ungrouped: [],
    subjects: [{
      subject,
      chapter_groups: [{
        source_chapter: { id: 10, name: '第二节 汉代', subject_id: 1 },
        palaces: [palace(11, '已打开的宫殿'), palace(12, '另一座宫殿')],
      }],
      ungrouped_palaces: [],
    }],
  } as never)
})

describe('FreestylePalaceDirectoryPanel', () => {
  it('opens a palace from the directory without leaving the feed', async () => {
    const { onSelectPalace } = renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: '另一座宫殿' }))

    expect(onSelectPalace).toHaveBeenCalledWith(12)
    expect(screen.getByTestId('freestyle-stage')).toBeTruthy()
  })

  it('marks every palace the current round still holds', async () => {
    renderPanel(false, false, new Map<number, RoundPalaceStatus>([[11, 'done'], [12, 'unrated']]))

    const currentRow = await screen.findByRole('button', { name: '已打开的宫殿' })
    const otherRow = screen.getByRole('button', { name: '另一座宫殿' })

    expect(currentRow.getAttribute('aria-current')).toBe('page')
    expect(otherRow.getAttribute('data-round-queued')).toBe('true')
    expect(otherRow.querySelector('[data-round-dot="palace"]')?.getAttribute('data-round-status')).toBe('unrated')
  })

  it('owns its collapse rail instead of the app navigation', async () => {
    const { onCollapsedChange, rerender } = renderPanel()

    const heading = await screen.findByText('记忆宫殿')
    expect(heading.closest('aside')?.getAttribute('aria-hidden')).toBe('false')
    expect(screen.getByRole('tab', { name: '目录' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: '随心列表' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '收起宫殿目录' })).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: '收起宫殿目录' }))
    expect(onCollapsedChange).toHaveBeenCalledWith(true)

    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <FreestylePalaceDirectoryPanel
            currentPalaceId={11}
            collapsed
            onCollapsedChange={onCollapsedChange}
            onSelectPalace={vi.fn()}
          >
            <div data-testid="freestyle-stage">stage</div>
          </FreestylePalaceDirectoryPanel>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByText('记忆宫殿').closest('aside')?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByTestId('freestyle-stage')).toBeTruthy()
  })

  it('keeps queue filters across tabs and suspends shortcuts only in the open queue', () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <FreestylePalaceDirectoryPanel
            currentPalaceId={11}
            collapsed={false}
            onCollapsedChange={vi.fn()}
            onSelectPalace={vi.fn()}
            queuePanel={{
              cards: [], roundPlan: null, completedIds: [], hiddenIds: [], encounters: {},
              currentCardId: null, ratingSaveEntries: {}, onExclude: vi.fn(), onRestore: vi.fn(),
              onReorder: vi.fn(), onRateCards: () => ({ queued: 0, unchanged: 0, skipped: 0 }),
            }}
          >stage</FreestylePalaceDirectoryPanel>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const panel = screen.getByTestId('freestyle-queue-panel')
    expect(panel.getAttribute('data-keyboard-shortcuts-suspended')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: '随心列表' }))
    fireEvent.change(screen.getByRole('searchbox', { name: '筛选本轮队列' }), { target: { value: '书院' } })
    expect(panel.getAttribute('data-keyboard-shortcuts-suspended')).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: '目录' }))
    expect(panel.getAttribute('data-keyboard-shortcuts-suspended')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: '随心列表' }))
    expect((screen.getByRole('searchbox', { name: '筛选本轮队列' }) as HTMLInputElement).value).toBe('书院')
  })

  it('steps aside in fullscreen instead of squeezing the stage', () => {
    renderPanel(false, true)

    expect(screen.queryByText('记忆宫殿')).toBeNull()
    expect(screen.getByTestId('freestyle-stage')).toBeTruthy()
  })
})
