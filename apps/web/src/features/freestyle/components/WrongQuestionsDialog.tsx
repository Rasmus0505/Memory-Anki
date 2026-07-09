import { BookOpenCheck, LoaderCircle, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getWrongQuestionsApi } from '@/features/freestyle/api'
import type { WrongQuestionItem } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { EmptyState } from '@/shared/components/state-placeholders'
import { toast } from '@/shared/feedback/toast'
import { cn } from '@/shared/lib/utils'

function formatLastWrongAt(value: string | null) {
  if (!value) return '暂无记录'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function shortStem(stem: string) {
  const normalized = stem.trim().replace(/\s+/g, ' ')
  return normalized.length > 60 ? `${normalized.slice(0, 60)}...` : normalized
}

function groupWrongQuestions(items: WrongQuestionItem[]) {
  return items.reduce((groups, item) => {
    const title = item.palace_title || '未归属宫殿'
    const current = groups.get(title) ?? []
    current.push(item)
    groups.set(title, current)
    return groups
  }, new Map<string, WrongQuestionItem[]>())
}

export function WrongQuestionsDialog({
  open,
  onOpenChange,
  onStartRetrain,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onStartRetrain: () => void
}) {
  const [items, setItems] = useState<WrongQuestionItem[]>([])
  const [loading, setLoading] = useState(false)

  const groups = useMemo(() => Array.from(groupWrongQuestions(items).entries()), [items])

  const loadWrongQuestions = useCallback(async () => {
    setLoading(true)
    try {
      const response = await getWrongQuestionsApi()
      setItems(response.items || [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载错题本失败。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void loadWrongQuestions()
  }, [loadWrongQuestions, open])

  const handleStartRetrain = () => {
    onStartRetrain()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[86vh] max-w-4xl flex-col overflow-hidden bg-background p-0" floatingId="wrong-questions">
        <DialogHeader>
          <div className="min-w-0">
            <DialogTitle className="flex items-center gap-2">
              <BookOpenCheck className="size-4" />
              错题本
            </DialogTitle>
            <DialogDescription>按宫殿聚合最近需要回炉的题目。</DialogDescription>
          </div>
          <DialogClose onClick={() => onOpenChange(false)} />
        </DialogHeader>

        <div className={cn('min-h-0 flex-1 overflow-y-auto px-5 py-4', loading && 'opacity-70')}>
          {items.length === 0 && !loading ? (
            <EmptyState title="暂无错题，保持手感" description="做错的题会自动汇总到这里。" />
          ) : (
            <div className="space-y-4">
              {groups.map(([title, groupItems]) => (
                <section key={title} className="space-y-2">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <h3 className="min-w-0 truncate font-medium">{title}</h3>
                    <span className="shrink-0 text-xs text-muted-foreground">{groupItems.length} 题</span>
                  </div>
                  <div className="space-y-2">
                    {groupItems.map((item) => (
                      <article key={item.question.id} className="rounded-md border border-border/70 px-3 py-3">
                        <div className="line-clamp-2 text-sm font-medium">
                          {shortStem(item.question.stem)}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span>错 {item.incorrect_count}/{Math.max(item.attempt_count, 1)} 次</span>
                          <span>正确 {item.correct_count}</span>
                          <span>最近做错 {formatLastWrongAt(item.last_wrong_at)}</span>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" size="icon" onClick={() => void loadWrongQuestions()} aria-label="刷新错题本">
            {loading ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          </Button>
          <Button type="button" disabled={items.length === 0} onClick={handleStartRetrain}>
            重练全部错题（{items.length}）
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
