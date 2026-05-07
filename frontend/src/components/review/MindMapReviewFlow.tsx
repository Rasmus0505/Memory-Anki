import * as React from 'react'
import { Lightbulb, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export type ReviewRating = 'forgot' | 'fuzzy' | 'remembered'

export interface ReviewMindMapNode {
  id: string
  text: string
  note: string
  children: ReviewMindMapNode[]
}

export interface MindMapDocNode {
  data?: {
    text?: string
    note?: string
    uid?: string
    memoryAnkiId?: number | null
    [key: string]: unknown
  }
  children?: MindMapDocNode[]
}

export interface MindMapDocLike {
  root?: MindMapDocNode
}

export function parseEditorDoc(raw: unknown): MindMapDocLike | null {
  if (!raw) return null
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as MindMapDocLike
    } catch {
      return null
    }
  }
  if (typeof raw === 'object') return raw as MindMapDocLike
  return null
}

function plainText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim()
}

function normalizeNode(node: MindMapDocNode | undefined, fallbackId: string): ReviewMindMapNode {
  const data = node?.data ?? {}
  const children = Array.isArray(node?.children) ? node.children : []
  const text = plainText(data.text) || '未命名节点'
  const note = plainText(data.note)
  const id = String(data.uid ?? data.memoryAnkiId ?? fallbackId)

  return {
    id,
    text,
    note,
    children: children.map((child, index) => normalizeNode(child, `${fallbackId}-${index}`)),
  }
}

export function buildReviewTree(doc: MindMapDocLike | null, fallbackTitle: string): ReviewMindMapNode {
  if (!doc?.root) {
    return { id: 'root', text: fallbackTitle || '未命名导图', note: '', children: [] }
  }
  return normalizeNode(doc.root, 'root')
}

export function countNodes(node: ReviewMindMapNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0)
}

function ratingLabel(rating: ReviewRating): string {
  if (rating === 'forgot') return '忘记'
  if (rating === 'fuzzy') return '模糊'
  return '记住'
}

