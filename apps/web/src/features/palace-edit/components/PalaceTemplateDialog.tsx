import { useCallback, useEffect, useState } from 'react'
import { LoaderCircle, Trash2 } from 'lucide-react'
import {
  deletePalaceTemplateApi,
  instantiatePalaceTemplateApi,
  listPalaceTemplatesApi,
} from '@/entities/palace/api'
import type { PalaceTemplateSummary } from '@/shared/api/contracts'
import { EmptyState } from '@/shared/components/state-placeholders'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { appConfirm } from '@/shared/components/ui/native-dialog'
import { toast } from '@/shared/feedback/toast'

interface PalaceTemplateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (palaceId: number) => void
}

function formatCreatedAt(value: string | null) {
  if (!value) return '创建时间未知'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '创建时间未知'
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

export function PalaceTemplateDialog({
  open,
  onOpenChange,
  onCreated,
}: PalaceTemplateDialogProps) {
  const [templates, setTemplates] = useState<PalaceTemplateSummary[]>([])
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [usingTemplateId, setUsingTemplateId] = useState<number | null>(null)
  const [deletingTemplateId, setDeletingTemplateId] = useState<number | null>(null)
  const [error, setError] = useState('')

  const loadTemplates = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await listPalaceTemplatesApi()
      setTemplates(result.items)
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : '模板列表加载失败。'
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void loadTemplates()
  }, [loadTemplates, open])

  const handleUseTemplate = async (template: PalaceTemplateSummary) => {
    setUsingTemplateId(template.id)
    try {
      const palace = await instantiatePalaceTemplateApi(template.id, title)
      toast.success('已从模板创建宫殿')
      onOpenChange(false)
      onCreated(palace.id)
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : '从模板创建宫殿失败。')
    } finally {
      setUsingTemplateId(null)
    }
  }

  const handleDeleteTemplate = async (template: PalaceTemplateSummary) => {
    const confirmed = await appConfirm(`删除模板“${template.name || '未命名模板'}”？`, {
      title: '删除宫殿模板',
      confirmText: '删除',
      tone: 'danger',
    })
    if (!confirmed) return
    setDeletingTemplateId(template.id)
    try {
      await deletePalaceTemplateApi(template.id)
      toast.success('模板已删除')
      await loadTemplates()
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : '删除模板失败。')
    } finally {
      setDeletingTemplateId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(78vh,760px)] max-w-2xl overflow-hidden rounded-lg border-border/70 bg-background/98 p-0">
        <DialogHeader>
          <div>
            <DialogTitle>从模板创建宫殿</DialogTitle>
          </div>
          <DialogClose onClick={() => onOpenChange(false)} />
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-6">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="新宫殿标题（留空则使用模板名）"
          />

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {loading ? (
              <div className="flex items-center gap-2 rounded-lg border border-dashed border-border/80 bg-background/70 px-4 py-8 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                正在加载模板
              </div>
            ) : error ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-4 text-sm text-destructive">
                {error}
              </div>
            ) : templates.length === 0 ? (
              <EmptyState
                variant="create"
                title="还没有宫殿模板"
                description="先打开任意宫殿，在编辑页点“存为模板”。"
                className="border border-dashed border-border/80"
              />
            ) : (
              <div className="space-y-3">
                {templates.map((template) => (
                  <div
                    key={template.id}
                    className="flex flex-col gap-3 rounded-lg border border-border/70 bg-card/90 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="truncate text-sm font-medium text-foreground">
                        {template.name || '未命名模板'}
                      </div>
                      {template.description ? (
                        <div className="line-clamp-2 text-sm text-muted-foreground">
                          {template.description}
                        </div>
                      ) : null}
                      <div className="text-xs text-muted-foreground">
                        {formatCreatedAt(template.created_at)}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={usingTemplateId != null || deletingTemplateId != null}
                        onClick={() => void handleUseTemplate(template)}
                      >
                        {usingTemplateId === template.id ? (
                          <LoaderCircle className="mr-2 size-4 animate-spin" />
                        ) : null}
                        使用
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        disabled={usingTemplateId != null || deletingTemplateId != null}
                        title="删除模板"
                        aria-label="删除模板"
                        onClick={() => void handleDeleteTemplate(template)}
                      >
                        {deletingTemplateId === template.id ? (
                          <LoaderCircle className="size-4 animate-spin" />
                        ) : (
                          <Trash2 className="size-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
