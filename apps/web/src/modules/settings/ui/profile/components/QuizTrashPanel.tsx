import { useCallback, useEffect, useState } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import {
  PreviewQuestionAnswerSummary,
  QuizQuestionStem,
  getQuestionTypeLabel,
  getQuizTrashApi,
  permanentDeletePalaceQuizQuestionApi,
  purgeQuizTrashApi,
  restorePalaceQuizQuestionApi,
} from '@/modules/quiz/public'
import type { QuizTrashItem } from '@/shared/api/contracts'
import { toast } from '@/shared/feedback/toast'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { appConfirm } from '@/shared/components/ui/native-dialog'
import { EmptyState } from '@/shared/components/state-placeholders'

const TRASH_FETCH_LIMIT = 500

function formatDeletedAt(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export function QuizTrashPanel() {
  const [items, setItems] = useState<QuizTrashItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState<QuizTrashItem | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await getQuizTrashApi(TRASH_FETCH_LIMIT, 0)
      setItems(result.items)
      setTotal(result.total)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '读取回收站失败。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const removeLocal = useCallback((questionId: number) => {
    setItems((prev) => prev.filter((item) => item.id !== questionId))
    setTotal((prev) => Math.max(0, prev - 1))
  }, [])

  const handleRestore = async (item: QuizTrashItem) => {
    try {
      await restorePalaceQuizQuestionApi(item.id)
      removeLocal(item.id)
      toast.success('题目已恢复。')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '恢复失败。')
    }
  }

  const handlePermanentDelete = async (item: QuizTrashItem) => {
    const confirmed = await appConfirm('永久删除这道题？作答记录一并删除，不可恢复。', {
      tone: 'danger',
      confirmText: '永久删除',
    })
    if (!confirmed) return
    try {
      await permanentDeletePalaceQuizQuestionApi(item.id)
      removeLocal(item.id)
      toast.success('题目已永久删除。')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败。')
    }
  }

  const handlePurge = async () => {
    if (items.length === 0) return
    const confirmed = await appConfirm(
      `将永久删除回收站中的 ${total} 道题，作答记录一并删除，不可恢复。`,
      { tone: 'danger', confirmText: '清空回收站' },
    )
    if (!confirmed) return
    try {
      const result = await purgeQuizTrashApi()
      setItems([])
      setTotal(0)
      toast.success(`已永久删除 ${result.purged_count} 道题。`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '清空回收站失败。')
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span>题目回收站</span>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={items.length === 0}
              onClick={() => void handlePurge()}
            >
              <Trash2 className="mr-2 size-4" />
              清空回收站
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            从做题页删除的题目会先进入这里。恢复后题目回到原位置，作答记录和复习进度都保留。
          </p>
          {loading ? (
            <div className="py-6 text-sm text-muted-foreground">正在读取回收站…</div>
          ) : items.length === 0 ? (
            <EmptyState
              variant="list"
              title="回收站是空的"
              description="删除的题目会先进入这里，可恢复或永久删除。"
            />
          ) : (
            <>
              <div className="text-xs text-muted-foreground">共 {total} 道题</div>
              {items.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-border/70 bg-background/70 px-4 py-4 text-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-2 font-medium">{item.stem}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <Badge variant="outline">{getQuestionTypeLabel(item.question_type)}</Badge>
                        <span>{item.palace_title || '章节题'}</span>
                        {item.palace_deleted ? (
                          <Badge variant="destructive">宫殿已删除</Badge>
                        ) : null}
                        <span>删除于 {formatDeletedAt(item.deleted_at)}</span>
                        <span>
                          答对 {item.correct_count} / 作答 {item.attempt_count}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setPreview(item)}
                      >
                        预览
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={item.palace_deleted}
                        title={item.palace_deleted ? '宫殿已删除，无法恢复' : undefined}
                        onClick={() => void handleRestore(item)}
                      >
                        <RotateCcw className="mr-2 size-4" />
                        恢复
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => void handlePermanentDelete(item)}
                      >
                        <Trash2 className="mr-2 size-4" />
                        永久删除
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={preview != null}
        onOpenChange={(open) => {
          if (!open) setPreview(null)
        }}
      >
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>题目预览</DialogTitle>
            <DialogDescription>
              {preview ? `${preview.palace_title || '章节题'} · 删除于 ${formatDeletedAt(preview.deleted_at)}` : ''}
            </DialogDescription>
          </DialogHeader>
          {preview ? (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline">{getQuestionTypeLabel(preview.question_type)}</Badge>
                <span className="text-xs text-muted-foreground">
                  答对 {preview.correct_count} / 作答 {preview.attempt_count}
                </span>
              </div>
              <div className="text-base font-semibold leading-7 text-foreground">
                <QuizQuestionStem question={preview} />
              </div>
              <PreviewQuestionAnswerSummary question={preview} />
              {preview.analysis ? (
                <div>
                  <div className="font-medium">解析</div>
                  <div className="mt-1 whitespace-pre-wrap text-muted-foreground">
                    {preview.analysis}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
