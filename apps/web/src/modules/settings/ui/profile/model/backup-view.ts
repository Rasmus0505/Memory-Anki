import type { BackupSummary } from '@/shared/api/contracts'

export const BACKUP_REASON_LABELS: Record<string, string> = {
  manual: '手动备份',
  'before-db-restore': '恢复前自动创建',
  'before-full-import': '导入前自动创建',
  startup: '启动时自动备份',
  interval: '定时自动备份',
}

export function describeBackupReason(reason: string) {
  if (!reason) return '未记录原因'
  return BACKUP_REASON_LABELS[reason] ?? reason
}

export interface BackupKindDescription {
  kindLabel: string
  scopeLabel: string
  tone: 'default' | 'warning'
}

export function describeBackupKind(backup: BackupSummary): BackupKindDescription {
  const kindLabel =
    backup.kind === 'full' ? '整库备份' : backup.kind === 'rolling' ? '轻量自动备份' : '事故快照'
  const isFullScope = backup.full ?? backup.scope === 'full'
  return {
    kindLabel,
    scopeLabel: isFullScope ? '完整' : '仅数据库',
    tone: backup.kind === 'rescue' ? 'warning' : 'default',
  }
}

/**
 * Whether this snapshot can be restored.
 *
 * The backend only requires a database snapshot (restore_database_backup ->
 * _backup_has_database). The UI used to additionally demand a full-scope
 * backup, which left rescue snapshots — the ones you actually reach for after
 * something went wrong — with no button at all.
 */
export function canRestoreBackup(backup: BackupSummary) {
  return backup.has_database
}

export function buildRestoreConfirm(backup: BackupSummary) {
  const { kindLabel, scopeLabel } = describeBackupKind(backup)
  const restoresAttachments = backup.has_attachments
  const lines = [
    `将用「${backup.name}」（${kindLabel} · ${scopeLabel}）覆盖当前数据。`,
    restoresAttachments
      ? '数据库与附件都会回滚到该时间点。'
      : '该备份只含数据库：附件不会回滚，可能与数据库版本对不上。',
    '恢复前会自动创建一份逃生快照。',
  ]
  return {
    message: lines.join('\n'),
    options: {
      title: '整库恢复',
      confirmText: restoresAttachments ? '确认恢复' : '仅恢复数据库',
      tone: 'danger' as const,
    },
  }
}

export type BackupKindFilter = 'all' | BackupSummary['kind']

export function filterBackups(
  items: BackupSummary[],
  options: { kind: BackupKindFilter; keyword: string },
) {
  const keyword = options.keyword.trim().toLowerCase()
  return items.filter((item) => {
    if (options.kind !== 'all' && item.kind !== options.kind) return false
    if (!keyword) return true
    return (
      item.name.toLowerCase().includes(keyword) ||
      describeBackupReason(item.reason).toLowerCase().includes(keyword)
    )
  })
}
