import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ProfileSkeleton } from './ProfileSkeleton'
import { HardDriveDownload, Keyboard, RefreshCw, Settings } from 'lucide-react'

import { toast } from '@/shared/feedback/toast'
import { ProfileLayout } from '@/modules/settings/ui/profile/ProfileLayout'
import { getClientPreferencesApi } from '@/modules/settings/domain/preferences-entity/api'

import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { resetPwaRuntime } from '@/pwa/resetPwa'
import { ThemeSettingsCard } from '@/modules/settings/ui/profile/ThemeSettingsCard'

interface ProfileSettingsPageProps {
  shortcutsSettings: ReactNode
}

export default function ProfileSettingsPage({
  shortcutsSettings,
}: ProfileSettingsPageProps) {
  const [tab, setTab] = useState<'config' | 'shortcuts' | 'runtime'>('config')
  const [loading, setLoading] = useState(true)
  const [clientPreferencesReady, setClientPreferencesReady] = useState(false)
  const [pwaResetting, setPwaResetting] = useState(false)

  useEffect(() => {
    void getClientPreferencesApi()
      .then(() => setClientPreferencesReady(true))
      .catch(() => setClientPreferencesReady(false))
      .finally(() => setLoading(false))
  }, [])

  const handleResetPwa = async () => {
    setPwaResetting(true)
    try {
      const result = await resetPwaRuntime()
      toast.success(
        `PWA 缓存已清理：${result.deletedCaches} 个缓存，${result.unregisteredServiceWorkers} 个 Service Worker`,
      )
      window.location.assign(`/freestyle?pwa_refresh=${Date.now()}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'PWA 刷新失败，请稍后重试')
      setPwaResetting(false)
    }
  }


  if (loading) {
    return (
      <ProfileSkeleton />
    )
  }

  return (
    <ProfileLayout
      title="复习与偏好"
      description="管理显示偏好、快捷键和本机运行时维护。"
    >

      <div className="flex gap-1 border-b">
        {[
          { key: 'config', label: '复习与调度', icon: Settings },
          { key: 'shortcuts', label: '快捷键', icon: Keyboard },
          { key: 'runtime', label: '本机运行时', icon: RefreshCw },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key as 'config' | 'shortcuts' | 'runtime')}
            className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
            }`}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'shortcuts' ? (
        shortcutsSettings
      ) : tab === 'config' ? (
        <div className="space-y-6">
          <ThemeSettingsCard />
          <Card>
            <CardHeader>
              <CardTitle className="text-base">宫殿复习阶梯</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2" aria-label="固定复习间隔">
                {[0, 1, 3, 7, 14, 30, 60, 120, 240, 365].map((days) => (
                  <span key={days} className="rounded-md border bg-muted px-2.5 py-1 text-sm tabular-nums">
                    {days === 0 ? '首学' : `${days} 天`}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="space-y-6">
          {clientPreferencesReady ? (
            <div className="rounded-lg border border-success/30 bg-success/5 px-4 py-3 text-sm text-success">
              快捷键、反馈、计时自动化和视图偏好已由本机后端托管保存。
            </div>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <RefreshCw className="size-4" />
                PWA 更新
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-sm text-muted-foreground">
                清理当前设备的离线缓存和 Service Worker，然后重新加载应用。学习数据不会被清除。
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleResetPwa()}
                loading={pwaResetting}
                loadingText="正在刷新 PWA"
              >
                <RefreshCw className="size-4" />
                手动更新 PWA
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <HardDriveDownload className="size-4" />
                数据迁移入口已移动
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>JSON、Markdown、全库 ZIP 与宫殿导入统一放在“数据与备份”，安全操作与清库操作已物理分离。</p>
              <Button asChild variant="outline">
                <Link to="/profile/backups?tab=transfer">打开迁移与导入导出</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </ProfileLayout>
  )
}
