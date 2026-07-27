import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProfileAiPage from '@/modules/settings/ui/profile/ProfileAiPage'
import * as profileApi from '@/modules/settings/domain/preferences-entity/api'

vi.mock('@/modules/settings/ui/profile/AiWorkspacePage', () => ({
  AiWorkspacePage: ({ activeTab }: { activeTab?: string }) => (
    <div data-testid="workspace-tab">{activeTab}</div>
  ),
}))

vi.mock('@/modules/settings/ui/profile/ProfileAiPromptsPage', () => ({
  ProfileAiPromptsPage: ({ view }: { view: string }) => <div>{view}</div>,
}))

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location-search">{location.search}</div>
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/profile/ai?source=shortcut']}>
      <Routes>
        <Route
          path="/profile/ai"
          element={
            <>
              <ProfileAiPage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ProfileAiPage', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('defaults to access when no provider key is configured', async () => {
    vi.spyOn(profileApi, 'getAiModelScenariosApi').mockResolvedValue({
      providers: [{ has_api_key: false }],
    } as never)

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('location-search').textContent).toBe('?source=shortcut&tab=access')
      expect(screen.getByTestId('workspace-tab').textContent).toBe('access')
    })
  })

  it('defaults to scenes when any provider key is configured', async () => {
    vi.spyOn(profileApi, 'getAiModelScenariosApi').mockResolvedValue({
      providers: [{ has_api_key: true }],
    } as never)

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('location-search').textContent).toBe('?source=shortcut&tab=scenes')
      expect(screen.getByTestId('workspace-tab').textContent).toBe('scenes')
    })
  })
})
