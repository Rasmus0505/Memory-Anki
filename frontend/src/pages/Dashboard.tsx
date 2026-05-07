import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/api/client'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { BookOpen, TrendingUp, Star, ArrowRight, Plus } from 'lucide-react'

export default function Dashboard() {
  const [data, setData] = useState<any>(null)
  useEffect(() => { api.getDashboard().then(setData) }, [])

  if (!data) return <div className="flex items-center justify-center py-32 text-sm text-muted-foreground">Loading...</div>

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Overview of your memory palaces.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: 'Due Today', value: data.due_count, icon: BookOpen, color: data.due_count > 0 ? 'text-destructive' : 'text-emerald-500', link: '/review', linkText: 'Start Review' },
          { label: 'Weekly Rate', value: `${data.stats.completion_rate}%`, icon: TrendingUp, color: '', subtitle: `${data.stats.total} reviews` },
          { label: 'Avg Score', value: data.stats.avg_score, icon: Star, color: '', subtitle: 'Out of 5' },
        ].map(({ label, value, icon: Icon, color, link, linkText, subtitle }) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-bold ${color}`}>{value}</div>
              {link && data.due_count > 0
                ? <Link to={link} className="text-xs text-muted-foreground hover:text-primary transition-colors mt-1 inline-flex items-center gap-1">{linkText} <ArrowRight className="h-3 w-3" /></Link>
                : <p className="text-xs text-muted-foreground mt-2">{subtitle}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Due Today</CardTitle>
            <Link to="/review" className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">All <ArrowRight className="h-3 w-3" /></Link>
          </CardHeader>
          <CardContent>
            {data.reviews.length > 0 ? (
              <div className="space-y-1">
                {data.reviews.slice(0, 8).map((r: any) => (
                  <Link key={r.id} to={`/review/${r.id}`}
                    className="flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-secondary transition-colors group active:scale-[0.98]">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{r.palace?.title || 'Untitled'}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{r.algorithm_used} · {r.interval_days}d · #{r.review_number + 1}</div>
                    </div>
                    <Button size="sm" variant="ghost" className="shrink-0 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">Review</Button>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">All caught up!</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Recent Activity</CardTitle>
            <Link to="/palaces/new"><Button size="sm" variant="outline" className="h-8"><Plus className="h-3.5 w-3.5" /> New</Button></Link>
          </CardHeader>
          <CardContent>
            {data.recent_palaces.length > 0 ? (
              <div className="space-y-1">
                {data.recent_palaces.map((p: any) => (
                  <Link key={p.id} to={`/palaces/${p.id}/edit`}
                    className="flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-secondary transition-colors active:scale-[0.98]">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{p.title || 'Untitled'}</div>
                      <div className="text-xs text-muted-foreground mt-1">{p.peg_count} pegs · {'★'.repeat(p.difficulty)}{'☆'.repeat(5 - p.difficulty)}</div>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0 ml-2">Edit</span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No palaces yet. <Link to="/palaces/new" className="text-primary underline underline-offset-4">Create one</Link></p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
