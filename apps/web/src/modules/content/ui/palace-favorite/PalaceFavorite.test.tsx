import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PalaceFavoriteButton } from './PalaceFavorite'
import { resetPalaceFavoritesForTest } from './palaceFavoriteStore'

const getFavoritePalaceIdsApi = vi.fn(async () => ({ ids: [7] }))
const setPalaceFavoriteApi = vi.fn(async (_palaceId: number, isFavorite: boolean) => ({
  ok: true,
  is_favorite: isFavorite,
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
  },
}))

vi.mock('@/modules/content/domain/palace-entity/api', () => ({
  getFavoritePalaceIdsApi: () => getFavoritePalaceIdsApi(),
  setPalaceFavoriteApi: (palaceId: number, isFavorite: boolean) =>
    setPalaceFavoriteApi(palaceId, isFavorite),
}))

describe('PalaceFavoriteButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetPalaceFavoritesForTest()
  })

  it('loads the favorite set and toggles a palace off', async () => {
    render(<PalaceFavoriteButton palaceId={7} />)

    const button = screen.getByTestId('palace-favorite-toggle')
    await waitFor(() => expect(button.getAttribute('aria-pressed')).toBe('true'))

    fireEvent.click(button)

    await waitFor(() => expect(setPalaceFavoriteApi).toHaveBeenCalledWith(7, false))
    await waitFor(() => expect(button.getAttribute('aria-pressed')).toBe('false'))
  })

  it('toggles an unfavorited palace on', async () => {
    getFavoritePalaceIdsApi.mockResolvedValueOnce({ ids: [] })
    render(<PalaceFavoriteButton palaceId={9} />)

    const button = screen.getByTestId('palace-favorite-toggle')
    await waitFor(() => expect(getFavoritePalaceIdsApi).toHaveBeenCalled())
    expect(button.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(button)

    await waitFor(() => expect(setPalaceFavoriteApi).toHaveBeenCalledWith(9, true))
    await waitFor(() => expect(button.getAttribute('aria-pressed')).toBe('true'))
  })
})
