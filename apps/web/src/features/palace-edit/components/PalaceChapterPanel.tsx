import { Link2, Sparkles } from 'lucide-react'
import type { ChapterOption } from '@/features/palace-edit/hooks/usePalaceEditPage'
import { Badge } from '@/shared/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { cn } from '@/shared/lib/utils'

interface PalaceChapterPanelProps {
  chapterOptions: ChapterOption[]
  explicitChapterIds: number[]
  inheritedChapterIds: number[]
  primaryChapterId: number | null
  onToggleChapter: (chapterId: number) => void | Promise<void>
}

export function PalaceChapterPanel({
  chapterOptions,
  explicitChapterIds,
  inheritedChapterIds,
  primaryChapterId,
  onToggleChapter,
}: PalaceChapterPanelProps) {
  const renderNode = (option: ChapterOption) => {
    const isExplicit = explicitChapterIds.includes(option.id)
    const isInherited = inheritedChapterIds.includes(option.id)
    const isPrimary = primaryChapterId === option.id

    return (
      <div key={option.id} className="space-y-2">
        <label
          className={cn(
            'flex items-start gap-3 rounded-2xl border px-3 py-3 text-sm transition-colors',
            isPrimary
              ? 'border-amber-300 bg-amber-50/80'
              : isExplicit
                ? 'border-primary/35 bg-primary/5'
                : 'border-border/70 bg-background/70',
          )}
          style={{ marginLeft: `${option.depth * 18}px` }}
        >
          <input
            type="checkbox"
            checked={isExplicit}
            onChange={() => void onToggleChapter(option.id)}
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
    <Card className="border-border/70 bg-card/92">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="h-4 w-4" />
          章节关联
        </CardTitle>
      </CardHeader>
      <CardContent className="max-h-[280px] space-y-2 overflow-y-auto">
        {chapterOptions.map(renderNode)}
      </CardContent>
    </Card>
  )
}
