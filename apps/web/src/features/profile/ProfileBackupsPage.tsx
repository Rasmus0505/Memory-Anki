import { useEffect, useState } from 'react'
import { HardDriveDownload, RotateCcw } from 'lucide-react'
import { toast } from '@/shared/feedback/toast'
import { ProfileLayout } from '@/features/profile/ProfileLayout'
import type { BackupSummary, RuntimeInfo } from '@/shared/api/contracts'
import {
  createBackupApi,
  getBackupsApi,
  restoreBackupApi,
} from '@/shared/api/modules/profile'
import { getRuntimeInfoApi } from '@/shared/api/modules/runtime'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { EmptyState } from '@/shared/components/state-placeholders'

export default function ProfileBackupsPage() {
  const [backups, setBackups] = useState<BackupSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null)

  const loadBackups = async () => {
    setLoading(true)
    try {
      const result = await getBackupsApi()
      setBackups(result.items)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadBackups()
    void getRuntimeInfoApi().then(setRuntimeInfo).catch(() => setRuntimeInfo(null))
  }, [])

  const handleCreateBackup = async () => {
    const result = await createBackupApi('manual')
    toast.success(`已创建整库备份：${result.path}`)
    await loadBackups()
  }

  const handleRestoreBackup = async (path: string) => {
    const confirmed = window.confirm(
      '整库恢复会先自动生成事故快照，再把数据库和附件回到目标备份。确定继续吗？',
    )
    if (!confirmed) return

    const result = await restoreBackupApi(path)
    toast.success(`整库恢复完成，事故快照已保存到：${result.rescue_path}`)
    await loadBackups()
  }

  return (
    <ProfileLayout
      title="备份与恢复"
      description="这里保留 SQLite 主库和附件的整库快照，适合做高风险改动前后的快速回滚。"
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">整库备份</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground">
            主库仍然是 SQLite。这里提供项目内整库快照和事故快照，用于快速回滚数据库与附件。编辑时会自动生成仅含数据库的轻量备份，完整备份和事故快照仅保留最近若干份。
          </div>
          {runtimeInfo ? (
            <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3 text-xs text-muted-foreground">
              <div>正式运行目录：{runtimeInfo.app_home}</div>
              <div className="mt-1">备份覆盖项：{runtimeInfo.backup_covered_items.join('、')}</div>
            </div>
          ) : null}
          <Button onClick={() => void handleCreateBackup()}>
            <HardDriveDownload className="mr-2 h-4 w-4" />
            立即备份
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">备份列表</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="py-6 text-sm text-muted-foreground">
              正在读取备份列表…
            </div>
          ) : backups.length === 0 ? (
            <EmptyState
              variant="list"
              title="当前还没有可用备份"
              description="系统会在关键操作后自动创建备份，你也可以手动触发备份。"
            />
          ) : (
            backups.map((backup) => {
              const isLightweight = backup.full === false || backup.scope === 'rolling'
              const kindLabel = backup.kind === 'full' ? '整库备份' : '事故快照'
              const scopeLabel = isLightweight ? '仅数据库' : '完整'
              return (
              <div
                key={backup.path}
                className="rounded-2xl border border-border/70 bg-background/70 px-4 py-4 text-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">
                      {backup.name}
                      <span className="ml-2 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {kindLabel} · {scopeLabel}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {backup.created_at}
                    </div>
                    <div className="mt-2 break-all text-xs text-muted-foreground">
                      {backup.path}
                    </div>
                    {backup.included_items && backup.included_items.length > 0 ? (
                      <div className="mt-2 text-xs text-muted-foreground">
                        覆盖项：{backup.included_items.join('、')}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {backup.kind === 'full' && !isLightweight ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleRestoreBackup(backup.path)}
                      >
                        <RotateCcw className="mr-2 h-4 w-4" />
                        整库恢复
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
              )
            })
          )}
        </CardContent>
      </Card>
    </ProfileLayout>
  )
}
