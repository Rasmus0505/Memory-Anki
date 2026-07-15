import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as pwaReset from '@/pwa/resetPwa'
import { RouteErrorBoundary } from './RouteErrorBoundary'

let shouldThrow = false

function FlakyRoute() {
  if (shouldThrow) throw new Error('route boom')
  return <div>route content</div>
}

function BrokenChunkRoute(): never {
  throw new Error('Failed to fetch dynamically imported module')
}

describe('RouteErrorBoundary', () => {
  beforeEach(() => {
    shouldThrow = false
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows a route-level fallback and retries rendering without unmounting surrounding UI', () => {
    shouldThrow = true
    render(
      <div>
        <nav>shell navigation</nav>
        <RouteErrorBoundary resetKey="/knowledge">
          <FlakyRoute />
        </RouteErrorBoundary>
      </div>,
    )

    expect(screen.getByText('shell navigation')).toBeTruthy()
    expect(screen.getByText('这个页面出了点问题')).toBeTruthy()

    shouldThrow = false
    fireEvent.click(screen.getByRole('button', { name: '重试' }))

    expect(screen.getByText('route content')).toBeTruthy()
    expect(screen.getByText('shell navigation')).toBeTruthy()
  })

  it('uses refresh guidance for chunk load failures', () => {
    render(
      <RouteErrorBoundary resetKey="/knowledge">
        <BrokenChunkRoute />
      </RouteErrorBoundary>,
    )

    expect(screen.getByText('页面资源加载失败')).toBeTruthy()
    expect(screen.getByRole('button', { name: '修复并刷新' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '直接刷新' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
  })

  it('repairs PWA runtime caches before reloading for chunk failures', async () => {
    const reset = vi.spyOn(pwaReset, 'resetPwaRuntime').mockResolvedValue({
      unregisteredServiceWorkers: 1,
      deletedCaches: 1,
    })

    render(
      <RouteErrorBoundary resetKey="/knowledge">
        <BrokenChunkRoute />
      </RouteErrorBoundary>,
    )

    fireEvent.click(screen.getByRole('button', { name: '修复并刷新' }))

    await vi.waitFor(() => expect(reset).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: '正在修复…' })).toHaveProperty('disabled', true)
  })
})
