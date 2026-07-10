import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { buildPaginationItems, Pagination } from './pagination'

describe('Pagination', () => {
  it('builds a compact page window with ellipses', () => {
    expect(buildPaginationItems(5, 10)).toEqual([
      1,
      'ellipsis',
      4,
      5,
      6,
      'ellipsis',
      10,
    ])
  })

  it('marks the current page and handles navigation', () => {
    const onPageChange = vi.fn()
    render(
      <Pagination page={2} totalPages={4} onPageChange={onPageChange} />,
    )
    expect(
      screen.getByRole('button', { name: '第 2 页' }).getAttribute('aria-current'),
    ).toBe('page')
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(onPageChange).toHaveBeenCalledWith(3)
  })
})
