import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GlobalBackButton } from './GlobalBackButton'

const goBack = vi.fn()
const goForward = vi.fn()
let canGoBack = true
let canGoForward = false

vi.mock('@/shared/page-history/useNavigationHistory', () => ({
  useNavigationHistory: () => ({
    canGoBack,
    canGoForward,
    goBack,
    goForward,
  }),
}))

function renderBack(ui: Parameters<typeof render>[0], path = '/today') {
  return render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>)
}

describe('GlobalBackButton', () => {
  beforeEach(() => {
    goBack.mockReset()
    goForward.mockReset()
    canGoBack = true
    canGoForward = false
  })

  it('always renders icon-only browser-like back and forward controls', () => {
    renderBack(<GlobalBackButton placement="sidebar" />)
    const back = screen.getByRole('button', { name: '后退' })
    const forward = screen.getByRole('button', { name: '前进' })
    expect(back).toBeTruthy()
    expect(forward).toBeTruthy()
    expect(back.textContent?.replace(/\s/g, '')).toBe('')
    expect(forward.textContent?.replace(/\s/g, '')).toBe('')
  })

  it('navigates through recorded history instead of a fixed parent route', () => {
    canGoForward = true
    renderBack(<GlobalBackButton placement="sidebar" />)
    fireEvent.click(screen.getByRole('button', { name: '后退' }))
    fireEvent.click(screen.getByRole('button', { name: '前进' }))
    expect(goBack).toHaveBeenCalledTimes(1)
    expect(goForward).toHaveBeenCalledTimes(1)
  })

  it('disables unavailable directions', () => {
    canGoBack = false
    canGoForward = false
    renderBack(<GlobalBackButton placement="sidebar" />)
    expect((screen.getByRole('button', { name: '后退' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '前进' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('hides in system fullscreen so it is not shown without the sidebar', () => {
    const host = document.createElement('div')
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => host,
    })
    const { container } = renderBack(<GlobalBackButton placement="mobile" />)
    expect(container.firstChild).toBeNull()
    expect(screen.queryByRole('button', { name: '后退' })).toBeNull()
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => null,
    })
  })

  it('hides the mobile floating chrome on immersive freestyle so it does not cover the feed', () => {
    const { container } = renderBack(<GlobalBackButton placement="mobile" />, '/freestyle')
    expect(container.firstChild).toBeNull()
    expect(screen.queryByRole('button', { name: '后退' })).toBeNull()
  })
})

