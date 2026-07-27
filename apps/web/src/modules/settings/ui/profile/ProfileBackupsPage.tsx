import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  Download,
  FileArchive,
  FileJson,
  FileText,
  HardDriveDownload,
  RotateCcw,
  Upload,
} from 'lucide-react'
import { toast } from '@/shared/feedback/toast'
import { ProfileLayout } from '@/modules/settings/ui/profile/ProfileLayout'
import type { BackupSummary, FullImportPreviewResponse, RuntimeInfo } from '@/shared/api/contracts'
import {
  createBackupApi,
  exportJsonUrl,
  exportMarkdownUrl,
  fullExportUrl,
  getBackupsApi,
  importFileApi,
  previewFullImportApi,
  restoreBackupApi,
  runFullImportApi,
} from '@/modules/settings/ui/profile/api'
import { getRuntimeInfoApi } from '@/modules/settings/domain/runtime-entity/api'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { EmptyState } from '@/shared/components/state-placeholders'
import { appConfirm } from '@/shared/components/ui/native-dialog'
import {
  buildRestoreConfirm,
  canRestoreBackup,
  describeBackupKind,
  describeBackupReason,
  filterBackups,
  type BackupKindFilter,
} from '@/modules/settings/ui/profile/model/backup-view'

const DATA_TABS = [
  { key: 'backups', label: '备份与恢复' },
  { key: 'transfer', label: '迁移与导入导出' },
  { key: 'danger', label: '危险区' },
] as const

type DataTab = (typeof DATA_TABS)[number]['key']

function normalizeTab(value: string | null): DataTab {
  return DATA_TABS.some((tab) => tab.key === value) ? (value as DataTab) : 'backups'
}