function BranchCard({ node, level }: { node: ReviewMindMapNode; level: number }) {
  return (
    <div className="space-y-2" style={{ marginLeft: level * 20 }}>
      <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
        <div className="text-sm font-medium">{node.text}</div>
        {node.note ? <div className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{node.note}</div> : null}
      </div>
      {node.children.length > 0 ? (
        <div className="space-y-2">
          {node.children.map((child) => (
            <BranchCard key={child.id} node={child} level={level + 1} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

interface MindMapReviewFlowProps {
  title: string
  description?: string
  editorDoc: unknown
  submitting?: boolean
  onSubmit: (rating: ReviewRating) => void | Promise<void>
  result?: ReviewRating | null
  resultActions?: React.ReactNode
  startLabel?: string
}

export function MindMapReviewFlow({
  title,
  description,
  editorDoc,
  submitting = false,
  onSubmit,
  result = null,
  resultActions,
  startLabel = '开始回忆',
}: MindMapReviewFlowProps) {
  const reviewTree = buildReviewTree(parseEditorDoc(editorDoc), title)
  const branches = reviewTree.children
  const totalNodeCount = countNodes(reviewTree)
  const [started, setStarted] = React.useState(false)
  const [revealedBranchCount, setRevealedBranchCount] = React.useState(0)

  React.useEffect(() => {
    setStarted(false)
    setRevealedBranchCount(0)
  }, [title, editorDoc])

  const currentBranch = revealedBranchCount > 0 ? branches[revealedBranchCount - 1] : null
  const allBranchesRevealed = branches.length === 0 ? started : revealedBranchCount >= branches.length
  const canRevealNext = started && revealedBranchCount < branches.length

  const startRecall = () => {
    setStarted(true)
    setRevealedBranchCount(branches.length > 0 ? 1 : 0)
  }

  const revealNextBranch = () => {
    setRevealedBranchCount((current) => Math.min(current + 1, branches.length))
  }

  return (
    <div className="space-y-6">
      {!started ? (
        <div className="rounded-2xl border border-dashed border-border/80 bg-background/70 px-6 py-10 text-center">
          <Lightbulb className="mx-auto mb-4 h-10 w-10 text-muted-foreground/60" />
          <p className="text-lg font-medium">先在脑中完整回忆这张导图</p>
          <p className="mt-2 text-sm text-muted-foreground">开始后会按主分支顺序逐条揭示，帮助你先想再核对。</p>
          <Button className="mt-6" size="lg" onClick={startRecall}>
            {startLabel}
          </Button>
        </div>
      ) : (
        <>
          {description ? (
            <div className="rounded-2xl bg-background/70 p-4 text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
              {description}
            </div>
          ) : null}

          <div className="space-y-4 rounded-2xl border border-border/70 bg-background/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">中心主题</div>
                <div className="text-xs text-muted-foreground">
                  {branches.length > 0
                    ? `已揭示 ${revealedBranchCount} / ${branches.length} 条主分支`
                    : '这张导图没有主分支，可直接按整图回忆评分。'}
                </div>
              </div>
              {canRevealNext ? (
                <Button variant="outline" size="sm" onClick={revealNextBranch}>
                  揭示下一分支
                </Button>
              ) : allBranchesRevealed ? (
                <Badge variant="secondary">完整导图已展示</Badge>
              ) : null}
            </div>

            <div className="rounded-3xl border border-primary/15 bg-card px-6 py-5 text-center shadow-sm">
              <div className="text-xs tracking-[0.28em] text-muted-foreground">中心主题</div>
              <div className="mt-2 text-xl font-semibold">{reviewTree.text}</div>
              {reviewTree.note ? (
                <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{reviewTree.note}</div>
              ) : null}
              <div className="mt-3 text-xs text-muted-foreground">{totalNodeCount} 个导图节点</div>
            </div>

            {branches.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2">
                {branches.map((branch, index) => {
                  const isRevealed = index < revealedBranchCount
                  const isCurrent = currentBranch?.id === branch.id
                  return (
                    <div
                      key={branch.id}
                      className={`rounded-2xl border px-4 py-4 transition-colors ${
                        isRevealed ? 'border-primary/20 bg-card' : 'border-dashed border-border/80 bg-muted/20'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-medium">{isRevealed ? branch.text : `主分支 ${index + 1}`}</div>
                        <Badge variant={isRevealed ? 'secondary' : 'outline'}>
                          {isRevealed ? (isCurrent ? '当前核对' : '已揭示') : '未揭示'}
                        </Badge>
                      </div>
                      {isRevealed ? (
                        <>
                          {branch.note ? (
                            <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{branch.note}</div>
                          ) : null}
                          {branch.children.length > 0 ? (
                            <div className="mt-3 space-y-2 border-l border-border/60 pl-3">
                              {branch.children.map((child) => (
                                <BranchCard key={child.id} node={child} level={1} />
                              ))}
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <div className="mt-3 h-16 rounded-xl bg-muted/50" />
                      )}
                    </div>
                  )
                })}
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-border/70 bg-card p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4" />
              按整次回忆质量评分
            </div>

            {result ? (
              <div className="space-y-4">
                <div className="rounded-2xl bg-background/70 px-4 py-4 text-sm text-muted-foreground">
                  本次练习结果：<span className="font-medium text-foreground">{ratingLabel(result)}</span>
                </div>
                {resultActions}
              </div>
            ) : (
              <>
                {!allBranchesRevealed ? (
                  <div className="mb-3 rounded-2xl border border-dashed border-border/80 bg-background/60 px-4 py-3 text-sm text-muted-foreground">
                    请先把所有主分支都揭示完，再提交这次评分。
                  </div>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-3">
                  <Button variant="destructive" disabled={submitting || !allBranchesRevealed} onClick={() => void onSubmit('forgot')}>
                    忘记
                  </Button>
                  <Button variant="outline" disabled={submitting || !allBranchesRevealed} onClick={() => void onSubmit('fuzzy')}>
                    模糊
                  </Button>
                  <Button disabled={submitting || !allBranchesRevealed} onClick={() => void onSubmit('remembered')}>
                    记住
                  </Button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
