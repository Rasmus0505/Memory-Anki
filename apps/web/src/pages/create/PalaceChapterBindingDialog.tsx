import { LoaderCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { ChapterSummary, SubjectSummary, SubjectTree } from '@/modules/content/public'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'

function ChapterBindingNode({
  node,
  depth,
  explicitIds,
  busy,
  onToggle,
}: {
  node: ChapterSummary
  depth: number
  explicitIds: number[]
  busy: boolean
  onToggle: (chapterId: number, nextLinked: boolean, chapterName: string) => void
}) {
  const linked = explicitIds.includes(node.id)
  return (
    <div className="space-y-1">
      <label
        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        <input
          type="checkbox"
          checked={linked}
          disabled={busy}
          onChange={() => onToggle(node.id, !linked, node.name)}
          aria-label={`关联章节 ${node.name}`}
        />
        <span className={linked ? 'font-medium text-foreground' : 'text-muted-foreground'}>{node.name}</span>
      </label>
      {(node.children ?? []).map((child) => (
        <ChapterBindingNode
          key={child.id}
          node={child}
          depth={depth + 1}
          explicitIds={explicitIds}
          busy={busy}
          onToggle={onToggle}
        />
      ))}
    </div>
  )
}

export function PalaceChapterBindingDialog({ subjects, explicitIds, bindingBusy, chapterTrees,
  chapterTreesLoading, toggleChapterBinding, chapterDialogOpen, setChapterDialogOpen }: {
  subjects: SubjectSummary[]
  explicitIds: number[]
  bindingBusy: boolean
  chapterTrees: SubjectTree[]
  chapterTreesLoading: boolean
  toggleChapterBinding: (id: number, linked: boolean, name?: string) => void
  chapterDialogOpen: boolean
  setChapterDialogOpen: (open: boolean) => void
}) {
  return (
    <Dialog open={chapterDialogOpen} onOpenChange={setChapterDialogOpen}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>绑定章节</DialogTitle>
          <DialogDescription>
            勾选要关联到本宫殿的章节。也可在学科导图中开启「关联章节」模式点选节点。主章节用于宫殿默认名称来源。
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">在树中勾选或取消章节</span>
          <Badge variant="secondary">已选 {explicitIds.length}</Badge>
        </div>
        {subjects.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/70 px-3 py-6 text-sm text-muted-foreground">
            请先关联至少一个学科，再选择章节。
          </div>
        ) : chapterTreesLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" />
            正在加载章节树…
          </div>
        ) : chapterTrees.every((tree) => (tree.chapters ?? []).length === 0) ? (
          <div className="space-y-3 rounded-lg border border-dashed border-border/70 px-3 py-6 text-sm text-muted-foreground">
            <p>当前关联学科还没有章节。请先编辑学科思维导图生成章节结构。</p>
            <Button asChild type="button" size="sm" variant="outline">
              <Link to={subjects[0] ? `/knowledge?subjectId=${subjects[0].id}` : '/knowledge'}>
                去编辑学科思维导图
              </Link>
            </Button>
          </div>
        ) : (
          <div className="max-h-[60vh] space-y-3 overflow-y-auto rounded-md border border-border/60 bg-background/80 p-2">
            {chapterTrees.map((tree) => (
              <div key={tree.subject?.id ?? 'subject'} className="space-y-1">
                <div className="px-2 text-xs font-semibold text-muted-foreground">
                  {tree.subject?.name || '未命名学科'}
                </div>
                {(tree.chapters ?? []).map((node) => (
                  <ChapterBindingNode
                    key={node.id}
                    node={node}
                    depth={0}
                    explicitIds={explicitIds}
                    busy={bindingBusy}
                    onToggle={toggleChapterBinding}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

