import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Eye,
  EyeOff,
  LoaderCircle,
  MessagesSquare,
  Plus,
  RefreshCcw,
  Trash2,
} from 'lucide-react'
import {
  createEnglishPatternApi,
  deleteEnglishPatternApi,
  getEnglishPatternApi,
  listEnglishPatternDueSentencesApi,
  listEnglishPatternsApi,
  reviewEnglishPatternSentenceApi,
  updateEnglishPatternApi,
  upsertEnglishPatternPromptApi,
  upsertEnglishPatternSentenceApi,
} from '@/modules/english/domain/english-entity/api'
import type {
  EnglishPatternDetail,
  EnglishPatternReviewResult,
  EnglishPatternSentence,
  EnglishPatternSummary,
} from '@/shared/api/contracts'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { EmptyState } from '@/shared/components/state-placeholders'
import { toast } from '@/shared/feedback/toast'
import { cn } from '@/shared/lib/utils'

const REVIEW_ACTIONS: Array<{
  result: EnglishPatternReviewResult
  label: string
  variant: 'outline' | 'default' | 'secondary'
}> = [
  { result: 'forgot', label: '忘记', variant: 'outline' },
  { result: 'hard', label: '困难', variant: 'outline' },
  { result: 'good', label: '记得', variant: 'secondary' },
  { result: 'easy', label: '轻松', variant: 'default' },
]

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  learning: '学习中',
  speakable: '可开口',
  mature: '成熟',
  archived: '归档',
}

type PanelMode = 'list' | 'edit' | 'review'

