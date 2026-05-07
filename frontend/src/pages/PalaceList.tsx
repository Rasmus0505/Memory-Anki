import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BookOpen, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

export default function PalaceList() {
  const [palaces, setPalaces] = useState<any[]>([])
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get('search') || ''

  const fetchData = () => {
    const params: Record<string, string> = {}
    if (search) params.search = search
    api.getPalaces(params).then(setPalaces)
  }

  useEffect(() => {
    fetchData()
  }, [searchParams])

  const handleDelete = async (id: number, title: string) => {
    if (!confirm(`确定删除“${title}”吗？此操作无法撤销。`)) return
    await api.deletePalace(id)
    toast.success('已删除')
    fetchData()
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">记忆宫殿</h1>
          <p className="mt-1 text-sm text-muted-foreground">管理所有记忆宫殿，并从这里直接进入练习。</p>
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
                  placeholder="搜索标题..."
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
            {search ? (
              <Button variant="ghost" size="sm" onClick={() => setSearchParams({})}>
                清除搜索
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {palaces.length > 0 ? (
          palaces.map((palace) => (
            <Card key={palace.id} className="transition-shadow hover:shadow-md">
              <CardContent className="flex items-start gap-4 p-5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary">
                  <BookOpen className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <Link to={`/palaces/${palace.id}/edit`} className="font-semibold transition-colors hover:text-primary">
                    {palace.title || '未命名宫殿'}
                  </Link>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{palace.pegs?.length || 0} 个导图节点入口</span>
                    <span>{palace.chapters?.length || 0} 个关联章节</span>
                  </div>
                  {palace.description ? (
                    <p className="mt-2 line-clamp-1 text-sm text-muted-foreground">{palace.description.slice(0, 150)}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {palace.mastered ? <Badge variant="secondary" className="text-[10px]">已掌握</Badge> : null}
                  {palace.archived ? <Badge variant="outline" className="text-[10px] text-muted-foreground">已归档</Badge> : null}
                  <Link to={`/palaces/${palace.id}/practice`}>
                    <Button variant="ghost" size="sm" className="h-8">
                      练习
                    </Button>
                  </Link>
                  <Link to={`/palaces/${palace.id}/edit`}>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </Link>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => {
                      api.archivePalace(palace.id, !palace.archived).then(fetchData)
                      toast.success(palace.archived ? '已取消归档' : '已归档')
                    }}
                  >
                    {palace.archived ? '📨' : '📦'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(palace.id, palace.title)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center p-12 text-center">
              <BookOpen className="mb-4 h-12 w-12 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">还没有记忆宫殿。</p>
              <Link to="/palaces/new" className="mt-2">
                <Button variant="outline" size="sm">
                  <Plus className="h-4 w-4" />
                  创建第一个
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
