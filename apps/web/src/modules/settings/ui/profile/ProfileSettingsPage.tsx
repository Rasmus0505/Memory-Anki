import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ProfileSkeleton } from './ProfileSkeleton'
import { HardDriveDownload, Keyboard, RefreshCw, Settings } from 'lucide-react'

import { toast } from '@/shared/feedback/toast'
import { ProfileLayout } from '@/modules/settings/ui/profile/ProfileLayout'
import type { ReviewSettings } from '@/shared/api/contracts'
import {
  getReviewSettingsApi,
  updateReviewSettingsApi,
} from '@/modules/settings/domain/preferences-entity/api'
import { getClientPreferencesApi } from '@/modules/settings/domain/preferences-entity/api'

import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { resetPwaRuntime } from '@/pwa/resetPwa'
import { ThemeSettingsCard } from '@/modules/settings/ui/profile/ThemeSettingsCard'

interface ProfileSettingsPageProps {
  shortcutsSettings: ReactNode
}

export default function ProfileSettingsPage({
  shortcutsSettings,
}: ProfileSettingsPageProps) {
  const [tab, setTab] = useState<'config' | 'shortcuts' | 'runtime'>('config')
  const [config, setConfig] = useState<ReviewSettings | null>(null)
  const [clientPreferencesReady, setClientPreferencesReady] = useState(false)
  const [pwaResetting, setPwaResetting] = useState(false)

  useEffect(() => {
    const loadSettings = async () => {
      const [settings] = await Promise.all([
        getReviewSettingsApi(),
        getClientPreferencesApi().then(() => setClientPreferencesReady(true)).catch(() => setClientPreferencesReady(false)),
      ])
      setConfig(settings)
    }

    void loadSettings()
  }, [])

  const handleSaveConfig = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const data: Record<string, string> = {}

    formData.forEach((value, key) => {
      data[key] = value as string
    })

    data.auto_smooth_overdue = formData.get('auto_smooth_overdue')
      ? 'true'
      : 'false'
    data.early_review_anchor = formData.get('early_review_anchor')
      ? 'true'
      : 'false'

    const nextConfig = await updateReviewSettingsApi(data)
    setConfig(nextConfig)
    toast.success('复习高级配置已保存')
  }

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


  if (!config) {
    return (
      <ProfileSkeleton />
    )
  }

  return (
    <ProfileLayout
      title="复习与偏好"
      description="管理复习与调度规则、快捷键和本机运行时维护。"
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
          <form onSubmit={handleSaveConfig} className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">记忆调度</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">FSRS 会根据每个节点的实际评分计算下一次复习时间；旧艾宾浩斯记录保留在数据库中用于迁移审计。</p>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="desired-retention">目标记忆率</Label>
                    <Input id="desired-retention" name="desired_retention" type="number" min="0.7" max="0.99" step="0.01" defaultValue={config.desired_retention || '0.90'} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mastery-horizon-days">掌握跨度（天）</Label>
                    <Input id="mastery-horizon-days" name="mastery_horizon_days" type="number" min="7" max="365" defaultValue={config.mastery_horizon_days || '60'} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="maximum-interval">最长间隔（天）</Label>
                    <Input id="maximum-interval" name="maximum_interval" type="number" min="1" max="365" defaultValue={config.maximum_interval || '180'} />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="learning-steps">首次学习短期步骤</Label>
                    <Input id="learning-steps" name="learning_steps" defaultValue={config.learning_steps || '10m,1h'} placeholder="10m,1h" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="relearning-steps">遗忘后短期步骤</Label>
                    <Input id="relearning-steps" name="relearning_steps" defaultValue={config.relearning_steps || '10m,1h'} placeholder="10m,1h" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">会话与积压</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="sleep-review-time">睡前复习时间</Label>
                    <Input
                      id="sleep-review-time"
                      name="sleep_review_time"
                      defaultValue={config.sleep_review_time || '22:00'}
                      type="time"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="daily-max">每日正式复习上限</Label>
                    <Input
                      id="daily-max"
                      name="daily_max_reviews"
                      defaultValue={config.daily_max_reviews || '0'}
                      type="number"
                      min="0"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="overdue-days">逾期平滑窗口天数</Label>
                    <Input
                      id="overdue-days"
                      name="overdue_smoothing_days"
                      defaultValue={config.overdue_smoothing_days || '7'}
                      type="number"
                      min="1"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="overdue-threshold">
                    触发自动平滑的逾期阈值
                  </Label>
                  <Input
                    id="overdue-threshold"
                    name="overdue_smoothing_threshold"
                    defaultValue={config.overdue_smoothing_threshold || '5'}
                    type="number"
                    min="0"
                  />
                </div>

                <div className="rounded-lg border p-4">
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      name="auto_smooth_overdue"
                      defaultChecked={config.auto_smooth_overdue === 'true'}
                      className="mt-0.5"
                    />
                    <div>
                      <div className="text-sm font-medium">
                        默认自动平滑逾期任务
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        进入复习总览前先自动分散逾期任务，减少单日压死的情况。
                      </div>
                    </div>
                  </label>
                </div>

                <div className="rounded-lg border p-4">
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      name="early_review_anchor"
                      defaultChecked={config.early_review_anchor === 'true'}
                      className="mt-0.5"
                    />
                    <div>
                      <div className="text-sm font-medium">提前复习锚定策略</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        启用后，提前复习不会缩短后续间隔，下次仍从原计划日继续计算。
                      </div>
                    </div>
                  </label>
                </div>
              </CardContent>
            </Card>


            <Button type="submit">保存复习配置</Button>
          </form>
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
