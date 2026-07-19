import { useCallback, useEffect, useState } from 'react'
import { BookMarked, LoaderCircle, RefreshCcw } from 'lucide-react'
import {
  createEnglishReadingVocabularyNoteApi,
  listEnglishReadingVocabularyNotesApi,
  reviewEnglishReadingVocabularyNoteApi,
} from '@/features/english-reading/api'
import type {
  ReadingVocabularyNote,
  ReadingVocabularyReviewResult,
} from '@/shared/api/contracts'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { EmptyState } from '@/shared/components/state-placeholders'
import { toast } from '@/shared/feedback/toast'
import { cn } from '@/shared/lib/utils'

const REVIEW_ACTIONS: Array<{
  result: ReadingVocabularyReviewResult
  label: string
  variant: 'outline' | 'default' | 'secondary'
}> = [
  { result: 'forgot', label: '忘记', variant: 'outline' },
  { result: 'hard', label: '困难', variant: 'outline' },
  { result: 'good', label: '认识', variant: 'secondary' },
  { result: 'easy', label: '简单', variant: 'default' },
]

export function EnglishVocabularyPanel({ compact = false }: { compact?: boolean }) {
  const [loading, setLoading] = useState(true)
  const [dueOnly, setDueOnly] = useState(true)
  const [notes, setNotes] = useState<ReadingVocabularyNote[]>([])
  const [dueCount, setDueCount] = useState(0)
  const [total, setTotal] = useState(0)
  const [reviewingId, setReviewingId] = useState<number | null>(null)

  const loadNotes = useCallback(async () => {
    setLoading(true)
    try {
      const response = await listEnglishReadingVocabularyNotesApi({
        dueOnly,
        limit: 50,
      })
      setNotes(response.items)
      setDueCount(response.dueCount)
      setTotal(response.total)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载生词本失败。')
    } finally {
      setLoading(false)
    }
  }, [dueOnly])

  useEffect(() => {
    void loadNotes()
  }, [loadNotes])

  const handleReview = useCallback(
    async (noteId: number, result: ReadingVocabularyReviewResult) => {
      setReviewingId(noteId)
      try {
        await reviewEnglishReadingVocabularyNoteApi(noteId, result)
        toast.success('复习结果已保存。')
        await loadNotes()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '复习失败。')
      } finally {
        setReviewingId(null)
      }
    },
    [loadNotes],
  )

  return (
    <div className={cn('space-y-4', compact && 'space-y-3')} data-testid="english-vocab-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-base font-semibold">生词本</div>
          <div className="mt-1 text-xs text-muted-foreground">
            待复习 {dueCount} · 全部 {total}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={dueOnly ? 'default' : 'outline'}
            className="rounded-xl"
            onClick={() => setDueOnly(true)}
          >
            待复习
          </Button>
          <Button
            size="sm"
            variant={!dueOnly ? 'default' : 'outline'}
            className="rounded-xl"
            onClick={() => setDueOnly(false)}
          >
            全部
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="size-9 rounded-xl"
            onClick={() => void loadNotes()}
            aria-label="刷新生词本"
          >
            <RefreshCcw className="size-4" />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-[20vh] items-center justify-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          正在加载生词…
        </div>
      ) : notes.length === 0 ? (
        <EmptyState
          variant="list"
          title={dueOnly ? '暂时没有到期生词' : '生词本还是空的'}
          description="阅读时点开词典，点「加入生词本」即可收藏。"
        />
      ) : (
        <div className="space-y-3">
          {notes.map((note) => (
            <article
              key={note.id}
              className="rounded-2xl border border-border/70 bg-card/95 p-4 shadow-soft"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold tracking-tight">{note.word}</h3>
                    {note.cefr ? <Badge variant="outline">{note.cefr}</Badge> : null}
                    {note.isDue ? <Badge variant="secondary">到期</Badge> : null}
                    {note.status === 'mastered' ? <Badge variant="outline">已掌握</Badge> : null}
                  </div>
                  {note.lemma && note.lemma !== note.word ? (
                    <div className="mt-1 text-xs text-muted-foreground">原形 {note.lemma}</div>
                  ) : null}
                  {note.definitionZh ? (
                    <p className="mt-2 text-sm leading-6 text-foreground/90">{note.definitionZh}</p>
                  ) : null}
                  {note.context ? (
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
                      {note.context}
                    </p>
                  ) : null}
                </div>
                <BookMarked className="size-4 shrink-0 text-info" />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {REVIEW_ACTIONS.map((action) => (
                  <Button
                    key={action.result}
                    size="sm"
                    variant={action.variant}
                    className="min-h-10 rounded-xl px-3"
                    disabled={reviewingId === note.id}
                    onClick={() => void handleReview(note.id, action.result)}
                  >
                    {reviewingId === note.id ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : null}
                    {action.label}
                  </Button>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

export async function saveWordToVocabularyNotebook(input: {
  word: string
  definitionZh?: string
  context?: string
  materialId?: number | null
  versionId?: number | null
  cefr?: ReadingVocabularyNote['cefr']
}) {
  return createEnglishReadingVocabularyNoteApi({
    word: input.word,
    definitionZh: input.definitionZh,
    context: input.context,
    materialId: input.materialId,
    versionId: input.versionId,
    cefr: input.cefr,
  })
}
