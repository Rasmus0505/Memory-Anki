import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as runtimeDiagnostics from './runtimeDiagnostics'
import { AppErrorBoundary } from './AppErrorBoundary'

function BrokenApplication(): never {
  throw new Error('application boot failed')
}

describe('AppErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows complete diagnostics and allows them to be copied', async () => {
    const copy = vi.spyOn(runtimeDiagnostics, 'copyRuntimeDiagnostics').mockResolvedValue(true)

    render(
      <AppErrorBoundary>
        <BrokenApplication />
      </AppErrorBoundary>,
    )

    expect(screen.getByText('应用发生异常')).toBeTruthy()
    expect(screen.getByText(/Memory Anki application error diagnosis/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '复制诊断' }))

    await vi.waitFor(() => expect(copy).toHaveBeenCalledWith(expect.stringContaining('application boot failed')))
    expect(await screen.findByRole('button', { name: '已复制诊断' })).toBeTruthy()
  })
})
