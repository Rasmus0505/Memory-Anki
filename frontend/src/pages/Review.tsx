import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { api } from '@/api/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Brain, Eye, Sparkles, Star, ChevronDown, ChevronRight, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { TreeRenderer } from '@/components/mindmap/TreeRenderer'
import type { TreeRenderMeta } from '@/components/mindmap/TreeRenderer'

interface PegNode {
  id: number; name: string; content: string; children: PegNode[]
}

export default function Review() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [reviews, setReviews] = useState<any>(null)
  const [current, setCurrent] = useState<any>(null)
  const [flipped, setFlipped] = useState(false)
  const [score, setScore] = useState<number | null>(null)
  const [expandedPegs, setExpandedPegs] = useState<Set<number>>(new Set())
  const [revealedPegs, setRevealedPegs] = useState<Set<number>>(new Set([] as number[]))
  const [revealedLayer, setRevealedLayer] = useState(1)
  const [overdueCount, setOverdueCount] = useState(0)

  useEffect(() => {
    if (id) {
      api.getReviewItem(Number(id)).then(setCurrent)
    } else {
      api.getReviews().then(setReviews)
      api.getOverdueCount().then((r: any) => setOverdueCount(r.count))
    }
  }, [id])

  const submitReview = async (s: number) => {
    if (!current) return
    const res = await api.submitReview(current.id, { score: s, duration_seconds: 0 })
    toast.success(s >= 3 ? 'Good!' : 'Keep trying!')
    if (res.next_id) {
      navigate(`/review/${res.next_id}`)
      setFlipped(false); setScore(null)
      setRevealedPegs(new Set()); setExpandedPegs(new Set()); setRevealedLayer(1)
    } else {
      navigate('/review')
    }
  }

  // Collect all pegs from tree
  const collectPegs = (pegs: PegNode[], depth: number = 0): { node: PegNode, depth: number }[] => {
    const result: { node: PegNode, depth: number }[] = []
    for (const p of pegs) {
      result.push({ node: p, depth })
      if (p.children?.length > 0) result.push(...collectPegs(p.children, depth + 1))
    }
    return result
  }

  const revealNext = () => {
    if (!current) return
    const allPegs = collectPegs(current.palace?.pegs || [])
    const nextLayer = revealedLayer + 1
    const toReveal = allPegs.filter(p => p.depth < nextLayer).map(p => p.node.id)
    setRevealedPegs(new Set(toReveal))
    setRevealedLayer(nextLayer)
  }

  if (id && current) {
    const p = current.palace
    const isFlashcard = p?.review_mode === 'flashcard'
    const allPegs = collectPegs(p?.pegs || [])
    const maxDepth = allPegs.length > 0 ? Math.max(...allPegs.map(p => p.depth)) : 0

    const getReviewChildren = (peg: PegNode) => {
      if (!revealedPegs.has(peg.id)) return []
      return peg.children || []
    }

    const renderPegRow = (peg: PegNode, meta: TreeRenderMeta) => {
      const isRevealed = revealedPegs.has(peg.id)
      return (
        <div className="flex items-center gap-2 rounded-md py-1.5 px-2 transition-colors hover:bg-secondary/50"
          style={{ paddingLeft: 8 + meta.depth * 24 }}>
          {meta.hasChildren && isRevealed && (
            <button onClick={meta.toggleExpand} className="text-muted-foreground shrink-0">
              {meta.isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          )}
          {(!meta.hasChildren || !isRevealed) && <span className="w-3.5 shrink-0" />}
          <div className="flex items-center gap-2">
            <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold
              ${isRevealed ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
              {isRevealed ? (meta.depth === 0 ? peg.name[0] || '?' : meta.depth) : '?'}
            </div>
            <div>
              {isRevealed ? (
                <>
                  <span className="font-semibold text-sm">{peg.name}</span>
                  {peg.content && <span className="text-sm text-muted-foreground ml-2">{peg.content}</span>}
                </>
              ) : (
                <span className="text-sm text-muted-foreground italic">Tap to reveal</span>
              )}
            </div>
          </div>
        </div>
      )
    }

    return (
      <div className="space-y-6 max-w-3xl">
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <Link to="/review" className="hover:text-foreground transition-colors flex items-center gap-1"><ArrowLeft className="h-4 w-4" /> Queue</Link>
          <span>·</span>
          <Badge variant="secondary">{current.algorithm_used}</Badge>
          <span>Review #{current.review_number + 1}</span>
          <span>·</span>
          <span>{isFlashcard ? <><Sparkles className="h-3.5 w-3.5 inline mr-1" />Flashcard</> : <><Eye className="h-3.5 w-3.5 inline mr-1" />Browse</>}</span>
        </div>

        {isFlashcard ? (
          <div className="perspective-1000">
            {!flipped ? (
              <Card>
                <CardContent className="!p-12 text-center">
                  <p className="text-xs text-muted-foreground mb-8 uppercase tracking-wider">Click to flip</p>
                  <h2 className="text-2xl font-bold mb-4">{p?.title || 'Untitled'}</h2>
                  <div className="text-sm text-muted-foreground mb-4">{'★'.repeat(p?.difficulty || 3)}{'☆'.repeat(5 - (p?.difficulty || 3))}</div>
                  {p?.pegs?.length > 0 && (
                    <div className="flex flex-wrap justify-center gap-2 mb-8">
                      {p.pegs.map((pg: any) => <Badge key={pg.id} variant="outline" className="text-sm px-3 py-1">{pg.name}</Badge>)}
                    </div>
                  )}
                  <Button size="lg" onClick={() => { setFlipped(true); revealNext() }}>Flip Card</Button>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="!p-8 space-y-6">
                  <h2 className="text-2xl font-bold">{p?.title || 'Untitled'}</h2>

                  {p?.description && (
                    <div className="text-sm text-muted-foreground bg-secondary/50 rounded-lg p-5 whitespace-pre-wrap leading-relaxed">{p.description}</div>
                  )}

                  {/* Peg tree with cascading reveal */}
                  <div className="border rounded-lg p-4 space-y-0.5">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold">Memory Pegs</h3>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Layer {revealedLayer} / {maxDepth + 1}</span>
                        {revealedLayer <= maxDepth && (
                          <Button variant="outline" size="sm" onClick={revealNext} className="h-7 text-xs">
                            Reveal Next Layer
                          </Button>
                        )}
                      </div>
                    </div>
                    <TreeRenderer
                      nodes={p.pegs || []}
                      getKey={(peg: any) => peg.id}
                      getChildren={getReviewChildren}
                      renderNode={renderPegRow}
                      alwaysExpanded
                    />
                  </div>

                  {p?.attachments?.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {p.attachments.map((a: any) => (
                        <a key={a.id} href={`/api/attachments/${a.id}`} target="_blank"
                          className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                          <FileText className="h-3.5 w-3.5" />{a.original_name}
                        </a>
                      ))}
                    </div>
                  )}

                  <div className="border-t pt-6">
                    <p className="text-sm text-muted-foreground text-center mb-4">How well do you remember?</p>
                    <div className="flex gap-1 star-rating flex-row-reverse justify-center mb-6">
                      {[5, 4, 3, 2, 1].map(s => (
                        <span key={s}>
                          <input type="radio" name="score" value={s} id={`s${s}`} onChange={() => setScore(s)} />
                          <label htmlFor={`s${s}`} className="text-2xl">★</label>
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-3 justify-center">
                      <Button variant="destructive" onClick={() => submitReview(0)}>Forgot All</Button>
                      <Button onClick={() => score !== null && submitReview(score)} disabled={score === null}><Star className="h-4 w-4" /> Confirm</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        ) : (
          <Card>
            <CardContent className="!p-8 space-y-6">
              <h2 className="text-2xl font-bold">{p?.title || 'Untitled'}</h2>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <Badge variant="outline">Browse Mode</Badge>
                <span>{current.algorithm_used}</span>
                <span>·</span>
                <span>Interval {current.interval_days}d</span>
              </div>
              {p?.description && <div className="text-sm text-muted-foreground bg-secondary/50 rounded-lg p-5 whitespace-pre-wrap leading-relaxed">{p.description}</div>}
              {p?.pegs?.length > 0 && (
                <div className="border rounded-lg p-4 space-y-0.5">
                  <h3 className="text-sm font-semibold mb-3">Memory Pegs</h3>
                  <TreeRenderer
                    nodes={p.pegs}
                    getKey={(pg: any) => pg.id}
                    getChildren={(pg: any) => pg.children || []}
                    alwaysExpanded
                    renderNode={(pg: any, meta: TreeRenderMeta) => (
                      <div className="flex items-center gap-2 rounded-md py-1.5 px-2 hover:bg-secondary/50" style={{ paddingLeft: 8 + meta.depth * 24 }}>
                        <div className={`flex shrink-0 items-center justify-center rounded-full text-xs font-bold
                          ${meta.depth === 0 ? 'h-6 w-6 bg-primary text-primary-foreground' : 'h-5 w-5 bg-secondary text-muted-foreground text-[10px]'}`}>
                          {meta.depth === 0 ? (pg.name[0] || '?') : '•'}
                        </div>
                        <span className={meta.depth === 0 ? 'font-semibold text-sm' : 'text-sm'}>{pg.name}</span>
                        {pg.content && <span className="text-sm text-muted-foreground ml-2">{pg.content}</span>}
                      </div>
                    )}
                  />
                </div>
              )}
              <div className="border-t pt-6">
                <p className="text-sm text-muted-foreground text-center mb-4">How well do you remember?</p>
                <div className="flex gap-1 star-rating flex-row-reverse justify-center mb-6">
                  {[5, 4, 3, 2, 1].map(s => (
                    <span key={s}>
                      <input type="radio" name="score" value={s} id={`bs${s}`} onChange={() => setScore(s)} />
                      <label htmlFor={`bs${s}`} className="text-2xl">★</label>
                    </span>
                  ))}
                </div>
                <div className="flex justify-center">
                  <Button onClick={() => score !== null && submitReview(score)} disabled={score === null}><Star className="h-4 w-4" /> Confirm</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    )
  }

  if (!reviews) return <div className="flex items-center justify-center py-32 text-sm text-muted-foreground">Loading...</div>

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Review Queue</h1>
          <p className="text-sm text-muted-foreground mt-1">Today's reviews.</p>
        </div>
        {overdueCount > 5 && (
          <Button variant="outline" size="sm" onClick={async () => {
            const res = await api.spreadOverdue(7)
            toast.success(`已均摊 ${res.spread} 项到未来 7 天`)
            api.getReviews().then(setReviews)
            setOverdueCount(0)
          }}>积压清理 ({overdueCount}项)</Button>
        )}
      </div>
      {reviews.reviews?.length > 0 ? (
        <div className="space-y-3">
          {reviews.reviews.map((r: any) => {
            const overdue = new Date(r.scheduled_date) < new Date(new Date().toDateString())
            return (
              <Link key={r.id} to={`/review/${r.id}`}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardContent className="!p-5 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary">
                        <Brain className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div>
                        <div className="font-semibold">{r.palace?.title || 'Untitled'}</div>
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                          <Badge variant="secondary" className="text-[10px]">{r.algorithm_used}</Badge>
                          <span>Interval {r.interval_days}d</span>
                          <span>·</span>
                          <span>#{r.review_number + 1}</span>
                          <span>·</span>
                          <span>{r.palace?.review_mode === 'flashcard' ? 'Flashcard' : 'Browse'}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {overdue && <Badge variant="destructive" className="text-[10px]">Overdue</Badge>}
                      <Button size="sm">Start</Button>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="!p-12 flex flex-col items-center text-center">
            <Brain className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <p className="text-sm text-muted-foreground">No reviews due</p>
            <Link to="/palaces/new" className="mt-2"><Button variant="outline" size="sm">Create Palace</Button></Link>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
