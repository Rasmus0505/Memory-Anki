import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BookOpen, Plus, Sparkles, Star, TrendingUp } from 'lucide-react'
import { api } from '@/api/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default function Dashboard() {
  const [data, setData] = useState<any>(null)

  useEffect(() => {
    api.getDashboard().then(setData)
  }, [])

  if (!data) {
    return <div className="flex items-center justify-center py-32 text-sm text-muted-foreground">正在加载仪表盘...</div>
  }

  const statCards: Array<{
    label: string
    value: string | number
    icon: typeof BookOpen
    color: string
    link?: string
    linkText?: string
    subtitle?: string
  }> = [
    {
      label: '今日到期',
      value: data.due_count,
      icon: BookOpen,
      color: data.due_count > 0 ? 'text-destructive' : 'text-emerald-500',
      link: '/review',
      linkText: '开始复习',
    },
    {
      label: '本周完成率',
      value: `${data.stats.completion_rate}%`,
      icon: TrendingUp,
      color: '',
    },
    {
      label: '平均回忆分',
      value: data.stats.avg_score,
      icon: Star,
      color: '',
    },
  ]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">仪表盘</h1>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {statCards.map(({ label, value, icon: Icon, color, link, linkText, subtitle }) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-bold ${color}`}>{value}</div>
              {link && data.due_count > 0 ? (
                <Link to={link} className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-primary">
                  {linkText}
                  <ArrowRight className="h-3 w-3" />
                </Link>
              ) : subtitle ? (
                <p className="mt-2 text-xs text-muted-foreground">{subtitle}</p>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">今日到期</CardTitle>
            <Link to="/review" className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-primary">
              查看全部
              <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent>
            {data.reviews.length > 0 ? (
              <div className="space-y-1">
                {data.reviews.slice(0, 8).map((review: any) => (
                  <Link
                    key={review.id}
                    to={`/review/session/${review.id}`}
                    className="group flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors hover:bg-secondary active:scale-[0.98]"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{review.palace?.title || '未命名宫殿'}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {review.algorithm_used} · {review.interval_days}d · #{review.review_number + 1}
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" className="ml-2 shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
                      复习
                    </Button>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">当前没有到期任务，进度不错。</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">最近编辑</CardTitle>
            <Link to="/palaces/new">
              <Button size="sm" variant="outline" className="h-8">
                <Plus className="h-3.5 w-3.5" />
                新建
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {data.recent_palaces.length > 0 ? (
              <div className="space-y-1">
                {data.recent_palaces.map((palace: any) => (
                  <Link
                    key={palace.id}
                    to={`/palaces/${palace.id}/edit`}
                    className="flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors hover:bg-secondary active:scale-[0.98]"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{palace.title || '未命名宫殿'}</div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{palace.peg_count} 个节点</span>
                        <span>·</span>
                        <span>{palace.created_at ? '最近更新' : '草稿'}</span>
                      </div>
                    </div>
                    <span className="ml-2 shrink-0 text-xs text-muted-foreground">编辑</span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">
                还没有记忆宫殿。
                <div className="mt-3">
                  <Link to="/palaces/new">
                    <Button variant="outline" size="sm">
                      <Sparkles className="mr-2 h-4 w-4" />
                      创建一个
                    </Button>
                  </Link>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