export function EnglishPatternsPanel({ compact = false }: { compact?: boolean }) {
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<PanelMode>('list')
  const [items, setItems] = useState<EnglishPatternSummary[]>([])
  const [dueSentenceCount, setDueSentenceCount] = useState(0)
  const [total, setTotal] = useState(0)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [detail, setDetail] = useState<EnglishPatternDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dueQueue, setDueQueue] = useState<EnglishPatternSentence[]>([])
  const [reviewIndex, setReviewIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [reviewingId, setReviewingId] = useState<number | null>(null)
  const [draftInputs, setDraftInputs] = useState<Record<string, string>>({})

  const loadList = useCallback(async () => {
    setLoading(true)
    try {
      const response = await listEnglishPatternsApi({ limit: 100 })
      setItems(response.items)
      setDueSentenceCount(response.dueSentenceCount)
      setTotal(response.total)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载句模失败。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadList()
  }, [loadList])

  const openDetail = useCallback(async (patternId: number) => {
    setDetailLoading(true)
    setMode('edit')
    try {
      const next = await getEnglishPatternApi(patternId)
      setDetail(next)
      const drafts: Record<string, string> = {
        title: next.title,
        notes: next.notes,
      }
      for (const prompt of next.prompts) {
        drafts[`prompt-en-${prompt.id}`] = prompt.textEn
        drafts[`prompt-zh-${prompt.id}`] = prompt.textZh
        for (const sentence of prompt.sentences) {
          drafts[`sent-en-${sentence.id}`] = sentence.textEn
          drafts[`sent-zh-${sentence.id}`] = sentence.textZh
        }
      }
      setDraftInputs(drafts)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载句模详情失败。')
      setMode('list')
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const handleCreate = useCallback(async () => {
    const title = newTitle.trim()
    if (!title) {
      toast.error('请填写话题标题。')
      return
    }
    setCreating(true)
    try {
      const created = await createEnglishPatternApi({
        title,
        seedTemplate: true,
      })
      setNewTitle('')
      toast.success('已创建 6×2 句模模板。')
      await loadList()
      await openDetail(created.id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建句模失败。')
    } finally {
      setCreating(false)
    }
  }, [loadList, newTitle, openDetail])

  const handleDelete = useCallback(
    async (patternId: number) => {
      if (!window.confirm('确定删除这个句模？观点长句与复习进度会一并删除。')) return
      try {
        await deleteEnglishPatternApi(patternId)
        toast.success('句模已删除。')
        if (detail?.id === patternId) {
          setDetail(null)
          setMode('list')
        }
        await loadList()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '删除失败。')
      }
    },
    [detail?.id, loadList],
  )

  const saveMeta = useCallback(async () => {
    if (!detail) return
    setSaving(true)
    try {
      const next = await updateEnglishPatternApi(detail.id, {
        title: draftInputs.title ?? detail.title,
        notes: draftInputs.notes ?? detail.notes,
      })
      setDetail(next)
      toast.success('句模信息已保存。')
      await loadList()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败。')
    } finally {
      setSaving(false)
    }
  }, [detail, draftInputs.notes, draftInputs.title, loadList])

  const savePrompt = useCallback(
    async (promptId: number) => {
      if (!detail) return
      setSaving(true)
      try {
        const next = await upsertEnglishPatternPromptApi(detail.id, {
          promptId,
          textEn: draftInputs[`prompt-en-${promptId}`] ?? '',
          textZh: draftInputs[`prompt-zh-${promptId}`] ?? '',
        })
        setDetail(next)
        toast.success('问题已保存。')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '保存问题失败。')
      } finally {
        setSaving(false)
      }
    },
    [detail, draftInputs],
  )

  const saveSentence = useCallback(
    async (promptId: number, sentenceId: number) => {
      setSaving(true)
      try {
        await upsertEnglishPatternSentenceApi(promptId, {
          sentenceId,
          textEn: draftInputs[`sent-en-${sentenceId}`] ?? '',
          textZh: draftInputs[`sent-zh-${sentenceId}`] ?? '',
          source: 'manual',
        })
        if (detail) {
          const next = await getEnglishPatternApi(detail.id)
          setDetail(next)
        }
        toast.success('观点长句已保存。')
        await loadList()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '保存长句失败。')
      } finally {
        setSaving(false)
      }
    },
    [detail, draftInputs, loadList],
  )

  const startReview = useCallback(
    async (patternId?: number) => {
      try {
        const response = await listEnglishPatternDueSentencesApi({
          patternId,
          limit: 50,
        })
        if (response.items.length === 0) {
          toast.message(patternId ? '该句模暂无到期句子。' : '暂无到期句模句子。')
          return
        }
        setDueQueue(response.items)
        setReviewIndex(0)
        setRevealed(false)
        setMode('review')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '加载复习队列失败。')
      }
    },
    [],
  )

  const currentReview = dueQueue[reviewIndex] ?? null

  const handleReview = useCallback(
    async (result: EnglishPatternReviewResult) => {
      if (!currentReview) return
      setReviewingId(currentReview.id)
      try {
        await reviewEnglishPatternSentenceApi(currentReview.id, result)
        const nextIndex = reviewIndex + 1
        if (nextIndex >= dueQueue.length) {
          toast.success('本轮句模复习完成。')
          setMode('list')
          setDueQueue([])
          setReviewIndex(0)
          await loadList()
        } else {
          setReviewIndex(nextIndex)
          setRevealed(false)
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '复习失败。')
      } finally {
        setReviewingId(null)
      }
    },
    [currentReview, dueQueue.length, loadList, reviewIndex],
  )

  const setDraft = (key: string, value: string) => {
    setDraftInputs((prev) => ({ ...prev, [key]: value }))
  }

  const filledProgress = useMemo(() => {
    if (!detail) return ''
    return `${detail.sentenceCount}/${detail.targetSentenceCount}`
  }, [detail])

  if (mode === 'review' && currentReview) {
    return (
      <div className={cn('space-y-4', compact && 'space-y-3')} data-testid="english-patterns-review">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-base font-semibold">句模召回</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {reviewIndex + 1} / {dueQueue.length} · {currentReview.patternTitle || '话题'}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="rounded-xl"
            onClick={() => {
              setMode('list')
              setDueQueue([])
            }}
          >
            <ArrowLeft className="size-4" />
            退出
          </Button>
        </div>

        <article className="rounded-3xl border border-border/70 bg-card/95 p-5 shadow-card sm:p-6">
          <div className="text-xs font-medium uppercase tracking-[0.14em] text-info">提示</div>
          <p className="mt-3 text-lg font-semibold leading-8">
            {currentReview.textZh ||
              currentReview.promptTextZh ||
              currentReview.promptTextEn ||
              '请回忆这句观点长句'}
          </p>
          {currentReview.promptTextEn || currentReview.promptTextZh ? (
            <p className="mt-2 text-sm text-muted-foreground">
              问题：{currentReview.promptTextZh || currentReview.promptTextEn}
            </p>
          ) : null}

          <div className="mt-5 rounded-2xl border border-dashed border-border/80 bg-background/70 px-4 py-4">
            {revealed ? (
              <div className="space-y-2">
                <p className="text-base leading-7 text-foreground">{currentReview.textEn}</p>
                {currentReview.textZh ? (
                  <p className="text-sm text-muted-foreground">{currentReview.textZh}</p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">先在心里复述或默写，再点「揭晓对照」。</p>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="rounded-xl"
              onClick={() => setRevealed((value) => !value)}
            >
              {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              {revealed ? '隐藏' : '揭晓对照'}
            </Button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {REVIEW_ACTIONS.map((action) => (
              <Button
                key={action.result}
                size="sm"
                variant={action.variant}
                className="min-h-10 rounded-xl px-3"
                disabled={reviewingId === currentReview.id}
                onClick={() => void handleReview(action.result)}
              >
                {reviewingId === currentReview.id ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : null}
                {action.label}
              </Button>
            ))}
          </div>
        </article>
      </div>
    )
  }

  if (mode === 'edit') {
    return (
      <div className={cn('space-y-4', compact && 'space-y-3')} data-testid="english-patterns-edit">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="rounded-xl"
              onClick={() => {
                setMode('list')
                setDetail(null)
                void loadList()
              }}
            >
              <ArrowLeft className="size-4" />
              返回
            </Button>
            <div>
              <div className="text-base font-semibold">编辑句模</div>
              <div className="mt-1 text-xs text-muted-foreground">
                进度 {filledProgress || '—'} · 到期 {detail?.dueCount ?? 0}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="rounded-xl"
              disabled={!detail}
              onClick={() => void startReview(detail?.id)}
            >
              复习本模
            </Button>
            <Button
              size="sm"
              className="rounded-xl"
              disabled={saving || !detail}
              onClick={() => void saveMeta()}
            >
              {saving ? <LoaderCircle className="size-4 animate-spin" /> : null}
              保存信息
            </Button>
          </div>
        </div>

        {detailLoading || !detail ? (
          <div className="flex min-h-[24vh] items-center justify-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            加载句模…
          </div>
        ) : (
          <div className="space-y-4">
            <section className="rounded-2xl border border-border/70 bg-card/95 p-4 shadow-soft">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5 text-sm">
                  <span className="text-muted-foreground">话题标题</span>
                  <Input
                    value={draftInputs.title ?? ''}
                    onChange={(event) => setDraft('title', event.target.value)}
                    className="rounded-xl"
                  />
                </label>
                <label className="space-y-1.5 text-sm">
                  <span className="text-muted-foreground">备注</span>
                  <Input
                    value={draftInputs.notes ?? ''}
                    onChange={(event) => setDraft('notes', event.target.value)}
                    className="rounded-xl"
                    placeholder="可选"
                  />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="secondary">{STATUS_LABEL[detail.status] || detail.status}</Badge>
                <Badge variant="outline">
                  {detail.sentenceCount}/{detail.targetSentenceCount} 句
                </Badge>
                {detail.dueCount > 0 ? <Badge>到期 {detail.dueCount}</Badge> : null}
              </div>
            </section>

            {detail.prompts.map((prompt, promptOffset) => (
              <section
                key={prompt.id}
                className="rounded-2xl border border-border/70 bg-card/95 p-4 shadow-soft"
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">问题 {promptOffset + 1}</h3>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-xl"
                    disabled={saving}
                    onClick={() => void savePrompt(prompt.id)}
                  >
                    保存问题
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1.5 text-sm">
                    <span className="text-muted-foreground">问题（中）</span>
                    <Input
                      value={draftInputs[`prompt-zh-${prompt.id}`] ?? ''}
                      onChange={(event) => setDraft(`prompt-zh-${prompt.id}`, event.target.value)}
                      className="rounded-xl"
                      placeholder="例如：你喜欢吃鱼吗？"
                    />
                  </label>
                  <label className="space-y-1.5 text-sm">
                    <span className="text-muted-foreground">问题（英）</span>
                    <Input
                      value={draftInputs[`prompt-en-${prompt.id}`] ?? ''}
                      onChange={(event) => setDraft(`prompt-en-${prompt.id}`, event.target.value)}
                      className="rounded-xl"
                      placeholder="Do you like fish?"
                    />
                  </label>
                </div>

                <div className="mt-4 space-y-3">
                  {prompt.sentences.map((sentence, sentenceOffset) => (
                    <div
                      key={sentence.id}
                      className="rounded-xl border border-border/60 bg-background/70 p-3"
                    >
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs font-medium text-muted-foreground">
                          观点 {sentenceOffset + 1}
                          {sentence.isDue && sentence.textEn ? (
                            <Badge variant="secondary" className="ml-2">
                              到期
                            </Badge>
                          ) : null}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-xl"
                          disabled={saving}
                          onClick={() => void saveSentence(prompt.id, sentence.id)}
                        >
                          保存长句
                        </Button>
                      </div>
                      <label className="block space-y-1.5 text-sm">
                        <span className="text-muted-foreground">英文长句（完整观点）</span>
                        <textarea
                          value={draftInputs[`sent-en-${sentence.id}`] ?? ''}
                          onChange={(event) =>
                            setDraft(`sent-en-${sentence.id}`, event.target.value)
                          }
                          className="min-h-20 w-full rounded-xl border border-input bg-transparent px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                          placeholder="I love baked fish with tomato sauce, but if I have a choice..."
                        />
                      </label>
                      <label className="mt-2 block space-y-1.5 text-sm">
                        <span className="text-muted-foreground">中文意图 / 翻译</span>
                        <Input
                          value={draftInputs[`sent-zh-${sentence.id}`] ?? ''}
                          onChange={(event) =>
                            setDraft(`sent-zh-${sentence.id}`, event.target.value)
                          }
                          className="rounded-xl"
                          placeholder="回忆时用作提示"
                        />
                      </label>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={cn('space-y-4', compact && 'space-y-3')} data-testid="english-patterns-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-base font-semibold">句模</div>
          <div className="mt-1 text-xs text-muted-foreground">
            话题 {total} · 到期长句 {dueSentenceCount}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            className="rounded-xl"
            onClick={() => void startReview()}
            disabled={dueSentenceCount <= 0}
          >
            开始复习
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="size-9 rounded-xl"
            onClick={() => void loadList()}
            aria-label="刷新句模"
          >
            <RefreshCcw className="size-4" />
          </Button>
        </div>
      </div>

      <section className="rounded-2xl border border-border/70 bg-card/95 p-4 shadow-soft">
        <div className="text-sm font-medium">新建话题句模</div>
        <p className="mt-1 text-xs text-muted-foreground">
          默认生成 6 个问题 × 每题 2 个观点长句的空壳，按记忆曲线反复背诵。
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
            placeholder="例如：Food / Travel / Work"
            className="rounded-xl"
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleCreate()
            }}
          />
          <Button
            className="rounded-xl sm:shrink-0"
            disabled={creating}
            onClick={() => void handleCreate()}
          >
            {creating ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
            创建 6×2
          </Button>
        </div>
      </section>

      {loading ? (
        <div className="flex min-h-[20vh] items-center justify-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          正在加载句模…
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          variant="list"
          title="还没有句模"
          description="先建一个高频话题，填入带细节的长句观点，再用 FSRS 反复召回。"
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <article
              key={item.id}
              className="rounded-2xl border border-border/70 bg-card/95 p-4 shadow-soft"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold tracking-tight">{item.title}</h3>
                    <Badge variant="outline">{STATUS_LABEL[item.status] || item.status}</Badge>
                    {item.dueCount > 0 ? <Badge variant="secondary">到期 {item.dueCount}</Badge> : null}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span>
                      进度 {item.sentenceCount}/{item.targetSentenceCount}
                    </span>
                    <span>{item.promptCount} 个问题</span>
                    {item.tags.length > 0 ? <span>{item.tags.join(' · ')}</span> : null}
                  </div>
                </div>
                <MessagesSquare className="size-4 shrink-0 text-info" />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  className="rounded-xl"
                  onClick={() => void openDetail(item.id)}
                >
                  编辑 / 填句
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl"
                  disabled={item.dueCount <= 0}
                  onClick={() => void startReview(item.id)}
                >
                  复习
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl text-destructive"
                  onClick={() => void handleDelete(item.id)}
                >
                  <Trash2 className="size-3.5" />
                  删除
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
