import { useCallback, useEffect, useState } from 'react'

import type {
  PalaceQuizQuestion,
  PalaceQuizQuestionVariant,
  PalaceQuizQuestionVersions,
} from '@/shared/api/contracts'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet'
import { appConfirm } from '@/shared/components/ui/native-dialog'
import { toast } from '@/shared/feedback/toast'
import { formatApiDateTime } from '@/shared/lib/dateTime'
import { cn } from '@/shared/lib/utils'

import {
  activatePalaceQuizQuestionVariantApi,
  deletePalaceQuizQuestionVariantApi,
  getPalaceQuizQuestionVersionsApi,
} from '../api'

function formatVariantAnswer(variant: PalaceQuizQuestionVariant): string {
  const payload = variant.answer_payload || {}
  if (variant.question_type === 'multiple_choice') {
    const ids = payload.correct_option_ids
    if (Array.isArray(ids) && ids.length > 0) return ids.join('')
    return payload.correct_option_id || '暂无'
  }
  if (variant.question_type === 'short_answer') {
    return payload.reference_answer || '暂无'
  }
  if (variant.question_type === 'true_false') {
    return payload.correct_answer ? '对' : '错'
  }
  if (variant.question_type === 'fill_blank') {
    return (payload.blanks || [])
      .map((blank) => `${blank.id}：${blank.answer}`)
      .join('；') || '暂无'
  }
  if (variant.question_type === 'matching') {
    return (payload.pairs || [])
      .map((pair) => `${pair.left} → ${pair.right}`)
      .join('；') || '暂无'
  }
  if (variant.question_type === 'ordering') {
    const itemById = Object.fromEntries(
      (payload.items || []).map((item) => [item.id, item.text]),
    )
    return (payload.correct_order_ids || [])
      .map((id) => itemById[id] || id)
      .join(' → ') || '暂无'
  }
  if (variant.question_type === 'categorization') {
    const categoryById = Object.fromEntries(
      (payload.categories || []).map((category) => [category.id, category.name]),
    )
    return (payload.items || [])
      .map((item) => `${item.text} → ${categoryById[item.category_id || ''] || item.category_id}`)
      .join('；') || '暂无'
  }
  return '暂无'
}

function QuestionVariantSummary({ variant }: { variant: PalaceQuizQuestionVariant }) {
  const correctIds = new Set(
    variant.question_type === 'multiple_choice'
      ? [
          ...(variant.answer_payload.correct_option_ids || []),
          ...(variant.answer_payload.correct_option_id
            ? [variant.answer_payload.correct_option_id]
            : []),
        ].map(String)
      : [],
  )
  return (
    <div className="space-y-2">
      <p className="whitespace-pre-wrap text-sm font-medium leading-6">
        {variant.stem || '（题干为空）'}
      </p>
      {variant.options?.length ? (
        <div className="space-y-1 text-xs text-muted-foreground">
          {variant.options.map((option) => (
            <div
              key={option.id}
              className={cn(
                'rounded-md px-2 py-1',
                correctIds.has(String(option.id)) && 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
              )}
            >
              {option.id}. {option.text}
              {correctIds.has(String(option.id)) ? '（正确）' : ''}
            </div>
          ))}
        </div>
      ) : null}
      <div className="rounded-md bg-muted/50 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">答案：</span>
        {formatVariantAnswer(variant)}
        <div className="mt-1">
          <span className="font-medium text-foreground">解析：</span>
          {variant.analysis || '暂无解析'}
        </div>
      </div>
    </div>
  )
}

