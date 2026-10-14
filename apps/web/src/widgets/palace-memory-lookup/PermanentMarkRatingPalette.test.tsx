import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PermanentMarkRatingPalette } from './PermanentMarkRatingPalette'
import type { PermanentMarkRatingRow } from './model/memoryLookupRatingView'

const rated: PermanentMarkRatingRow = { nodeUid: 'a1', text: '甲一', unitId: 'unit-1', rating: 2, revision: 4 }
const unrated: PermanentMarkRatingRow = { nodeUid: 'b', text: '乙', unitId: 'unit-2', rating: null, revision: null }

describe('PermanentMarkRatingPalette', () => {
  it('shows four choices, marks the current one, and sets a new one on click', () => {
    const onChangeRating = vi.fn()
    render(
      <PermanentMarkRatingPalette row={rated} cascadeCount={0} busy={false} error="" onChangeRating={onChangeRating} />,
    )

    expect(screen.getByRole('button', { name: '困难' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '轻松' }))
    expect(onChangeRating).toHaveBeenCalledWith(4)
  })

  it('warns how many descendant marks the change also sets', () => {
    render(
      <PermanentMarkRatingPalette row={rated} cascadeCount={2} busy={false} error="" onChangeRating={vi.fn()} />,
    )
    expect(screen.getByText(/同时改下面 2 个永久标记节点/)).toBeTruthy()
  })

  it('shows no choices for an unrated node', () => {
    render(
      <PermanentMarkRatingPalette row={unrated} cascadeCount={0} busy={false} error="" onChangeRating={vi.fn()} />,
    )
    expect(screen.queryByRole('group')).toBeNull()
    expect(screen.getByText('未评分')).toBeTruthy()
  })

  it('asks for a selection when no node is picked', () => {
    render(
      <PermanentMarkRatingPalette row={null} cascadeCount={0} busy={false} error="" onChangeRating={vi.fn()} />,
    )
    expect(screen.getByText(/点击导图上的永久标记节点/)).toBeTruthy()
  })
})
