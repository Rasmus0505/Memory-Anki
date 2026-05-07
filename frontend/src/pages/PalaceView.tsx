import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { api } from '@/api/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Brain, ChevronDown, ChevronRight } from 'lucide-react'
import { MindMapContainer, pegTreeToGraph } from '@/components/mindmap'
import type { TreeRenderMeta } from '@/components/mindmap'

export default function PalaceView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [palace, setPalace] = useState<any>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  useEffect(() => { api.getPalace(Number(id)).then(setPalace) }, [id])

  if (!palace) return <div className="flex items-center justify-center py-32 text-sm text-muted-foreground">加载中...</div>

  const renderPegRow = (peg: any, meta: TreeRenderMeta) => (
    <div className="flex items-center gap-2 rounded-md py-1.5 px-2 hover:bg-secondary/50 transition-colors"
      style={{ paddingLeft: 8 + meta.depth * 20 }}>
      {meta.hasChildren ? (
        <button onClick={meta.toggleExpand} className="text-muted-foreground shrink-0">
          {meta.isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
      ) : <span className="w-3.5 shrink-0" />}
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
        {peg.name?.[0] || '?'}
      </div>
      <span className="font-semibold text-sm">{peg.name}</span>
      {peg.content && <span className="text-sm text-muted-foreground ml-2">{peg.content}</span>}
    </div>
  )

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-4">
        <Link to="/palaces" className="text-muted-foreground hover:text-foreground transition-colors"><ArrowLeft className="h-5 w-5" /></Link>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{palace.title}</h1>
          <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
            <span>{'★'.repeat(palace.difficulty)}{'☆'.repeat(5 - palace.difficulty)}</span>
            <span>·</span>
            <span>{palace.review_mode === 'flashcard' ? '闪卡' : '浏览'}</span>
            {palace.mastered && <span className="text-emerald-500 font-medium">· 已掌握</span>}
            {palace.archived && <span className="text-muted-foreground">· 已归档</span>}
          </div>
        </div>
        <Link to={`/review`}>
          <Button size="sm" variant="outline" onClick={() => {
            // Find first due review for this palace
            api.getReviews().then((r: any) => {
              const sched = r.reviews?.find((s: any) => s.palace_id === palace.id)
              if (sched) navigate(`/review/${sched.id}`)
              else navigate('/review')
            })
          }}>
            <Brain className="h-4 w-4 mr-1" />正式复习
          </Button>
        </Link>
      </div>

      <Card>
        <CardContent className="!p-6 space-y-4">
          {palace.description && (
            <div className="text-sm text-muted-foreground bg-secondary/30 rounded-lg p-4 whitespace-pre-wrap leading-relaxed">
              {palace.description}
            </div>
          )}
          {palace.pegs?.length > 0 && (
            <MindMapContainer
              title="记忆桩"
              graphData={pegTreeToGraph(palace.pegs)}
              defaultView="outline"
              treeProps={{
                nodes: palace.pegs,
                getKey: (p: any) => p.id,
                getChildren: (p: any) => p.children || [],
                renderNode: renderPegRow,
                expanded,
                onExpandedChange: setExpanded,
              }}
            />
          )}
          {palace.attachments?.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {palace.attachments.map((a: any) => (
                <a key={a.id} href={`/api/attachments/${a.id}`} target="_blank"
                  className="text-sm text-primary hover:underline">{a.original_name}</a>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
