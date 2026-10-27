import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PalaceGroupedListResponse } from '@/shared/api/contracts'
import { getPalacesGroupedApi } from '@/modules/content/domain/palace-entity/api'
import { getSubjectsApi, getSubjectTreeApi } from '@/modules/content/domain/knowledge-entity/api'
import { PalaceDirectoryTree } from './PalaceDirectoryTree'

vi.mock('@/modules/content/domain/palace-entity/api', () => ({
  getPalacesGroupedApi: vi.fn(),
}))
vi.mock('@/modules/content/domain/knowledge-entity/api', () => ({
  getSubjectsApi: vi.fn(),
  getSubjectTreeApi: vi.fn(),
}))

const subjects = [
  { id: 1, name: '中国教育史', color: '#6366f1', sort_order: 0 },
]

function groupedResponse(): PalaceGroupedListResponse {
  const palace = (id: number, title: string, chapterId: number | null) => ({
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
    primary_chapter_id: chapterId,
    primary_chapter: null,
    resolved_subject: subjects[0],
    resolved_parent_chapter: null,
    group_id: null,
    group_sort_order: 0,
  })
  return {
    groups: [],
    ungrouped: [],
    subjects: [
      {
        subject: subjects[0],
        chapter_groups: [],
        ungrouped_palaces: [palace(30, '未落地宫殿', null)],
      },
    ],
  } as unknown as PalaceGroupedListResponse
}

function makeDataTransfer() {
  const store = new Map<string, string>()
  const dataTransfer = {
    types: [] as string[],
    dropEffect: 'none',
    effectAllowed: 'all',
    setData(key: string, value: string) {
      store.set(key, value)
      if (!dataTransfer.types.includes(key)) dataTransfer.types.push(key)
    },
    getData(key: string) {
      return store.get(key) ?? ''
    },
    setDragImage() {},
  }
  return dataTransfer
}

function renderTree(overrides: Partial<Parameters<typeof PalaceDirectoryTree>[0]> = {}) {
  const onOpenPalace = vi.fn()
  const onBindPalace = vi.fn()
  render(
    <MemoryRouter>
      <PalaceDirectoryTree
        currentPalaceId={11}
        onOpenPalace={onOpenPalace}
        onBindPalace={onBindPalace}
        {...overrides}
      />
    </MemoryRouter>,
  )
  return { onOpenPalace, onBindPalace }
}

beforeEach(() => {
  vi.mocked(getSubjectsApi).mockResolvedValue(subjects as never)
  vi.mocked(getSubjectTreeApi).mockResolvedValue({
    subject: subjects[0],
    chapters: [
      { id: 10, name: '第二节 汉代', children: [] },
    ],
  } as never)
  vi.mocked(getPalacesGroupedApi).mockResolvedValue({
    ...groupedResponse(),
    subjects: [
      {
        subject: subjects[0],
        chapter_groups: [
          {
            source_chapter: { id: 10, name: '第二节 汉代', subject_id: 1 },
            palaces: [
              {
                ...(groupedResponse().subjects[0].ungrouped_palaces[0] as unknown as Record<string, unknown>),
                id: 11,
                title: '第二节 汉代的学校教育制度',
                resolved_title: '第二节 汉代的学校教育制度',
                primary_chapter_id: 10,
              },
            ],
          },
        ],
        ungrouped_palaces: groupedResponse().subjects[0].ungrouped_palaces,
      },
    ],
  } as never)
})

describe('PalaceDirectoryTree', () => {
  it('reveals the current palace path and opens another palace on click', async () => {
    const { onOpenPalace } = renderTree({ currentPalaceId: 30 })

    fireEvent.click(await screen.findByRole('button', { name: '未落地宫殿' }))

    expect(onOpenPalace).toHaveBeenCalledWith(30)
    expect(screen.getByRole('button', { name: '中国教育史' })).toBeTruthy()
  })

  it('reveals an ungrouped current palace without a manual expand', async () => {
    renderTree({ currentPalaceId: 30 })
    expect(await screen.findByRole('button', { name: '未落地宫殿' })).toBeTruthy()
  })

  it('binds a dragged palace onto a chapter row', async () => {
    const { onBindPalace } = renderTree()
    await screen.findByRole('button', { name: '第二节 汉代的学校教育制度' })

    const chapterLabel = await screen.findByRole('button', { name: '第二节 汉代' })
    const palaceRow = await screen.findByRole('button', { name: '第二节 汉代的学校教育制度' })
    const dataTransfer = makeDataTransfer()

    fireEvent.dragStart(palaceRow, { dataTransfer })
    fireEvent.dragOver(chapterLabel.parentElement as HTMLElement, { dataTransfer })
    fireEvent.drop(chapterLabel.parentElement as HTMLElement, { dataTransfer })

    await waitFor(() => expect(onBindPalace).toHaveBeenCalledWith(11, 10, 1))
  })

  it('filters to palaces matching the search keyword and keeps ancestors', async () => {
    renderTree()
    await screen.findByRole('button', { name: '第二节 汉代的学校教育制度' })

    fireEvent.change(screen.getByLabelText('搜索宫殿'), { target: { value: '不存在' } })

    await waitFor(() => expect(screen.queryByRole('button', { name: '第二节 汉代' })).toBeNull())
    expect(screen.getByText('没有匹配的宫殿。')).toBeTruthy()
  })

  it('opens the matched path while searching instead of hiding it behind folds', async () => {
    renderTree({ currentPalaceId: 30 })
    await screen.findByRole('button', { name: '未落地宫殿' })

    fireEvent.change(screen.getByLabelText('搜索宫殿'), {
      target: { value: '汉代的学校教育制度' },
    })

    expect(
      await screen.findByRole('button', { name: '第二节 汉代的学校教育制度' }),
    ).toBeTruthy()
  })
})
