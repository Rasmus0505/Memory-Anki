import { useEffect, useMemo, useState } from 'react'
import { LoaderCircle, Search } from 'lucide-react'
import { toast } from '@/shared/feedback/toast'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import {
  getSubjectsApi,
  getSubjectTreeApi,
  type ChapterSummary,
  type SubjectSummary,
} from '@/modules/content/domain/knowledge-entity/api'
import { cn } from '@/shared/lib/utils'

export interface ChapterTarget {
  subjectId: number
  subjectName: string
  /** Null moves the palace to that subject's 「未分类」 bucket. */
  chapterId: number | null
  chapterName: string
  /** 学科 / 章节 / 子章节 — what the search box matches against. */
  path: string
}

function flattenChapters(
  subject: SubjectSummary,
  chapters: ChapterSummary[],
  parentPath: string[] = [],
): ChapterTarget[] {
  return chapters.flatMap((chapter) => {
    const path = [...parentPath, chapter.name]
    return [
      {
        subjectId: subject.id,
        subjectName: subject.name,
        chapterId: chapter.id,
        chapterName: chapter.name,
        path: [subject.name, ...path].join(' / '),
      },
      ...flattenChapters(subject, chapter.children ?? [], path),
    ]
  })
}

async function loadTargets(): Promise<ChapterTarget[]> {
  const subjects = await getSubjectsApi()
  const trees = await Promise.all(subjects.map((subject) => (
    getSubjectTreeApi(subject.id)
      .then((tree) => flattenChapters(subject, tree.chapters ?? []))
      .catch(() => [] as ChapterTarget[])
  )))
  const ungrouped = subjects.flatMap((subject): ChapterTarget[] => [{
    subjectId: subject.id,
    subjectName: subject.name,
    chapterId: null,
    chapterName: '未分类',
    path: `${subject.name} / 未分类`,
  }])
  return [...trees.flat(), ...ungrouped].sort((a, b) => a.path.localeCompare(b.path, 'zh-Hans-CN'))
}

export interface MovePalaceDialogProps {
  open: boolean
  palaceTitle: string
  /** Chapter the palace sits in now; that row is marked and not selectable. */
  currentChapterId?: number | null
  onOpenChange: (open: boolean) => void
  onPick: (target: ChapterTarget) => Promise<void> | void
}

/**
 * 「移动到…」: one searchable list of every chapter in every subject.
 *
 * The tree's drag-and-drop can only drop on a folder you can see; a palace
 * filed three subjects away is unreachable that way, which is why the menu
 * verb opens this picker instead of a nested submenu of the current tree.
 */
export function MovePalaceDialog({
  open,
  palaceTitle,
  currentChapterId = null,
  onOpenChange,
  onPick,
}: MovePalaceDialogProps) {
  const [targets, setTargets] = useState<ChapterTarget[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [pendingPath, setPendingPath] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    loadTargets()
      .then((items) => { if (!cancelled) setTargets(items) })
      .catch((reason) => {
        if (cancelled) return
        setError(reason instanceof Error ? reason.message : '章节加载失败，请稍后重试。')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open])

  useEffect(() => {
    if (open) return
    setKeyword('')
    setPendingPath(null)
  }, [open])

  const filtered = useMemo(() => {
    const needle = keyword.trim().toLocaleLowerCase()
    if (!needle) return targets
    return targets.filter((target) => target.path.toLocaleLowerCase().includes(needle))
  }, [keyword, targets])

  const pick = async (target: ChapterTarget) => {
    if (pendingPath) return
    setPendingPath(target.path)
    try {
      await onPick(target)
      onOpenChange(false)
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : '移动失败，请稍后重试。')
    } finally {
      setPendingPath(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" floatingId="move-palace-dialog">
        <DialogHeader>
          <DialogTitle>移动「{palaceTitle}」</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex min-h-0 flex-col gap-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索学科或章节"
              aria-label="搜索学科或章节"
              className="pl-8"
              autoFocus
            />
          </div>
          <div className="min-h-0 max-h-[min(55vh,26rem)] overflow-y-auto rounded-lg border">
            {loading ? (
              <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
                正在加载章节…
              </div>
            ) : error ? (
              <p className="px-3 py-4 text-sm text-destructive">{error}</p>
            ) : filtered.length === 0 ? (
              <p className="px-3 py-4 text-sm text-muted-foreground">
                {keyword.trim() ? '没有匹配的章节。' : '还没有可用的学科章节，先去知识库建立章节。'}
              </p>
            ) : (
              filtered.map((target, index) => {
                const isCurrent = target.chapterId != null && target.chapterId === currentChapterId
                const showSubject = index === 0 || filtered[index - 1].subjectId !== target.subjectId
                return (
                  <div key={`${target.subjectId}:${target.chapterId ?? 'ungrouped'}`}>
                    {showSubject ? (
                      <div className="sticky top-0 z-[1] bg-muted/60 px-3 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur">
                        {target.subjectName}
                      </div>
                    ) : null}
                    <button
                      type="button"
                      disabled={isCurrent || pendingPath != null}
                      onClick={() => void pick(target)}
                      className={cn(
                        'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                        isCurrent
                          ? 'cursor-default bg-primary/5 text-muted-foreground'
                          : 'hover:bg-accent',
                        pendingPath === target.path && 'opacity-60',
                      )}
                    >
                      <span className="truncate">{target.chapterName}</span>
                      {target.chapterId == null ? (
                        <span className="ml-auto shrink-0 text-xs text-muted-foreground">不归章节</span>
                      ) : null}
                      {isCurrent ? (
                        <span className="ml-auto shrink-0 text-xs text-muted-foreground">当前</span>
                      ) : null}
                      {pendingPath === target.path ? (
                        <LoaderCircle className="ml-auto size-3.5 shrink-0 animate-spin" aria-hidden />
                      ) : null}
                    </button>
                  </div>
                )
              })
            )}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
