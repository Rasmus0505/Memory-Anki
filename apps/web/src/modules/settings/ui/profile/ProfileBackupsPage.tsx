import { useEffect, useState } from 'react'
import { FileArchive, HardDriveDownload, RotateCcw, Upload } from 'lucide-react'
import { useRef } from 'react'
import { toast } from '@/shared/feedback/toast'
import { ProfileLayout } from '@/modules/settings/ui/profile/ProfileLayout'
import type { BackupSummary, FullImportPreviewResponse, RuntimeInfo } from '@/shared/api/contracts'
import {
  createBackupApi,
  fullExportUrl,
  getBackupsApi,
  previewFullImportApi,
  restoreBackupApi,
  runFullImportApi,
} from '@/modules/settings/ui/profile/api'
import { getRuntimeInfoApi } from '@/modules/settings/domain/runtime-entity/api'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { EmptyState } from '@/shared/components/state-placeholders'
import { appConfirm } from '@/shared/components/ui/native-dialog'

export default function ProfileBackupsPage() {
  const fullImportInputRef = useRef<HTMLInputElement | null>(null)
  const [backups, setBackups] = useState<BackupSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null)
  const [fullImportPreview, setFullImportPreview] = useState<FullImportPreviewResponse | null>(null)
  const [fullImportFileName, setFullImportFileName] = useState('')
  const [previewingFullImport, setPreviewingFullImport] = useState(false)
  const [runningFullImport, setRunningFullImport] = useState(false)

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
    const confirmed = await appConfirm(
      '整库恢复会先自动生成事故快照，再把数据库和附件回到目标备份。确定继续吗？',
      { title: '整库恢复', tone: 'danger' },
    )
    if (!confirmed) return

    const result = await restoreBackupApi(path)
    toast.success(`整库恢复完成，事故快照已保存到：${result.rescue_path}`)
    await loadBackups()
  }

  const handleFullImportFileChange = async (file: File | undefined) => {
    if (!file) return
    setFullImportFileName(file.name)
    setFullImportPreview(null)
    setPreviewingFullImport(true)
    try {
      const preview = await previewFullImportApi(file)
      setFullImportPreview(preview)
      if (!preview.ok) {
        toast.error(preview.error || '导入包校验失败')
        return
      }
      if (!preview.schema_match) {
        toast.error('导出包数据库版本与当前程序不一致，已禁止导入。')
        return
      }
      const confirmed = await appConfirm(buildFullImportConfirmMessage(preview), {
        title: '导入全库 zip',
        confirmText: '清空并导入',
        tone: 'danger',
      })
      if (!confirmed) return
      setRunningFullImport(true)
      const result = await runFullImportApi(file)
      if (!result.ok) {
        toast.error(result.error || '全量导入失败')
        return
      }
      toast.success(`全量导入完成，已还原 ${result.restored_attachments ?? 0} 个附件。`)
      window.location.reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '全量导入失败')
    } finally {
      setPreviewingFullImport(false)
      setRunningFullImport(false)
    }
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
            <div className="rounded-lg border border-border/70 bg-background/70 px-4 py-3 text-xs text-muted-foreground">
              <div>正式运行目录：{runtimeInfo.app_home}</div>
              <div className="mt-1">备份覆盖项：{runtimeInfo.backup_covered_items.join('、')}</div>
            </div>
          ) : null}
          <Button onClick={() => void handleCreateBackup()}>
            <HardDriveDownload className="mr-2 size-4" />
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
                className="rounded-lg border border-border/70 bg-background/70 px-4 py-4 text-sm"
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
                        <RotateCcw className="mr-2 size-4" />
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">设备迁移 / 数据逃生</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground">
            下载可携带的全库 zip，包含所有数据库表、导出清单和附件目录；另一台设备上传后会替换为该包的数据。
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <a href={fullExportUrl()} download>
                <FileArchive className="mr-2 size-4" />
                导出全库 zip
              </a>
            </Button>
            <Button
              variant="outline"
              disabled={previewingFullImport || runningFullImport}
              onClick={() => fullImportInputRef.current?.click()}
            >
              <Upload className="mr-2 size-4" />
              {previewingFullImport
                ? '正在校验…'
                : runningFullImport
                  ? '正在导入…'
                  : '导入全库 zip'}
            </Button>
            <input
              ref={fullImportInputRef}
              className="sr-only"
              type="file"
              accept=".zip,application/zip"
              disabled={previewingFullImport || runningFullImport}
              onChange={(event) => {
                void handleFullImportFileChange(event.target.files?.[0])
                event.currentTarget.value = ''
              }}
            />
          </div>
          {fullImportPreview ? (
            <div className="rounded-lg border border-border/70 bg-background/70 px-4 py-3 text-xs text-muted-foreground">
              <div className="font-medium text-foreground">
                {fullImportFileName || '已选择导入包'}
              </div>
              {fullImportPreview.ok && fullImportPreview.manifest ? (
                <>
                  <div className="mt-2">
                    创建时间：{fullImportPreview.manifest.created_at}
                  </div>
                  <div className="mt-1">
                    版本校验：{fullImportPreview.schema_match ? '通过' : '不匹配，禁止导入'}
                  </div>
                  <div className="mt-1">
                    数据摘要：宫殿 {fullImportPreview.manifest.table_counts.palaces ?? 0}、
                    复习日程 {fullImportPreview.manifest.table_counts.review_schedules ?? 0}、
                    附件 {fullImportPreview.attachment_count ?? 0}
                  </div>
                </>
              ) : (
                <div className="mt-2 text-destructive">
                  {fullImportPreview.error || '导入包校验失败'}
                </div>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </ProfileLayout>
  )
}

function buildFullImportConfirmMessage(preview: FullImportPreviewResponse) {
  const counts = preview.manifest?.table_counts ?? {}
  return [
    '导入会清空当前设备全部数据并替换为 zip 内的数据。',
    '导入前会自动创建逃生备份，可从备份列表回滚。',
    '',
    `宫殿：${counts.palaces ?? 0}`,
    `复习日程：${counts.review_schedules ?? 0}`,
    `附件：${preview.attachment_count ?? 0}`,
    '',
    '确定继续吗？',
  ].join('\n')
}
