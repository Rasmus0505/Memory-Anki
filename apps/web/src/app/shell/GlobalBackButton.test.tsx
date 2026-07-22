import { fireEvent, render, screen } from '@testing-library/react'
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

describe('GlobalBackButton', () => {
  beforeEach(() => {
    goBack.mockReset()
    goForward.mockReset()
    canGoBack = true
    canGoForward = false
  })

  it('always renders browser-like back and forward controls', () => {
    render(<GlobalBackButton />)
    expect(screen.getByRole('button', { name: '后退' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '前进' })).toBeTruthy()
  })

  it('navigates through recorded history instead of a fixed parent route', () => {
    canGoForward = true
    render(<GlobalBackButton />)
    fireEvent.click(screen.getByRole('button', { name: '后退' }))
    fireEvent.click(screen.getByRole('button', { name: '前进' }))
    expect(goBack).toHaveBeenCalledTimes(1)
    expect(goForward).toHaveBeenCalledTimes(1)
  })

  it('disables unavailable directions', () => {
    canGoBack = false
    canGoForward = false
    render(<GlobalBackButton />)
    expect((screen.getByRole('button', { name: '后退' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '前进' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
