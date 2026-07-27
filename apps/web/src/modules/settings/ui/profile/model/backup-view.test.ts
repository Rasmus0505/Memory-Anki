import { describe, expect, it } from 'vitest'
import type { BackupSummary } from '@/shared/api/contracts'
import {
  buildRestoreConfirm,
  canRestoreBackup,
  describeBackupKind,
  describeBackupReason,
  filterBackups,
} from './backup-view'

function makeBackup(overrides: Partial<BackupSummary> = {}): BackupSummary {
  return {
    kind: 'full',
    scope: 'full',
    full: true,
    name: 'backup-2026-07-27',
    path: '/data/backups/full/backup-2026-07-27',
    created_at: '2026-07-27T10:00:00',
    reason: 'manual',
    has_database: true,
    has_attachments: true,
    ...overrides,
  }
}

describe('backup-view', () => {
  it('names rolling backups instead of calling them incident snapshots', () => {
    // list_backups emits three kinds; the contract only declared two, so
    // rolling entries fell through to the rescue label.
    expect(describeBackupKind(makeBackup({ kind: 'rolling', full: false })).kindLabel).toBe(
      '轻量自动备份',
    )
    expect(describeBackupKind(makeBackup({ kind: 'rescue', full: false })).kindLabel).toBe('事故快照')
    expect(describeBackupKind(makeBackup()).kindLabel).toBe('整库备份')
  })

  it('reports scope separately from kind', () => {
    expect(describeBackupKind(makeBackup({ full: false })).scopeLabel).toBe('仅数据库')
    expect(describeBackupKind(makeBackup({ full: true })).scopeLabel).toBe('完整')
  })

  it('allows restoring any snapshot that carries a database', () => {
    // The backend gate is _backup_has_database and nothing more.
    expect(canRestoreBackup(makeBackup({ kind: 'rescue', full: false }))).toBe(true)
    expect(canRestoreBackup(makeBackup({ kind: 'rolling', full: false }))).toBe(true)
    expect(canRestoreBackup(makeBackup({ has_database: false }))).toBe(false)
  })

  it('warns that a database-only restore leaves attachments behind', () => {
    const dbOnly = buildRestoreConfirm(makeBackup({ has_attachments: false, full: false }))
    expect(dbOnly.options.confirmText).toBe('仅恢复数据库')
    expect(dbOnly.message).toContain('附件不会回滚')

    const complete = buildRestoreConfirm(makeBackup())
    expect(complete.options.confirmText).toBe('确认恢复')
  })

  it('translates known reasons and keeps unknown ones readable', () => {
    expect(describeBackupReason('before-db-restore')).toBe('恢复前自动创建')
    expect(describeBackupReason('some-custom-reason')).toBe('some-custom-reason')
    expect(describeBackupReason('')).toBe('未记录原因')
  })

  it('filters by kind and by reason keyword', () => {
    const items = [
      makeBackup({ name: 'a', kind: 'full', reason: 'manual' }),
      makeBackup({ name: 'b', kind: 'rescue', reason: 'before-db-restore' }),
    ]
    expect(filterBackups(items, { kind: 'rescue', keyword: '' })).toHaveLength(1)
    expect(filterBackups(items, { kind: 'all', keyword: '恢复前' })).toHaveLength(1)
    expect(filterBackups(items, { kind: 'all', keyword: '' })).toHaveLength(2)
  })
})
