import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BookOpenText, LoaderCircle, Sparkles } from 'lucide-react'
import { getEnglishReadingWorkspaceApi } from '@/modules/english-reading/public'
import type { ReadingMaterial, ReadingWorkspaceResponse } from '@/shared/api/contracts'
import { EnglishContinueHero, EnglishStatStrip } from '@/modules/english/ui/english-shell'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { EmptyState } from '@/shared/components/state-placeholders'
import { formatDuration } from '@/modules/session/public'
import { toast } from '@/shared/feedback/toast'
import { cn } from '@/shared/lib/utils'

export function EnglishHubReadingTab() {
  const [workspace, setWorkspace] = useState<ReadingWorkspaceResponse | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const next = await getEnglishReadingWorkspaceApi()
      setWorkspace(next)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载阅读工作台失败。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loading || !workspace) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        正在加载阅读…
      </div>
    )
  }

  const continueMaterial = workspace.recentMaterials.find((item) => item.latestVersionId) ?? null

  return (
    <div className="space-y-5" data-testid="english-hub-reading-tab">
      <EnglishContinueHero
        eyebrow="Continue reading"
        title={continueMaterial ? continueMaterial.title : '还没有可继续的阅读稿'}
        description={
          continueMaterial
            ? '打开最近一篇已生成材料，进入沉浸阅读。'
            : '先导入或粘贴英文材料，系统会按你的 CEFR 舒适区生成 i+1 阅读稿。'
        }
        meta={
          continueMaterial ? (
            <>
              <Badge variant="outline">{continueMaterial.sourceType.toUpperCase()}</Badge>
              <span>{continueMaterial.wordCount} 词</span>
              <span>等级 {workspace.profile.declaredCefr}</span>
            </>
          ) : (
            <span>当前等级 {workspace.profile.declaredCefr}</span>
          )
        }
        primaryLabel={continueMaterial ? '继续阅读' : '去准备材料'}
        primaryHref={
          continueMaterial
            ? `/english/reading/materials/${continueMaterial.id}`
            : '/english/reading'
        }
        empty={false}
        secondary={
          <Button asChild variant="outline" size="lg" className="min-h-11 rounded-xl">
            <Link to="/english/reading">
              <Sparkles className="size-4" />
              新材料 / 设置
            </Link>
          </Button>
        }
      />

      <EnglishStatStrip
        items={[
          { label: '材料', value: workspace.stats.totalMaterials },
          { label: '今日阅读', value: formatDuration(workspace.stats.todayReadingSeconds) },
          {
            label: '升级进度',
            value: `${workspace.profile.levelProgress}% · ${workspace.profile.declaredCefr}`,
          },
        ]}
      />

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">最近材料</h3>
          <Button asChild variant="ghost" size="sm" className="rounded-xl">
            <Link to="/english/reading">
              打开完整工作台
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>

        {workspace.recentMaterials.length === 0 ? (
          <EmptyState
            variant="list"
            title="还没有阅读材料"
            description="在阅读工作台粘贴全文或上传 txt / md / pdf。"
          />
        ) : (
          <div className="space-y-2.5">
            {workspace.recentMaterials.map((item) => (
              <MaterialRow key={item.id} item={item} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function MaterialRow({ item }: { item: ReadingMaterial }) {
  return (
    <Link
      to={`/english/reading/materials/${item.id}`}
      className={cn(
        'flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card/95 px-4 py-3.5 shadow-soft transition',
        'hover:border-info/30 hover:bg-info/5',
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{item.title}</span>
          <Badge variant="outline">{item.sourceType.toUpperCase()}</Badge>
          <Badge variant={item.latestVersionId ? 'secondary' : 'outline'}>
            {item.latestVersionId ? '可阅读' : '待生成'}
          </Badge>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {item.wordCount} 词 · 更新于{' '}
          {item.updatedAt ? new Date(item.updatedAt).toLocaleString('zh-CN') : '刚刚'}
        </div>
      </div>
      <BookOpenText className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  )
}
