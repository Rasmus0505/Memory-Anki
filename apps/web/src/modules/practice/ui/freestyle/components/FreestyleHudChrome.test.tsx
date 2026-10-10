import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { FreestyleHudOverflow } from './FreestyleHudChrome'

describe('FreestyleHudOverflow', () => {
  it('puts 更新队列 above 同步进度', async () => {
    const onUpdateQueue = vi.fn()
    const onSyncProgress = vi.fn()
    render(
      <MemoryRouter>
        <FreestyleHudOverflow
          summaryLabel="导图 1"
          slot="primary"
          onOpenPlan={vi.fn()}
          onUpdateQueue={onUpdateQueue}
          onSyncProgress={onSyncProgress}
          onOpenHistory={vi.fn()}
          menuDefaultOpen
        />
      </MemoryRouter>,
    )
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent || '')
    expect(items[0]).toContain('更新队列')
    expect(items.indexOf(items.find((item) => item.includes('更新队列')) || '')).toBeLessThan(
      items.findIndex((item) => item.includes('同步进度')),
    )
    fireEvent.click(screen.getByRole('menuitem', { name: '更新队列' }))
    expect(onUpdateQueue).toHaveBeenCalledTimes(1)
    expect(onSyncProgress).not.toHaveBeenCalled()
  })
})
