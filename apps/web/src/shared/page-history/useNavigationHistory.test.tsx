import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { useNavigationHistory } from './useNavigationHistory'

function HistoryProbe() {
  const navigate = useNavigate()
  const history = useNavigationHistory()
  return (
    <div>
      <div data-testid="path">{history.currentPath}</div>
      <div data-testid="index">{history.index}</div>
      <button type="button" onClick={() => navigate('/b')}>
        to-b
      </button>
      <button type="button" onClick={() => navigate('/c')}>
        to-c
      </button>
      <button type="button" disabled={!history.canGoBack} onClick={history.goBack}>
        back
      </button>
      <button type="button" disabled={!history.canGoForward} onClick={history.goForward}>
        forward
      </button>
    </div>
  )
}

describe('useNavigationHistory', () => {
  it('supports browser-like back and forward across real router transitions', async () => {
    render(
      <MemoryRouter initialEntries={['/a']}>
        <Routes>
          <Route path="*" element={<HistoryProbe />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByTestId('path').textContent).toBe('/a')
    expect((screen.getByRole('button', { name: 'back' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'to-b' }))
    expect(screen.getByTestId('path').textContent).toBe('/b')
    fireEvent.click(screen.getByRole('button', { name: 'to-c' }))
    expect(screen.getByTestId('path').textContent).toBe('/c')

    fireEvent.click(screen.getByRole('button', { name: 'back' }))
    expect(screen.getByTestId('path').textContent).toBe('/b')
    fireEvent.click(screen.getByRole('button', { name: 'back' }))
    expect(screen.getByTestId('path').textContent).toBe('/a')

    fireEvent.click(screen.getByRole('button', { name: 'forward' }))
    expect(screen.getByTestId('path').textContent).toBe('/b')
  })
})
