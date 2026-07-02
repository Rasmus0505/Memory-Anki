import { ChapterRangeTree } from '@/features/palace-quiz/components/palaceQuizCards'
import type { SubjectTreePayload } from '@/features/palace-quiz/model/palaceQuizPage'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'

export function PalaceQuizRangeDialog({
  open,
  onOpenChange,
  pendingChapterId,
  pendingChapterSummary,
  chapterTreesLoading,
  chapterTrees,
  allowedChapterIds,
  onSelect,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pendingChapterId: number | null
  pendingChapterSummary: string
  chapterTreesLoading: boolean
  chapterTrees: SubjectTreePayload[]
  allowedChapterIds: Set<number>
  onSelect: (chapterId: number) => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>选择范围</DialogTitle>
          <DialogDescription>
            选择本次 AI 生成题目所属的章节范围。一次只能选择一个章节节点，也支持直接选择父级大章节整章生成。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-6 py-4">
          <div className="rounded-lg border border-border/70 bg-background/70 px-4 py-3 text-sm text-muted-foreground">
            当前选择：{pendingChapterId ? pendingChapterSummary : '尚未选择题目所属章节'}
          </div>
          {chapterTreesLoading ? (
            <div className="text-sm text-muted-foreground">正在加载章节树...</div>
          ) : chapterTrees.length === 0 ? (
            <div className="text-sm text-muted-foreground">当前宫殿还没有可用的章节范围。</div>
          ) : (
            <div className="max-h-[440px] space-y-4 overflow-y-auto">
              {chapterTrees.map((tree) => (
                <div key={tree.subject?.id ?? 'subject'} className="space-y-2">
                  <div className="text-sm font-medium">{tree.subject?.name || '未命名学科'}</div>
                  <div className="space-y-1">
                    {(tree.chapters || []).map((node) => (
                      <ChapterRangeTree
                        key={node.id}
                        node={node}
                        allowedChapterIds={allowedChapterIds}
                        selectedChapterId={pendingChapterId}
                        onSelect={onSelect}
                        depth={0}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" onClick={onConfirm}>
            确认范围
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
