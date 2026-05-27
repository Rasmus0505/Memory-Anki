import { BookOpen, ChevronRight, LayoutGrid, LibraryBig, List, Plus, Rows3, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  DEFAULT_PALACE_SHELF_VIEW_SETTINGS,
  PALACE_SHELF_VIEW_SETTINGS_KEY,
  type PalaceShelfDensityMode,
  type PalaceShelfLayoutMode,
  type PalaceShelfViewSettings,
  isPalaceShelfViewSettings,
} from '@/app/router/palace-view-settings'
import type { PalaceSubjectShelfItem } from '@/shared/api/contracts'
import { getPalaceSubjectShelfApi } from '@/shared/api/modules/palaces'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { useLocalStorageState } from '@/shared/lib/localStorage'
import { cn } from '@/shared/lib/utils'

const shelfLayoutOptions: Array<{ value: PalaceShelfLayoutMode; label: string; icon: typeof List }> = [
  { value: 'single', label: '单列', icon: List },
  { value: 'double', label: '双列', icon: Rows3 },
  { value: 'grid', label: '多列网格', icon: LayoutGrid },
]

const shelfDensityOptions: Array<{ value: PalaceShelfDensityMode; label: string }> = [
  { value: 'comfortable', label: '舒展' },
  { value: 'standard', label: '标准' },
  { value: 'compact', label: '紧凑' },
]

function statusBadge(item: PalaceSubjectShelfItem) {
  if (item.review_status === 'due_now') {
    return <span className="inline-block h-3 w-3 rounded-full bg-emerald-500" title="现在可复习" />
  }
  if (item.review_status === 'due_later_today') {
    return <span className="inline-block h-3 w-3 rounded-full bg-amber-400" title="今天稍后可复习" />
  }
  return null
}

function getShelfGridClass(layoutMode: PalaceShelfLayoutMode) {
  if (layoutMode === 'single') return 'grid-cols-1'
  if (layoutMode === 'grid') return 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'
  return 'grid-cols-1 lg:grid-cols-2'
}

function getShelfCardContentClass(densityMode: PalaceShelfDensityMode) {
  if (densityMode === 'comfortable') return 'min-h-[248px] p-7 pl-11'
  if (densityMode === 'compact') return 'min-h-[188px] p-4 pl-8'
  return 'min-h-[220px] p-6 pl-10'
}

function getShelfMetaSpacingClass(densityMode: PalaceShelfDensityMode) {
  if (densityMode === 'comfortable') return 'space-y-5'
  if (densityMode === 'compact') return 'space-y-3'
  return 'space-y-4'
}

function getShelfStatCardClass(densityMode: PalaceShelfDensityMode) {
  if (densityMode === 'comfortable') return 'px-4 py-4'
  if (densityMode === 'compact') return 'px-3 py-2'
  return 'px-4 py-3'
}

function getShelfTitleClass(densityMode: PalaceShelfDensityMode) {
  if (densityMode === 'comfortable') return 'text-xl'
  if (densityMode === 'compact') return 'text-base'
  return 'text-lg'
}

