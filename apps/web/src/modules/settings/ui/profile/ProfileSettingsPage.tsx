import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ProfileSkeleton } from './ProfileSkeleton'
import { HardDriveDownload, Keyboard, RefreshCw, Settings, Save } from 'lucide-react'

import { toast } from '@/shared/feedback/toast'
import { ProfileLayout } from '@/modules/settings/ui/profile/ProfileLayout'
import {
  getClientPreferencesApi,
  getReviewSettingsApi,
  updateReviewSettingsApi,
} from '@/modules/settings/domain/preferences-entity/api'

import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { resetPwaRuntime } from '@/pwa/resetPwa'
import { ThemeSettingsCard } from '@/modules/settings/ui/profile/ThemeSettingsCard'
import { getRuntimeInfoApi, updateRuntimeConfigApi } from '@/modules/settings/domain/runtime-entity/api'
import { Input } from '@/shared/components/ui/input'

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
  const [appHome, setAppHome] = useState('')
  const [savingAppHome, setSavingAppHome] = useState(false)
  const [mutationSettings, setMutationSettings] = useState({
    attempts: '3',
    streak: '3',
    seconds: '5',
  })
  const [mutationSettingsSaving, setMutationSettingsSaving] = useState(false)

  useEffect(() => {
    void getClientPreferencesApi()
      .then(() => setClientPreferencesReady(true))
      .catch(() => setClientPreferencesReady(false))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    void getReviewSettingsApi()
      .then((settings) => {
        setMutationSettings({
          attempts: settings.quiz_mutation_min_attempts || '3',
          streak: settings.quiz_mutation_min_consecutive_correct || '3',
          seconds: String(
            Number(settings.quiz_mutation_max_duration_ms || 5000) / 1000,
          ),
        })
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    void getRuntimeInfoApi().then((info) => setAppHome(info.app_home ?? '')).catch(() => undefined)
  }, [])

  const handleSaveMutationSettings = async () => {
    const attempts = Math.max(
      1,
      Math.min(99, Math.round(Number(mutationSettings.attempts) || 3)),
    )
    const streak = Math.max(
      1,
      Math.min(99, Math.round(Number(mutationSettings.streak) || 3)),
    )
    const seconds = Math.max(
      1,
      Math.min(120, Number(mutationSettings.seconds) || 5),
    )
    setMutationSettingsSaving(true)
    try {
      await updateReviewSettingsApi({
        quiz_mutation_min_attempts: String(attempts),
        quiz_mutation_min_consecutive_correct: String(streak),
        quiz_mutation_max_duration_ms: String(Math.round(seconds * 1000)),
      })
      setMutationSettings({
        attempts: String(attempts),
        streak: String(streak),
        seconds: String(seconds),
      })
      toast.success('待换题自动检测规则已保存。')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存待换题检测规则失败。')
    } finally {
      setMutationSettingsSaving(false)
    }
  }

  const handleSaveAppHome = async () => {
    if (!appHome.trim()) return
    setSavingAppHome(true)
    try {
      const result = await updateRuntimeConfigApi(appHome.trim())
      setAppHome(result.local_app_home)
      toast.success('数据库目录已保存。请重启 Memory Anki 后生效。')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '数据库目录保存失败')
    } finally {
      setSavingAppHome(false)
    }
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
              <CardTitle className="text-base">宫殿复习排期</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                每个记忆单元按自己的记忆状态单独排期（FSRS），目标记忆率 90%，最长间隔一年。
                界面显示的是每个单元的真实间隔。
              </p>
              <p>
                新卡只有两个固定节点：当天 20 分钟复查一次，第二天隔夜检验一次，之后交给算法。
                忘记：当天再练；困难：算通过，但下一次间隔会被压短；记得或轻松：至少排到明天。
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">待换题自动检测</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                答对时同时满足三个条件，且这道题还没有被标记为「待换题」，才会自动标记。
                这条规则只负责提醒，不改变复习排期。
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="space-y-1.5 text-sm">
                  <span className="font-medium">累计作答次数</span>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      max={99}
                      value={mutationSettings.attempts}
                      onChange={(event) =>
                        setMutationSettings((current) => ({
                          ...current,
                          attempts: event.target.value,
                        }))
                      }
                    />
                    <span className="text-xs text-muted-foreground">次</span>
                  </div>
                </label>
                <label className="space-y-1.5 text-sm">
                  <span className="font-medium">连续答对次数</span>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      max={99}
                      value={mutationSettings.streak}
                      onChange={(event) =>
                        setMutationSettings((current) => ({
                          ...current,
                          streak: event.target.value,
                        }))
                      }
                    />
                    <span className="text-xs text-muted-foreground">次</span>
                  </div>
                </label>
                <label className="space-y-1.5 text-sm">
                  <span className="font-medium">本次作答耗时</span>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      max={120}
                      step={0.5}
                      value={mutationSettings.seconds}
                      onChange={(event) =>
                        setMutationSettings((current) => ({
                          ...current,
                          seconds: event.target.value,
                        }))
                      }
                    />
                    <span className="text-xs text-muted-foreground">秒内</span>
                  </div>
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  onClick={() => void handleSaveMutationSettings()}
                  loading={mutationSettingsSaving}
                  loadingText="保存中"
                >
                  <Save className="size-4" />
                  保存检测规则
                </Button>
                <span className="text-xs text-muted-foreground">
                  默认 3 次 / 3 次 / 5 秒；设置保存在本机后端，两台设备共用。
                </span>
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
              <CardTitle className="text-base">数据库位置</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">数据库与附件使用本机目录保存。修改后请重启应用。</p>
              <div className="flex gap-2">
                <Input value={appHome} onChange={(event) => setAppHome(event.target.value)} placeholder="例如 F:\\memory anki data" />
                <Button type="button" onClick={() => void handleSaveAppHome()} loading={savingAppHome} loadingText="保存中">
                  <Save className="size-4" />
                  保存
                </Button>
              </div>
            </CardContent>
          </Card>
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
