import type { MindMapDocumentInput } from '@/modules/content/public'
import type { QuizNodeBindingEdge } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { QuizNodeBindingManualPanel } from './QuizNodeBindingManualPanel'

export function QuizNodeBindingDialog({
  open,
  onOpenChange,
  palaceId,
  editorDoc = null,
  onApplied,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  palaceId: number | null
  editorDoc?: MindMapDocumentInput
  onApplied?: (items: QuizNodeBindingEdge[]) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>题库结合</DialogTitle>
          <DialogDescription>
            把题库题目绑定到思维导图知识点卡片。在列表里逐条查看、搜索并手改绑定。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 overflow-y-auto pr-1" style={{ maxHeight: '55vh' }}>
          {palaceId ? (
            <QuizNodeBindingManualPanel
              palaceId={palaceId}
              editorDoc={editorDoc}
              onChanged={onApplied}
            />
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">请先打开有效宫殿。</div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