export default function PalaceShelfPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get('search') || ''
  const [items, setItems] = useState<PalaceSubjectShelfItem[]>([])
  const [viewSettings, setViewSettings] = useLocalStorageState<PalaceShelfViewSettings>(
    PALACE_SHELF_VIEW_SETTINGS_KEY,
    DEFAULT_PALACE_SHELF_VIEW_SETTINGS,
    isPalaceShelfViewSettings,
  )

  useEffect(() => {
    const load = async () => {
      const params: Record<string, string> = {}
      if (search) params.search = search
      const response = await getPalaceSubjectShelfApi(params)
      setItems(response.items || [])
    }
    void load()
  }, [search])

  const categorizedCount = useMemo(() => items.filter((item) => item.subject).length, [items])

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">学科书架</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            一个学科就是一本书，点击进入后继续查看你熟悉的章节和宫殿列表。
          </p>
        </div>
        <Link to="/palaces/new">
          <Button size="sm">
            <Plus className="h-4 w-4" />
            新建宫殿
          </Button>
        </Link>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[180px] flex-1">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="搜索学科或宫殿..."
                  value={search}
                  onChange={(event) =>
                    setSearchParams((params) => {
                      if (event.target.value) params.set('search', event.target.value)
                      else params.delete('search')
                      return params
                    })
                  }
                  className="pl-9"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2" data-testid="shelf-view-toolbar">
              <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border/70 bg-background/80 p-1">
                {shelfLayoutOptions.map((option) => {
                  const Icon = option.icon
                  return (
                    <Button
                      key={option.value}
                      type="button"
                      variant={viewSettings.layoutMode === option.value ? 'secondary' : 'ghost'}
                      size="sm"
                      className="h-8"
                      onClick={() => setViewSettings((current) => ({ ...current, layoutMode: option.value }))}
                    >
                      <Icon className="h-4 w-4" />
                      {option.label}
                    </Button>
                  )
                })}
              </div>
              <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border/70 bg-background/80 p-1">
                {shelfDensityOptions.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    variant={viewSettings.densityMode === option.value ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-8"
                    onClick={() => setViewSettings((current) => ({ ...current, densityMode: option.value }))}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setViewSettings(DEFAULT_PALACE_SHELF_VIEW_SETTINGS)}
              >
                恢复默认
              </Button>
            </div>
            {search ? (
              <Button variant="ghost" size="sm" onClick={() => setSearchParams({})}>
                清除搜索
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Badge variant="secondary">{categorizedCount} 个学科书架</Badge>
        <Badge variant="outline">{items.find((item) => item.subject == null) ? '含未分类' : '全部已分类'}</Badge>
      </div>

      {items.length > 0 ? (
        <div
          className={cn('grid gap-5', getShelfGridClass(viewSettings.layoutMode))}
          data-testid="shelf-grid"
          data-layout-mode={viewSettings.layoutMode}
          data-density-mode={viewSettings.densityMode}
        >
          {items.map((item, index) => {
            const isUncategorized = item.subject == null
            const title = item.subject?.name || '未分类'
            const color = item.subject?.color || '#94a3b8'
            return (
              <button
                key={item.subject?.id ?? `uncategorized-${index}`}
                type="button"
                onClick={() => navigate(isUncategorized ? '/palaces/list?uncategorized=true' : `/palaces/list?subjectId=${item.subject?.id}`)}
                className="text-left"
              >
                <Card className="group relative h-full overflow-hidden border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.96))] transition-all hover:-translate-y-1 hover:shadow-xl">
                  <div
                    className="absolute inset-y-0 left-0 w-5 rounded-l-xl opacity-90"
                    style={{ backgroundColor: color }}
                  />
                  <CardContent className={cn('relative flex h-full flex-col justify-between', getShelfCardContentClass(viewSettings.densityMode))}>
                    <div className={getShelfMetaSpacingClass(viewSettings.densityMode)}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div
                            className="flex h-11 w-11 items-center justify-center rounded-2xl text-white shadow-sm"
                            style={{ backgroundColor: color }}
                          >
                            {isUncategorized ? <LibraryBig className="h-5 w-5" /> : <BookOpen className="h-5 w-5" />}
                          </div>
                          <div>
                            <div className={cn('font-semibold text-foreground', getShelfTitleClass(viewSettings.densityMode))}>{title}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {isUncategorized ? '尚未归入学科的宫殿' : '点击进入学科详情'}
                            </div>
                          </div>
                        </div>
                        {statusBadge(item)}
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className={cn('rounded-2xl border border-border/70 bg-background/70', getShelfStatCardClass(viewSettings.densityMode))}>
                          <div className="text-xs text-muted-foreground">宫殿数量</div>
                          <div className="mt-1 text-xl font-semibold">{item.palace_count}</div>
                        </div>
                        <div className={cn('rounded-2xl border border-border/70 bg-background/70', getShelfStatCardClass(viewSettings.densityMode))}>
                          <div className="text-xs text-muted-foreground">章节数量</div>
                          <div className="mt-1 text-xl font-semibold">{item.chapter_count}</div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-6 flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        {item.review_status === 'due_now'
                          ? '当前有到点复习'
                          : item.review_status === 'due_later_today'
                            ? '今天稍后有复习'
                            : '当前没有紧急复习'}
                      </span>
                      <span className="inline-flex items-center font-medium text-foreground">
                        打开
                        <ChevronRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1" />
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </button>
            )
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center p-12 text-center">
            <LibraryBig className="mb-4 h-12 w-12 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">还没有可以展示的学科书架。</p>
            <Link to="/palaces/new" className="mt-2">
              <Button variant="outline" size="sm">
                <Plus className="h-4 w-4" />
                创建第一个宫殿
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