export function QuizQuestionVersionSheet({
  question,
  open,
  onOpenChange,
  onQuestionUpdated,
  onAnswerReset,
}: {
  question: PalaceQuizQuestion
  open: boolean
  onOpenChange: (open: boolean) => void
  onQuestionUpdated: (question: PalaceQuizQuestion) => void
  onAnswerReset?: (questionId: number) => void
}) {
  const [versions, setVersions] = useState<PalaceQuizQuestionVersions | null>(null)
  const [loading, setLoading] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setVersions(await getPalaceQuizQuestionVersionsApi(question.id))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载题目版本失败。')
    } finally {
      setLoading(false)
    }
  }, [question.id])

  useEffect(() => {
    if (!open) return
    setVersions(null)
    void refresh()
  }, [open, refresh])

  const handleActivate = async (versionId: string) => {
    if (versionId === versions?.active_version_id) return
    setSavingId(versionId)
    try {
      const response = await activatePalaceQuizQuestionVariantApi(question.id, versionId)
      onQuestionUpdated(response.item)
      onAnswerReset?.(question.id)
      await refresh()
      toast.success(
        versionId === 'original'
          ? '已恢复原始真题。'
          : `已切换到 AI 变体 ${versionId}。`,
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '切换题目版本失败。')
    } finally {
      setSavingId(null)
    }
  }

  const handleDelete = async (versionId: string) => {
    const wasActive = versions?.active_version_id === versionId
    const confirmed = await appConfirm(
      '删除后这个变体无法恢复；原始真题始终保留，不受影响。',
      { title: '删除 AI 变体', confirmText: '删除', tone: 'danger' },
    )
    if (!confirmed) return
    setSavingId(versionId)
    try {
      const response = await deletePalaceQuizQuestionVariantApi(question.id, versionId)
      onQuestionUpdated(response.item)
      if (wasActive) onAnswerReset?.(question.id)
      await refresh()
      toast.success('已删除变体。')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除变体失败。')
    } finally {
      setSavingId(null)
    }
  }

  const activeVersionId = versions?.active_version_id || 'original'
  const cards: PalaceQuizQuestionVariant[] = versions
    ? [versions.original, ...versions.versions]
    : []

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-2xl"
      >
        <SheetHeader className="border-b border-border/70 px-5 py-4 pr-12">
          <SheetTitle>题目版本历史</SheetTitle>
          <SheetDescription>
            原始真题始终保留；AI 变体可随时切换或删除，删除变体不会影响原题。
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {loading && versions == null ? (
            <p className="py-10 text-center text-sm text-muted-foreground">加载版本中…</p>
          ) : versions == null ? (
            <div className="space-y-3 py-8 text-center">
              <p className="text-sm text-muted-foreground">版本加载失败。</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
                再试一次
              </Button>
            </div>
          ) : (
            cards.map((card) => {
              const isOriginal = card.version_id === 'original'
              const active = card.version_id === activeVersionId
              return (
                <div
                  key={card.version_id}
                  className={cn(
                    'space-y-3 rounded-xl border bg-card/92 p-4',
                    isOriginal
                      ? 'border-amber-300 bg-amber-50/60 dark:border-amber-700/60 dark:bg-amber-950/20'
                      : 'border-border/70',
                    active && 'ring-2 ring-emerald-500/25',
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge
                        className={cn(
                          isOriginal
                            ? 'border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200'
                            : 'border-violet-300 bg-violet-50 text-violet-900 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-200',
                        )}
                      >
                        {isOriginal ? '🏛️ 原始真题' : `🧬 AI 变体 · ${card.version_id}`}
                      </Badge>
                      {isOriginal ? (
                        <Badge variant="outline" className="text-[10px]">
                          真题保真
                        </Badge>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">
                          {card.created_at ? formatApiDateTime(card.created_at) : ''}
                        </span>
                      )}
                      {active ? (
                        <Badge variant="secondary" className="text-[10px]">
                          ✅ 当前使用中
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {active ? (
                        <Button type="button" size="sm" variant="secondary" disabled>
                          ✅ 当前使用中
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          loading={savingId === card.version_id}
                          loadingText="切换中"
                          onClick={() => void handleActivate(card.version_id)}
                        >
                          设为当前显示
                        </Button>
                      )}
                      {!isOriginal ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="text-destructive hover:text-destructive"
                          loading={savingId === card.version_id}
                          loadingText="删除中"
                          onClick={() => void handleDelete(card.version_id)}
                        >
                          🗑️ 删除此变体
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <QuestionVariantSummary variant={card} />
                </div>
              )
            })
          )}
        </div>
        <SheetFooter className="border-t border-border/70 px-5 py-3">
          <div className="flex w-full items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              当前显示：
              <span className="font-medium text-foreground">
                {activeVersionId === 'original' ? '原真题' : `AI 变体 · ${activeVersionId}`}
              </span>
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
