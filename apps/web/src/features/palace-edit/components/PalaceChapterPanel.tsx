import { Link2 } from 'lucide-react'
import type { ChapterOption } from '@/features/palace-edit/hooks/usePalaceEditPage'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'

interface PalaceChapterPanelProps {
  chapterOptions: ChapterOption[]
  selectedChapterIds: number[]
  onToggleChapter: (chapterId: number) => void | Promise<void>
}

export function PalaceChapterPanel({
  chapterOptions,
  selectedChapterIds,
  onToggleChapter,
}: PalaceChapterPanelProps) {
  return (
    <Card className="border-border/70 bg-card/92">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="h-4 w-4" />
          章节关联
        </CardTitle>
      </CardHeader>
      <CardContent className="max-h-[280px] space-y-2 overflow-y-auto">
        {chapterOptions.map((option) => (
          <label
            key={option.id}
            className="flex items-start gap-3 rounded-2xl border border-border/70 bg-background/70 px-3 py-3 text-sm"
          >
            <input
              type="checkbox"
              checked={selectedChapterIds.includes(option.id)}
              onChange={() => void onToggleChapter(option.id)}
              className="mt-1"
            />
            <span>{option.label}</span>
          </label>
        ))}
      </CardContent>
    </Card>
  )
}
