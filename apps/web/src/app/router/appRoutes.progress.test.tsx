import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppRoutes } from './appRoutes'

vi.mock('@/modules/dashboard/public', () => ({
  LearningProgressPage: () => <h1>学习进度公开页面</h1>,
}))

function NavigationProbe() {
  const location = useLocation()
  const navigate = useNavigate()
  return <>
    <output data-testid="path">{location.pathname}{location.search}</output>
    <button onClick={() => navigate(-1)}>浏览器后退</button>
  </>
}

function renderProgress(path: string) {
  return render(<MemoryRouter initialEntries={[path]}>
    <AppRoutes />
    <NavigationProbe />
  </MemoryRouter>)
}

describe('progress route composition', () => {
  it('renders the dashboard public page on a fresh deep link and after router recreation', async () => {
    const first = renderProgress('/progress?subjectId=3')
    expect(await screen.findByRole('heading', { name: '学习进度公开页面' })).toBeTruthy()
    expect(screen.getByTestId('path').textContent).toBe('/progress?subjectId=3')
    first.unmount()

    renderProgress('/progress?subjectId=3')
    expect(await screen.findByRole('heading', { name: '学习进度公开页面' })).toBeTruthy()
    expect(screen.getByTestId('path').textContent).toBe('/progress?subjectId=3')
  })

  it('replaces unknown progress descendants with the progress root without a back loop', async () => {
    renderProgress('/progress/unknown')
    expect(await screen.findByRole('heading', { name: '学习进度公开页面' })).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/progress'))
    fireEvent.click(screen.getByRole('button', { name: '浏览器后退' }))
    expect(screen.getByTestId('path').textContent).toBe('/progress')
  })
})
