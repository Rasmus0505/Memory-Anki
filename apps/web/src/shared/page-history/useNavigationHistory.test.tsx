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
      <div data-testid="section">{history.activeSection ?? 'none'}</div>
      <button type="button" onClick={() => navigate('/knowledge')}>
        knowledge-root
      </button>
      <button type="button" onClick={() => navigate('/knowledge/tree/1')}>
        knowledge-editor
      </button>
      <button type="button" onClick={() => navigate('/freestyle')}>
        freestyle
      </button>
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
  it('supports browser-like back and forward within a single section', async () => {
    render(
      <MemoryRouter initialEntries={['/knowledge']}>
        <Routes>
          <Route path="*" element={<HistoryProbe />} />
        </Routes>
      </MemoryRouter>,
    )

    // Deep landing is anchored to the section home so 后退 is never a dead end.
    expect(screen.getByTestId('path').textContent).toBe('/knowledge')
    expect((screen.getByRole('button', { name: 'back' }) as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'knowledge-editor' }))
    expect(screen.getByTestId('path').textContent).toBe('/knowledge/tree/1')
    fireEvent.click(screen.getByRole('button', { name: 'knowledge-root' }))
    // Re-push root after editor
    expect(screen.getByTestId('path').textContent).toBe('/knowledge')

    fireEvent.click(screen.getByRole('button', { name: 'knowledge-editor' }))
    expect(screen.getByTestId('path').textContent).toBe('/knowledge/tree/1')

    fireEvent.click(screen.getByRole('button', { name: 'back' }))
    expect(screen.getByTestId('path').textContent).toBe('/knowledge')
    expect(screen.getByTestId('section').textContent).toBe('palaces')

    fireEvent.click(screen.getByRole('button', { name: 'forward' }))
    expect(screen.getByTestId('path').textContent).toBe('/knowledge/tree/1')
  })

  it('returns from the knowledge tree editor to the subject bookshelf via back', () => {
    render(
      <MemoryRouter initialEntries={['/knowledge']}>
        <Routes>
          <Route path="*" element={<HistoryProbe />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByTestId('path').textContent).toBe('/knowledge')
    fireEvent.click(screen.getByRole('button', { name: 'back' }))
    expect(screen.getByTestId('path').textContent).toBe('/palaces')
    expect(screen.getByTestId('section').textContent).toBe('palaces')
  })

  it('steps english course → listening library → english hub via section back', () => {
    render(
      <MemoryRouter initialEntries={['/english/listening/courses/7']}>
        <Routes>
          <Route path="*" element={<HistoryProbe />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByTestId('path').textContent).toBe('/english/listening/courses/7')
    expect(screen.getByTestId('section').textContent).toBe('english')

    fireEvent.click(screen.getByRole('button', { name: 'back' }))
    expect(screen.getByTestId('path').textContent).toBe('/english/listening')

    fireEvent.click(screen.getByRole('button', { name: 'back' }))
    expect(screen.getByTestId('path').textContent).toBe('/english')
    expect((screen.getByRole('button', { name: 'back' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps back inside the section after a cross-tab round trip', () => {
    render(
      <MemoryRouter initialEntries={['/knowledge']}>
        <Routes>
          <Route path="*" element={<HistoryProbe />} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'knowledge-editor' }))
    expect(screen.getByTestId('path').textContent).toBe('/knowledge/tree/1')

    fireEvent.click(screen.getByRole('button', { name: 'freestyle' }))
    expect(screen.getByTestId('section').textContent).toBe('freestyle')
    expect((screen.getByRole('button', { name: 'back' }) as HTMLButtonElement).disabled).toBe(true)

    // Restore deep knowledge page (new location key, same path)
    fireEvent.click(screen.getByRole('button', { name: 'knowledge-editor' }))
    expect(screen.getByTestId('section').textContent).toBe('palaces')
    expect(screen.getByTestId('path').textContent).toBe('/knowledge/tree/1')
    expect((screen.getByRole('button', { name: 'back' }) as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'back' }))
    expect(screen.getByTestId('path').textContent).toBe('/knowledge')
    expect(screen.getByTestId('section').textContent).toBe('palaces')
  })
})
