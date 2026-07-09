import { useMemo, useState } from 'react'
import { FolderTree, Link2, Sparkles } from 'lucide-react'
import type { ChapterOption } from '@/features/palace-edit/hooks/usePalaceEditPage'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { flattenChapterOptions } from '@/features/palace-edit/model/chapter-options'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { cn } from '@/shared/lib/utils'

interface PalaceChapterPanelProps {
  chapterOptions: ChapterOption[]
  explicitChapterIds: number[]
  inheritedChapterIds: number[]
  primaryChapterId: number | null
  selectionPending?: boolean
  onToggleChapter: (chapterId: number) => void | Promise<void>
}

interface SubjectChapterGroup {
  key: string
  subjectId: number | null
  subjectName: string
  options: ChapterOption[]
  explicitCount: number
}

function countExplicitDescendants(option: ChapterOption, explicitIds: Set<number>): number {
  return flattenChapterOptions([option]).filter((item) => explicitIds.has(item.id)).length
}

function hasAllExplicitChildChapters(option: ChapterOption, explicitIds: Set<number>): boolean {
  const childChapters = flattenChapterOptions(option.children)
  return childChapters.length > 0 && childChapters.every((item) => explicitIds.has(item.id))
}

export function PalaceChapterPanel({
  chapterOptions,
  explicitChapterIds,
  inheritedChapterIds,
  primaryChapterId,
  selectionPending = false,
  onToggleChapter,
}: PalaceChapterPanelProps) {
  const [dialogOpen, setDialogOpen] = useState(false)

  const explicitIdSet = useMemo(() => new Set(explicitChapterIds), [explicitChapterIds])
  const inheritedIdSet = useMemo(() => new Set(inheritedChapterIds), [inheritedChapterIds])
  const flatOptions = useMemo(() => flattenChapterOptions(chapterOptions), [chapterOptions])
  const explicitChapters = useMemo(
    () => flatOptions.filter((option) => explicitIdSet.has(option.id)),
    [explicitIdSet, flatOptions],
  )
  const primaryChapter = useMemo(
    () => flatOptions.find((option) => option.id === primaryChapterId) ?? null,
    [flatOptions, primaryChapterId],
  )
  const subjectGroups = useMemo<SubjectChapterGroup[]>(() => {
    const groups = new Map<string, SubjectChapterGroup>()
    for (const option of chapterOptions) {
      const key = `${option.subjectId ?? 'none'}:${option.subjectName}`
      const existing = groups.get(key)
      if (existing) {
        existing.options.push(option)
        existing.explicitCount += countExplicitDescendants(option, explicitIdSet)
        continue
      }
      groups.set(key, {
        key,
        subjectId: option.subjectId,
        subjectName: option.subjectName,
        options: [option],
        explicitCount: countExplicitDescendants(option, explicitIdSet),
      })
    }
    return Array.from(groups.values())
  }, [chapterOptions, explicitIdSet])
  const subjectSummaries = useMemo(
    () =>
      subjectGroups
        .filter((group) => group.explicitCount > 0)
        .map((group) => `${group.subjectName} ${group.explicitCount}`),
    [subjectGroups],
  )
  const visibleExplicitChapters = explicitChapters.slice(0, 4)
  const hiddenExplicitCount = Math.max(0, explicitChapters.length - visibleExplicitChapters.length)

  const renderNode = (option: ChapterOption) => {
    const isExplicit = explicitIdSet.has(option.id)
    const isInherited = inheritedIdSet.has(option.id)
    const isPrimary = primaryChapterId === option.id
    const hasCompletedChildren = hasAllExplicitChildChapters(option, explicitIdSet)

    return (
      <div key={option.id} className="space-y-2">
        <label
          className={cn(
            'flex items-start gap-3 rounded-lg border px-3 py-3 text-sm transition-colors',
            hasCompletedChildren
              ? 'border-success bg-success/10 text-success shadow-sm'
              : isExplicit
                ? 'border-success/30 bg-success/5 text-success'
                : 'border-border/70 bg-background/70',
            isPrimary && 'ring-1 ring-warning/30',
            selectionPending && 'opacity-75',
          )}
          style={{ marginLeft: `${option.depth * 18}px` }}
        >
          <input
            type="checkbox"
            checked={isExplicit}
            disabled={selectionPending}
            onChange={() => {
              if (isExplicit) {
                const confirmed = window.confirm(
                  `取消关联「${option.name}」后，该章节的复习队列和做题范围将不再包含本宫殿（题目本身不会被删除）。确定取消吗？`,
                )
                if (!confirmed) return
              }
              void onToggleChapter(option.id)
            }}
            className="mt-1"
          />
          <span className="min-w-0 flex-1 space-y-1">
            <span className={cn('block', option.depth === 0 ? 'font-semibold' : 'font-medium')}>
              {option.name}
            </span>
            <span className="flex flex-wrap gap-2">
              {option.depth === 0 ? <Badge variant="secondary">{option.subjectName}</Badge> : null}
              {isInherited ? <Badge variant="outline">继承关联</Badge> : null}
              {isPrimary ? (
                <Badge variant="secondary" className="gap-1">
                  <Sparkles className="h-3 w-3" />
                  命名来源
                </Badge>
              ) : null}
            </span>
          </span>
        </label>
        {option.children.length > 0 ? option.children.map(renderNode) : null}
      </div>
    )
  }

  return (
    <>
      <Card className="border-border/70 bg-card/92">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Link2 className="size-4" />
              章节关联
            </CardTitle>
            <div className="text-sm text-muted-foreground">
              在更大的章节视图里按学科选择关联，勾选后会立即保存。
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={selectionPending}
            onClick={() => setDialogOpen(true)}
          >
            <FolderTree className="size-4" />
            {selectionPending ? '保存中…' : '选择章节'}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border/70 bg-background/60 px-3 py-3">
              <div className="text-xs text-muted-foreground">已关联章节</div>
              <div className="mt-1 text-2xl font-semibold">{explicitChapters.length}</div>
            </div>
            <div className="rounded-lg border border-border/70 bg-background/60 px-3 py-3">
              <div className="text-xs text-muted-foreground">当前命名来源</div>
              <div className="mt-1 text-sm font-medium text-foreground">
                {primaryChapter?.name || '尚未选择'}
              </div>
            </div>
          </div>

          <div className="space-y-2 rounded-lg border border-border/70 bg-background/60 px-3 py-3">
            <div className="text-xs text-muted-foreground">涉及学科</div>
            <div className="flex flex-wrap gap-2">
              {subjectSummaries.length > 0 ? (
                subjectSummaries.map((summary) => (
                  <Badge key={summary} variant="secondary">
                    {summary}
                  </Badge>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">还没有关联任何章节。</span>
              )}
            </div>
          </div>

          <div className="space-y-2 rounded-lg border border-border/70 bg-background/60 px-3 py-3">
            <div className="text-xs text-muted-foreground">已选章节摘要</div>
            <div className="flex flex-wrap gap-2">
              {visibleExplicitChapters.length > 0 ? (
                <>
                  {visibleExplicitChapters.map((chapter) => (
                    <Badge key={chapter.id} variant="outline">
                      {chapter.name}
                    </Badge>
                  ))}
                  {hiddenExplicitCount > 0 ? (
                    <Badge variant="outline">还有 {hiddenExplicitCount} 个</Badge>
                  ) : null}
                </>
              ) : (
                <span className="text-sm text-muted-foreground">点击右上角按钮开始关联章节。</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[80vh] max-w-5xl overflow-hidden">
          <DialogHeader>
            <div className="space-y-2">
              <DialogTitle>选择章节关联</DialogTitle>
              <DialogDescription className="sr-only">
                按学科分组勾选宫殿关联章节，勾选后会立即保存。
              </DialogDescription>
              <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                <Badge variant="secondary">已选 {explicitChapters.length}</Badge>
                <Badge variant="outline">主章节：{primaryChapter?.name || '未指定'}</Badge>
                <span>勾选后会立即保存，最新勾选的章节会成为命名来源。</span>
              </div>
            </div>
            <DialogClose onClick={() => setDialogOpen(false)} />
          </DialogHeader>

          <div className="overflow-y-auto px-6 py-5">
            {subjectGroups.length > 0 ? (
              <div className="space-y-5">
                {subjectGroups.map((group) => (
                  <section
                    key={group.key}
                    className="space-y-3 rounded-lg border border-border/70 bg-background/40 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="text-sm font-semibold text-foreground">{group.subjectName}</div>
                        <div className="text-xs text-muted-foreground">
                          已关联 {group.explicitCount} 个章节
                        </div>
                      </div>
                      <Badge variant="secondary">{group.options.length} 个顶层章节</Badge>
                    </div>
                    <div className="space-y-2">
                      {group.options.map(renderNode)}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border/80 px-4 py-10 text-center text-sm text-muted-foreground">
                还没有可关联的章节，请先到知识大纲里创建或导入章节。
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
