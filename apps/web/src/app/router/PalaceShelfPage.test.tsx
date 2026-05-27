import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PalaceShelfPage from '@/app/router/PalaceShelfPage'
import { PALACE_SHELF_VIEW_SETTINGS_KEY } from '@/app/router/palace-view-settings'

const navigate = vi.fn()
const searchParams = new URLSearchParams()
const setSearchParams = vi.fn()
const getPalaceSubjectShelfApi = vi.fn()

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
  useNavigate: () => navigate,
  useSearchParams: () => [searchParams, setSearchParams],
}))

vi.mock('@/shared/api/modules/palaces', () => ({
  getPalaceSubjectShelfApi: (...args: unknown[]) => getPalaceSubjectShelfApi(...args),
}))

describe('PalaceShelfPage', () => {
  beforeEach(() => {
    navigate.mockReset()
    getPalaceSubjectShelfApi.mockReset()
    searchParams.delete('search')
    window.localStorage.clear()
  })

  it('renders subject shelf cards and navigates by subject id', async () => {
    getPalaceSubjectShelfApi.mockResolvedValue({
      items: [
        {
          subject: { id: 1, name: '中国近代史', color: '#6366f1' },
          palace_count: 3,
          chapter_count: 5,
          review_status: 'due_now',
          has_due_review: true,
          has_due_later_today: false,
        },
      ],
    })

    render(<PalaceShelfPage />)

    const title = await screen.findByText('中国近代史')
    expect(title).toBeTruthy()
    fireEvent.click(title.closest('button') as HTMLButtonElement)
    expect(navigate).toHaveBeenCalledWith('/palaces/list?subjectId=1')
  })

  it('renders uncategorized shelf and navigates to uncategorized list', async () => {
    getPalaceSubjectShelfApi.mockResolvedValue({
      items: [
        {
          subject: null,
          palace_count: 2,
          chapter_count: 0,
          review_status: 'idle',
          has_due_review: false,
          has_due_later_today: false,
        },
      ],
    })

    render(<PalaceShelfPage />)

    const title = await screen.findByText('未分类')
    fireEvent.click(title.closest('button') as HTMLButtonElement)
    expect(navigate).toHaveBeenCalledWith('/palaces/list?uncategorized=true')
  })

  it('passes search text to shelf api', async () => {
    getPalaceSubjectShelfApi.mockResolvedValue({ items: [] })

    render(<PalaceShelfPage />)

    fireEvent.change(screen.getByPlaceholderText('搜索学科或宫殿...'), { target: { value: '历史' } })
    await waitFor(() => {
      expect(setSearchParams).toHaveBeenCalled()
    })
  })

  it('uses double layout by default and persists custom shelf view settings', async () => {
    getPalaceSubjectShelfApi.mockResolvedValue({
      items: [
        {
          subject: { id: 1, name: '中国近代史', color: '#6366f1' },
          palace_count: 3,
          chapter_count: 5,
          review_status: 'due_now',
          has_due_review: true,
          has_due_later_today: false,
        },
      ],
    })

    render(<PalaceShelfPage />)

    await screen.findByText('中国近代史')
    expect(screen.getByTestId('shelf-grid').dataset.layoutMode).toBe('double')
    fireEvent.click(screen.getByRole('button', { name: '单列' }))
    fireEvent.click(screen.getByRole('button', { name: '紧凑' }))

    expect(screen.getByTestId('shelf-grid').dataset.layoutMode).toBe('single')
    expect(screen.getByTestId('shelf-grid').dataset.densityMode).toBe('compact')
    expect(window.localStorage.getItem(PALACE_SHELF_VIEW_SETTINGS_KEY)).toContain('"layoutMode":"single"')
  })
})
