import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { FreestyleCard, FreestyleFeedConfig } from '@/shared/api/contracts'
import { DEFAULT_QUEUE_STATE } from '@/modules/practice/domain/queueState'
import { createRoundPlan } from '@/modules/practice/domain/roundPlan'
import { FreestyleRoundPlanDialog } from './FreestyleRoundPlanDialog'

vi.mock('@/modules/content/public', () => ({
  getPalacesGroupedApi: vi.fn().mockResolvedValue({ subjects: [] }),
}))

const config = {
  content: { mindmap_branch: true, anki_card: true, quiz_question: true },
  weights: { mindmap_branch: 2, anki_card: 2, quiz_question: 1 },
  mix_mode: 'ratio',
  mix_ratio: { mindmap: 2, quiz: 1 },
  bound_quiz_placement: 'into_mix',
  palace_order: 'finish_palace_then_next',
  due_policy: 'due_only',
  quiz_mastery_buckets: ['unseen', 'weak'],
  quiz_scope: 'cross_palace_random',
  queue_length: 50,
  specific_palace_ids: [],
  question_type: 'all',
  weak_quiz_priority: true,
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

describe('FreestyleRoundPlanDialog', () => {
  it('groups the round, supports batch exclusion, and saves config', async () => {
    const cards = [card('one'), card('two')]
    const plan = createRoundPlan('round-1', cards, config, {
      candidate_count: 8,
      scheduled_count: 2,
      queue_limit: 50,
      limit_reached: false,
    })
    const onExclude = vi.fn()
    const onSaveConfig = vi.fn()
    render(
      <FreestyleRoundPlanDialog
        open
        config={config}
        cards={cards}
        currentIndex={0}
        queueState={{ ...DEFAULT_QUEUE_STATE, roundId: 'round-1', currentCardId: 'one' }}
        roundPlan={plan}
        onOpenChange={vi.fn()}
        onJump={vi.fn()}
        onExclude={onExclude}
        onRestore={vi.fn()}
        onReorder={vi.fn()}
        onSaveConfig={onSaveConfig}
        onResetRound={vi.fn()}
      />,
    )

    expect(await screen.findByText('宫殿 A')).toBeTruthy()
    expect(screen.getByText('已安排 2 张 · 候选 8 · 上限 50')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: '选择one' }))
    fireEvent.click(screen.getByRole('button', { name: '排除选中' }))
    expect(onExclude).toHaveBeenCalledWith(['one'])

    fireEvent.click(screen.getByRole('button', { name: '保存配置并重排' }))
    expect(onSaveConfig).toHaveBeenCalledTimes(1)
  })
})
