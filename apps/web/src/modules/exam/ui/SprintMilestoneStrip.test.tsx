import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type { ExamOverview, FreestyleMilestoneUpcoming } from '@/shared/api/contracts'
import { SprintMilestoneStrip } from './SprintMilestoneStrip'

const overview = {
  settings: { exam_date: '2026-12-21' },
  days_left: 57,
} as unknown as ExamOverview

const milestones: FreestyleMilestoneUpcoming = {
  today: '2026-10-25',
  overdue_count: 0,
  groups: [
    {
      date: '2026-10-31',
      days_left: 6,
      items: [{ id: 'm1', title: '中国教育史完成', category: '', detail: '' }],
    },
    {
      date: '2026-11-05',
      days_left: 11,
      items: [{ id: 'm2', title: '教育学原理完成', category: '', detail: '' }],
    },
  ],
}

function renderStrip(compact: boolean) {
  return render(
    <MemoryRouter>
      <SprintMilestoneStrip overview={overview} milestones={milestones} compact={compact} />
    </MemoryRouter>,
  )
}

describe('SprintMilestoneStrip', () => {
  it('compact keeps one line: countdown + the nearest day only', () => {
    renderStrip(true)

    const line = screen.getByTestId('freestyle-milestone-line')
    expect(line).toBeInstanceOf(HTMLButtonElement)
    expect(line.textContent).toContain('距考试 57 天')
    expect(line.textContent).toContain('10/31')
    expect(line.textContent).toContain('中国教育史完成')
    // The second day never reaches the one-line header; it lives in the popover.
    expect(screen.queryByText('教育学原理完成')).toBeNull()
    // The wrapping pill's flex-wrap is what made a three-line block over the card.
    expect(line.className).not.toContain('flex-wrap')
    expect(line.querySelector('.truncate')).not.toBeNull()
  })

  it('renders nothing when there is neither an exam date nor a milestone', () => {
    const { container } = render(
      <MemoryRouter>
        <SprintMilestoneStrip
          overview={{ settings: { exam_date: null }, days_left: null } as unknown as ExamOverview}
          milestones={{ today: '2026-10-25', overdue_count: 0, groups: [] }}
          compact
        />
      </MemoryRouter>,
    )
    expect(container.innerHTML).toBe('')
  })
})