export default function ProfileBackupsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = normalizeTab(searchParams.get('tab'))

  const fullImportInputRef = useRef<HTMLInputElement | null>(null)
  const [backups, setBackups] = useState<BackupSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null)
  const [kindFilter, setKindFilter] = useState<BackupKindFilter>('all')
  const [keyword, setKeyword] = useState('')
  const [importResult, setImportResult] = useState<string | null>(null)
  const [fullImportPreview, setFullImportPreview] = useState<FullImportPreviewResponse | null>(null)
  const [fullImportFileName, setFullImportFileName] = useState('')
  const [previewingFullImport, setPreviewingFullImport] = useState(false)
  const [runningFullImport, setRunningFullImport] = useState(false)

  const setTab = useCallback(
    (next: DataTab) => {
      // Merge rather than replace: a bare object would drop any other query the
      // page is carrying.
      const params = new URLSearchParams(searchParams)
      params.set('tab', next)
      setSearchParams(params, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  const loadBackups = useCallback(async () => {
    setLoading(true)
    try {
      const result = await getBackupsApi()
      setBackups(result.items)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadBackups()
    void getRuntimeInfoApi().then(setRuntimeInfo).catch(() => setRuntimeInfo(null))
  }, [loadBackups])

  const handleCreateBackup = async () => {
    const result = await createBackupApi('manual')
    toast.success(`已创建整库备份：${result.path}`)
    await loadBackups()
  }

  const handleRestoreBackup = async (backup: BackupSummary) => {
    const { message, options } = buildRestoreConfirm(backup)
    if (!(await appConfirm(message, options))) return

    const result = await restoreBackupApi(backup.path)
    toast.success(`整库恢复完成，事故快照已保存到：${result.rescue_path}`)
    await loadBackups()
  }

  const handleImport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const fileInput = form.elements.namedItem('file') as HTMLInputElement
    const formatInput = form.elements.namedItem('format') as HTMLSelectElement
    const file = fileInput.files?.[0]
    if (!file) return

    const confirmed = await appConfirm(
      `将从「${file.name}」按 ${formatInput.value.toUpperCase()} 格式追加导入宫殿。现有数据不会被清空。`,
      { title: '导入宫殿', confirmText: '开始导入' },
    )
    if (!confirmed) return

    const result = await importFileApi(file, formatInput.value)
    if (result.ok) {
      toast.success(`成功导入 ${result.count} 个宫殿`)
      setImportResult(null)
      return
    }
    setImportResult(`导入失败: ${result.error ?? '未知错误'}`)
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

  const visibleBackups = filterBackups(backups, { kind: kindFilter, keyword })

  return (
    <ProfileLayout
      title="数据与备份"
      description="整库快照、设备迁移和宫殿导入导出都在这里。会清空本机数据的操作单独放在危险区。"
    >
      <Tabs value={tab} onValueChange={(value) => setTab(normalizeTab(value))} className="space-y-4">
        <TabsList className="h-auto flex-wrap rounded-lg border border-border/70 bg-background/90 p-1">
          {DATA_TABS.map((item) => (
            <TabsTrigger key={item.key} value={item.key} className="gap-2 rounded-xl px-4 py-2">
              {item.key === 'danger' ? <AlertTriangle className="size-4" /> : null}
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="backups" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">整库备份</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-sm text-muted-foreground">
                主库是 SQLite。编辑时会自动生成仅含数据库的轻量备份；恢复、导入等高风险操作前会自动创建事故快照。三类快照只要含数据库就都能恢复。
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
              <div className="flex flex-wrap gap-2">
                <select
                  aria-label="备份类型筛选"
                  className="h-9 rounded-md border border-border/70 bg-background px-2 text-sm"
                  value={kindFilter}
                  onChange={(event) => setKindFilter(event.target.value as BackupKindFilter)}
                >
                  <option value="all">全部类型</option>
                  <option value="full">整库备份</option>
                  <option value="rolling">轻量自动备份</option>
                  <option value="rescue">事故快照</option>
                </select>
                <Input
                  aria-label="搜索备份"
                  className="h-9 w-56"
                  placeholder="搜索名称或原因"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                />
              </div>

              {loading ? (
                <div className="py-6 text-sm text-muted-foreground">正在读取备份列表…</div>
              ) : visibleBackups.length === 0 ? (
                <EmptyState
                  variant="list"
                  title={backups.length === 0 ? '当前还没有可用备份' : '没有符合条件的备份'}
                  description="系统会在关键操作后自动创建备份，你也可以手动触发备份。"
                />
              ) : (
                visibleBackups.map((backup) => {
                  const { kindLabel, scopeLabel } = describeBackupKind(backup)
                  return (
                    <div
                      key={backup.path}
                      className="rounded-lg border border-border/70 bg-background/70 px-4 py-4 text-sm"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium">
                            {backup.name}
                            <span className="ml-2 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                              {kindLabel} · {scopeLabel}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {backup.created_at} · {describeBackupReason(backup.reason)}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <ContentChip label="数据库" present={backup.has_database} />
                            <ContentChip label="附件" present={backup.has_attachments} />
                            <ContentChip label="英语数据" present={backup.has_english_data ?? false} />
                          </div>
                          <details className="mt-2 text-xs text-muted-foreground">
                            <summary className="cursor-pointer">路径与覆盖项</summary>
                            <div className="mt-1 break-all">{backup.path}</div>
                            {backup.included_items && backup.included_items.length > 0 ? (
                              <div className="mt-1">覆盖项：{backup.included_items.join('、')}</div>
                            ) : null}
                          </details>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {canRestoreBackup(backup) ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void handleRestoreBackup(backup)}
                            >
                              <RotateCcw className="mr-2 size-4" />
                              整库恢复
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">该快照不含数据库</span>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="transfer" className="space-y-4">
          {importResult ? (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {importResult}
            </div>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Download className="size-4" />
                导出
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 md:grid-cols-3">
              <ExportLink href={exportJsonUrl()} icon={<FileJson className="size-5 shrink-0 text-muted-foreground" />} title="JSON 导出/迁移" />
              <ExportLink href={exportMarkdownUrl()} icon={<FileText className="size-5 shrink-0 text-muted-foreground" />} title="Markdown 导出/迁移" />
              <ExportLink href={fullExportUrl()} icon={<FileArchive className="size-5 shrink-0 text-muted-foreground" />} title="全库 zip（含附件）" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Upload className="size-4" />
                导入宫殿（JSON / Markdown）
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-sm text-muted-foreground">
                向当前库追加导入宫殿，不会清空现有数据。整包替换请到危险区。
              </p>
              <form onSubmit={handleImport} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="import-format">
                    文件格式
                  </label>
                  <select
                    id="import-format"
                    name="format"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="json">JSON</option>
                    <option value="markdown">Markdown</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="import-file">
                    选择文件
                  </label>
                  <input
                    id="import-file"
                    type="file"
                    name="file"
                    required
                    className="w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-secondary file:px-4 file:py-2 file:text-sm file:font-medium file:text-foreground hover:file:bg-secondary/80"
                  />
                </div>
                <Button type="submit">
                  <Upload className="size-4" />
                  开始导入
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="danger" className="space-y-4">
          <Card className="border-destructive/40 bg-destructive/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-destructive">
                <AlertTriangle className="size-4" />
                危险区
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                以下操作会不可逆地改写本机数据。导出与常规导入在「迁移与导入导出」，不在这里。
              </p>

              <div className="rounded-lg border border-destructive/40 bg-background/70 p-4">
                <div className="text-sm font-semibold text-foreground">导入全库 zip</div>
                <p className="mt-1 text-sm text-muted-foreground">
                  会<strong>清空当前设备全部数据</strong>并替换为 zip 内的数据。导入前自动创建逃生备份，可从备份列表回滚。
                </p>
                <div className="mt-3">
                  <Button
                    variant="destructive"
                    disabled={previewingFullImport || runningFullImport}
                    onClick={() => fullImportInputRef.current?.click()}
                  >
                    <Upload className="mr-2 size-4" />
                    {previewingFullImport
                      ? '正在校验…'
                      : runningFullImport
                        ? '正在导入…'
                        : '选择 zip 并清空导入'}
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
                  <div className="mt-3 rounded-lg border border-border/70 bg-background/70 px-4 py-3 text-xs text-muted-foreground">
                    <div className="font-medium text-foreground">
                      {fullImportFileName || '已选择导入包'}
                    </div>
                    {fullImportPreview.ok && fullImportPreview.manifest ? (
                      <>
                        <div className="mt-2">创建时间：{fullImportPreview.manifest.created_at}</div>
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
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </ProfileLayout>
  )
}

function ContentChip({ label, present }: { label: string; present: boolean }) {
  return (
    <span
      className={
        present
          ? 'inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-[11px] text-foreground'
          : 'inline-flex items-center rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground/60 line-through'
      }
    >
      {label}
    </span>
  )
}

function ExportLink({
  href,
  icon,
  title,
}: {
  href: string
  icon: React.ReactNode
  title: string
}) {
  return (
    <a
      href={href}
      download
      className="flex items-center gap-3 rounded-lg border p-3 text-sm transition-colors hover:bg-secondary"
    >
      {icon}
      <div className="font-medium">{title}</div>
    </a>
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
