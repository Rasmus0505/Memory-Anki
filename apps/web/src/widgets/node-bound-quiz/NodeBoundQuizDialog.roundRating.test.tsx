import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  primeQuestionMocks,
  renderDialog,
  useRoundQuestionRatingsMock,
} from './NodeBoundQuizDialog.harness'

/**
 * 关联题目 shows the bound knowledge point's this-round rating.
 *
 * This is a *different* window from the toolbar 做题 overlay, and it was the one
 * still missing the badge. Both now read the same backend rule, so the score
 * means one thing everywhere.
 *
 * The badge only appears inside a 随心 round: outside one there is no round to
 * score against, and claiming 「本轮尚未复习」 about a round that does not exist
 * would be worse than showing nothing.
 */
describe('NodeBoundQuizDialog round rating badge', () => {
  beforeEach(() => {
    primeQuestionMocks()
    useRoundQuestionRatingsMock.mockReset()
    useRoundQuestionRatingsMock.mockReturnValue(null)
  })

  it('shows the weakest bound knowledge point score for this round', async () => {
    useRoundQuestionRatingsMock.mockReturnValue({ 42: 2 })
    renderDialog({ roundId: 'round-1' })
    await waitFor(() =>
      expect(screen.getByTestId('overlay-question-rating').textContent).toContain(
        '本轮最低 2 · 困难',
      ),
    )
  })

  it('says 本轮尚未复习 when the round has not reached the knowledge point', async () => {
    useRoundQuestionRatingsMock.mockReturnValue({})
    renderDialog({ roundId: 'round-1' })
    await waitFor(() =>
      expect(screen.getByTestId('overlay-question-rating').textContent).toContain(
        '本轮尚未复习',
      ),
    )
  })

  it('omits the badge entirely outside a round', async () => {
    // Browsing a palace from 知识, or editing the map: no round, no 本轮 score.
    renderDialog()
    await screen.findByText('下列哪一项是细胞膜的主要成分？')
    expect(screen.queryByTestId('overlay-question-rating')).toBeNull()
  })

  it('does not fetch ratings when there is no round to ask about', async () => {
    renderDialog()
    await screen.findByText('下列哪一项是细胞膜的主要成分？')
    expect(useRoundQuestionRatingsMock).toHaveBeenCalledWith(
      expect.objectContaining({ roundId: null, enabled: false }),
    )
  })
})
