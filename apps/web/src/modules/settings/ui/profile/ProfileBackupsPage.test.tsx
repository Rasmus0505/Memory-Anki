import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ProfileBackupsPage from './ProfileBackupsPage'
import * as profileApi from './api'
import * as runtimeApi from '@/modules/settings/domain/runtime-entity/api'

vi.mock('@/shared/components/ui/native-dialog', () => ({ appConfirm: vi.fn(async () => false) }))
vi.mock('@/shared/feedback/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function mockApis() {
  vi.spyOn(profileApi, 'getBackupsApi').mockResolvedValue({
    items: [
      {
        kind: 'rolling',
        scope: 'rolling',
        full: false,
        name: 'rolling-1',
        path: '/backups/rolling-1',
        created_at: '2026-07-27T10:00:00',
        reason: 'interval',
        has_database: true,
        has_attachments: false,
      },
      {
        kind: 'rescue',
        scope: 'rolling',
        full: false,
        name: 'rescue-1',
        path: '/backups/rescue-1',
        created_at: '2026-07-27T09:00:00',
        reason: 'before-db-restore',
        has_database: true,
        has_attachments: false,
      },
    ],
  })
  vi.spyOn(runtimeApi, 'getRuntimeInfoApi').mockResolvedValue({
    channel: 'dev', commit: null, short_commit: null, last_started_at: null,
    app_home: 'C:/MemoryAnki', app_home_source: 'default', storage_mode: 'local',
    managed_storage_items: [], backup_covered_items: [],
  })
}

describe('ProfileBackupsPage', () => {
  afterEach(() => vi.restoreAllMocks())

  it('labels rolling and rescue backups and allows database restore', async () => {
    mockApis()
    render(<MemoryRouter><ProfileBackupsPage /></MemoryRouter>)
    expect(await screen.findByText('轻量自动备份')).toBeTruthy()
    expect(screen.getByText('事故快照')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '整库恢复' })).toHaveLength(2)
  })

  it('keeps destructive full import only in the danger tab', async () => {
    mockApis()
    const transferView = render(
      <MemoryRouter initialEntries={['/profile/backups?tab=transfer']}>
        <ProfileBackupsPage />
      </MemoryRouter>,
    )
    await waitFor(() => expect(profileApi.getBackupsApi).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: '选择 zip 并清空导入' })).toBeNull()
    transferView.unmount()

    render(
      <MemoryRouter initialEntries={['/profile/backups?tab=danger']}>
        <ProfileBackupsPage />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('button', { name: '选择 zip 并清空导入' })).toBeTruthy()
  })
})