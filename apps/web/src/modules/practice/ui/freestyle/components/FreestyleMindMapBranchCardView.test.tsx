import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FreestyleAnkiCard } from '@/shared/api/contracts'
import type { FreestyleAnkiRating } from './FreestyleAnkiFlipPanel'
import { FreestyleMindMapBranchCardView } from './FreestyleMindMapBranchCardView'

const loadPalaceEditorMock = vi.fn()

vi.mock('./freestyleBranchCardSupport', () => ({
  loadPalaceEditor: (...args: unknown[]) => loadPalaceEditorMock(...args),
  palaceEditorCache: new Map(),
  plainContextLabel: () => '外国教育史 / 洛克',
}))

vi.mock('./FreestyleAnkiFlipPanel', () => ({
  FreestyleAnkiFlipPanel: ({
    onRateGroup,
    onRateSingle,
  }: {
    onRateGroup: (rating: FreestyleAnkiRating) => void
    onRateSingle: (rating: FreestyleAnkiRating, nodeUid: string) => void
  }) => (
    <div>
      <button type="button" onClick={() => onRateGroup(2)}>整卡困难</button>
      <button type="button" onClick={() => onRateSingle(3, 'back-1')}>单面记得</button>
    </div>
  ),
}))

const card = {
  id: 'anki:7:front-1',
  type: 'anki_card',
  content_type: 'anki_card',
  presentation: 'anki',
  palace_id: 7,
  palace_title: '外国教育史',
  anchor_uid: 'front-1',
  context_path: [],
  node_uids: ['front-1', 'back-1'],
  node_count: 2,
  anki_front_uid: 'front-1',
  anki_back_uids: ['back-1'],
} satisfies FreestyleAnkiCard

describe('FreestyleMindMapBranchCardView', () => {
  beforeEach(() => {
    loadPalaceEditorMock.mockReset()
    loadPalaceEditorMock.mockResolvedValue({ editor_doc: null })
  })

  it('keeps difficult independent Anki cards in the local round', async () => {
    const onBranchComplete = vi.fn()
    render(
      <FreestyleMindMapBranchCardView
        card={card}
        active
        reducedMotion
        onBranchComplete={onBranchComplete}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: '整卡困难' }))

    expect(onBranchComplete).toHaveBeenCalledWith(card.id, { restudy: true })
    expect(screen.getByText('本轮稍后重新出现，不改变宫殿复习计划')).toBeTruthy()
  })

  it('completes remembered independent Anki cards without unit scheduling', async () => {
    const onBranchComplete = vi.fn()
    render(
      <FreestyleMindMapBranchCardView
        card={card}
        active
        reducedMotion
        onBranchComplete={onBranchComplete}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: '单面记得' }))

    expect(onBranchComplete).toHaveBeenCalledWith(card.id, { restudy: false })
    expect(screen.getByText('本轮完成，不改变宫殿复习计划')).toBeTruthy()
  })
})
