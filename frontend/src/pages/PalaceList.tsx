import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '@/api/client'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { BookOpen, Plus, Search, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

export default function PalaceList() {
  const [palaces, setPalaces] = useState<any[]>([])
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get('search') || ''
  const difficulty = searchParams.get('difficulty') || ''

  const fetchData = () => {
    const params: Record<string, string> = {}
    if (search) params.search = search
    if (difficulty) params.difficulty = difficulty
    api.getPalaces(params).then(setPalaces)
  }
  useEffect(() => { fetchData() }, [searchParams])

  const handleDelete = async (id: number, title: string) => {
    if (!confirm(`确定删除「${title}」吗？此操作不可撤销。`)) return
    await api.deletePalace(id)
    toast.success('已删除')
    fetchData()
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">记忆宫殿</h1>
          <p className="text-sm text-muted-foreground mt-1">管理你所有的记忆宫殿。</p>
        </div>
        <Link to="/palaces/new">
          <Button size="sm">
            <Plus className="h-4 w-4" /> 新建宫殿
          </Button>
        </Link>
      </div>

      <Card>
        <CardContent className="!p-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[160px]">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="搜索标题..." value={search}
                  onChange={e => setSearchParams(p => { if (e.target.value) p.set('search', e.target.value); else p.delete('search'); return p })}
                  className="pl-9" />
              </div>
            </div>
            <div>
              <select value={difficulty} onChange={e => setSearchParams(p => { if (e.target.value) p.set('difficulty', e.target.value); else p.delete('difficulty'); return p })}
                className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                <option value="">全部难度</option>
                {[1, 2, 3, 4, 5].map(d => <option key={d} value={d}>{'★'.repeat(d)}{'☆'.repeat(5 - d)}</option>)}
              </select>
            </div>
            {(search || difficulty) && (
              <Button variant="ghost" size="sm" onClick={() => setSearchParams({})}>清除筛选</Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {palaces.length > 0 ? palaces.map((p: any) => (
          <Card key={p.id} className="hover:shadow-md transition-shadow">
            <CardContent className="!p-5 flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary">
                <BookOpen className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <Link to={`/palaces/${p.id}/edit`} className="font-semibold hover:text-primary transition-colors">
                  {p.title || '未命名宫殿'}
                </Link>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-muted-foreground">
                  <span>{'★'.repeat(p.difficulty)}{'☆'.repeat(5 - p.difficulty)}</span>
                  <span>{p.pegs?.length || 0} 个记忆桩</span>
                  <span>{p.review_mode === 'flashcard' ? '闪卡' : '浏览'}</span>
                </div>
                {p.description && (
                  <p className="text-sm text-muted-foreground mt-2 line-clamp-1">{p.description.slice(0, 150)}</p>
                )}
              </div>
              <div className="flex gap-1 shrink-0 items-center">
                {p.mastered && <Badge variant="secondary" className="text-[10px]">已掌握</Badge>}
                {p.archived && <Badge variant="outline" className="text-[10px] text-muted-foreground">已归档</Badge>}
                <Link to={`/palaces/${p.id}`}><Button variant="ghost" size="sm" className="h-8">浏览</Button></Link>
                <Link to={`/palaces/${p.id}/edit`}>
                  <Button variant="ghost" size="icon" className="h-8 w-8"><Pencil className="h-4 w-4" /></Button>
                </Link>
                <Button variant="ghost" size="icon" className="h-8 w-8"
                  onClick={() => { api.archivePalace(p.id, !p.archived).then(() => fetchData()); toast.success(p.archived ? '已取消归档' : '已归档') }}>
                  {p.archived ? '📂' : '📁'}
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => handleDelete(p.id, p.title)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </CardContent>
          </Card>
        )) : (
          <Card>
            <CardContent className="!p-12 flex flex-col items-center text-center">
              <BookOpen className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <p className="text-sm text-muted-foreground">还没有记忆宫殿</p>
              <Link to="/palaces/new" className="mt-2">
                <Button variant="outline" size="sm">
                  <Plus className="h-4 w-4" /> 创建第一个
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
