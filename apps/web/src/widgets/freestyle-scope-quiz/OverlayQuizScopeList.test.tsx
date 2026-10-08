import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  OverlayQuizScopeLeftNotice,
  OverlayQuizScopeList,
  OverlayQuizScopeSummary,
} from './OverlayQuizScopeList'
import type { FreestyleOverlayScopePalaces } from '@/shared/api/contracts'

/**
 * The 做题 scope list renders the backend report verbatim.
 *
 * The scope is the round's own review set: the saved 随心 config must not narrow
 * it a second time, so there is no "excluded by config" reason any more. See
 * docs/incidents/0002-quiz-scope-two-owners.md.
 */
function scope(): FreestyleOverlayScopePalaces {
  return {
    scheduled_count: 3,
    in_pool_count: 2,
    question_count: 41,
    palaces: [
      {
        palace_id: 27,
        title: '第一节英国近代教育',
        question_count: 23,
        objective: 20,
        subjective: 3,
        in_pool: true,
        reason: '',
      },
      {
        palace_id: 23,
        title: '西欧中世纪的教育',
        question_count: 18,
        objective: 18,
        subjective: 0,
        in_pool: true,
        reason: '',
      },
      {
        palace_id: 49,
        title: 'Governing Mental Health AI',
        question_count: 0,
        objective: 0,
        subjective: 0,
        in_pool: false,
        reason: 'no_questions',
      },
    ],
  }
}

function noPoolScope(): FreestyleOverlayScopePalaces {
  const report = scope()
  return {
    ...report,
    in_pool_count: 0,
    palaces: report.palaces.map((row) => ({
      ...row,
      in_pool: false,
      reason: row.reason || ('no_questions' as const),
    })),
  }
}

describe('OverlayQuizScopeList', () => {
  it('lists playable palaces with counts and blocked palaces with reasons', () => {
    render(<OverlayQuizScopeList scopePalaces={scope()} />)
    const list = screen.getByTestId('freestyle-scope-list')
    expect(list.textContent).toContain('2 座可做 / 共 3 座')
    expect(list.textContent).toContain('第一节英国近代教育')
    expect(list.textContent).toContain('23 题')
    // Both kinds are broken out only when a palace actually has both.
    expect(list.textContent).toContain('客观 20 · 主观 3')
    expect(list.textContent).toContain('西欧中世纪的教育')
    expect(list.textContent).toContain('还没有题目')
  })

  it('never explains the pool in terms of the 随心 config', () => {
    render(<OverlayQuizScopeList scopePalaces={scope()} />)
    const text = screen.getByTestId('freestyle-scope-list').textContent ?? ''
    // A round palace is in scope however the config changed afterwards.
    expect(text).not.toContain('不在当前随心范围')
    expect(text).not.toContain('改回勾选')
  })

  it('names a removed palace and explains that its questions went with it', () => {
    // The live case: 23 and 43 held the round's only questions, and each had
    // its single card 移除队列 — so the pool emptied for an explainable reason.
    const report = scope()
    render(
      <OverlayQuizScopeList
        scopePalaces={{
          ...report,
          in_pool_count: 1,
          palaces: report.palaces.map((row) =>
            row.palace_id === 23
              ? { ...row, in_pool: false, reason: 'palace_removed' as const }
              : row,
          ),
        }}
      />,
    )
    const text = screen.getByTestId('freestyle-scope-list').textContent ?? ''
    expect(text).toContain('已移除队列')
    // The count stays visible: the learner can see what they gave up.
    expect(text).toContain('有 18 题')
    expect(text).toContain('本轮重新安排它，题就会回来')
  })

  it('does not explain removal when nothing was removed', () => {
    render(<OverlayQuizScopeList scopePalaces={scope()} />)
    const text = screen.getByTestId('freestyle-scope-list').textContent ?? ''
    expect(text).not.toContain('已移除队列')
    expect(text).not.toContain('本轮重新安排它')
  })

  it('opens by default when nothing is playable, so the reason is visible', () => {
    render(<OverlayQuizScopeList scopePalaces={noPoolScope()} />)
    const details = screen.getByTestId('freestyle-scope-list') as HTMLDetailsElement
    expect(details.open).toBe(true)
    expect(details.textContent).toContain('0 座可做 / 共 3 座')
  })

  it('renders nothing without a report', () => {
    const { container } = render(<OverlayQuizScopeList scopePalaces={null} />)
    expect(container.textContent).toBe('')
  })

  it('names the palaces in the summary instead of only counting them', () => {
    render(<OverlayQuizScopeSummary scopePalaces={scope()} />)
    expect(screen.getByText(/本轮纳入复习的 3 座宫殿/).textContent).toContain('其中 2 座可做')
  })

  it('says every palace is unplayable when the pool is empty', () => {
    render(<OverlayQuizScopeSummary scopePalaces={noPoolScope()} />)
    const text = screen.getByText(/当前都没有可做的题/).textContent ?? ''
    expect(text).toContain('3 座宫殿')
    expect(text).toContain('西欧中世纪的教育')
    // A bare count was what made the original mismatch invisible.
    expect(text).not.toBe('本轮纳入复习的 3 个宫殿')
  })
})

describe('OverlayQuizScopeLeftNotice', () => {
  it('renders the named palaces and dismisses', () => {
    const onDismiss = vi.fn()
    render(<OverlayQuizScopeLeftNotice notice="随心范围已更新：福禄培尔 的题已移出本次做题。" onDismiss={onDismiss} />)
    expect(screen.getByTestId('freestyle-scope-left-notice').textContent).toContain('福禄培尔')
    fireEvent.click(screen.getByRole('button', { name: '知道了' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('renders nothing without a notice', () => {
    const { container } = render(<OverlayQuizScopeLeftNotice notice="" onDismiss={vi.fn()} />)
    expect(container.textContent).toBe('')
  })
})
