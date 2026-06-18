import { ArrowLeft, Eye } from 'lucide-react'
import type {
  PalaceVersionDetail,
  PalaceVersionSummary,
} from '@/shared/api/contracts'
import { MindMapFrame } from '@/shared/components/mindmap-host'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { formatVersionSavedAt } from '@/features/palace-edit/model/palace-edit-format'
import {
  normalizePreviewConfig,
  normalizePreviewEditorDoc,
} from '@/shared/lib/mindmapPreview'

interface PalaceVersionDialogProps {
  open: boolean
  versions: PalaceVersionSummary[]
  removedDuplicateCount: number
  previewingVersionId: number | null
  previewVersionDetail: PalaceVersionDetail | null
  previewLoading: boolean
  previewError: string
  editorStateLang: string
  onOpenChange: (open: boolean) => void
  onClose: () => void
  onPreviewVersion: (versionId: number) => void | Promise<void>
  onRestoreVersion: (versionId: number) => void | Promise<void>
  onBackToList: () => void
}

export function PalaceVersionDialog({
  open,
  versions,
  removedDuplicateCount,
  previewingVersionId,
  previewVersionDetail,
  previewLoading,
  previewError,
  editorStateLang,
  onOpenChange,
  onClose,
  onPreviewVersion,
  onRestoreVersion,
  onBackToList,
}: PalaceVersionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(80vh,900px)] max-h-[min(80vh,900px)] max-w-3xl overflow-hidden rounded-[28px] border-border/70 bg-background/98 p-0">
        <DialogHeader>
          <div>
            <DialogTitle>宫殿恢复点</DialogTitle>
          </div>
          <DialogClose onClick={onClose} />
        </DialogHeader>

        {previewingVersionId == null ? (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6">
            <div className="space-y-3">
              {versions.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border/80 bg-background/70 px-4 py-8 text-center text-sm text-muted-foreground">
                  当前还没有可恢复的有效快照。
                </div>
              ) : (
                <>
                  {versions.map((version) => (
                    <div
                      key={version.id}
                      className="flex flex-col gap-4 rounded-[24px] border border-border/70 bg-card/90 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                          <span>
                            {version.trigger_reason === 'editor_save'
                              ? '自动恢复点'
                              : version.trigger_reason}
                          </span>
                          <span className="text-muted-foreground">·</span>
                          <span className="text-muted-foreground">
                            {formatVersionSavedAt(version.created_at)}
                          </span>
                          <span className="text-muted-foreground">·</span>
                          <Badge
                            variant="outline"
                            className="rounded-full px-2.5 py-0.5 text-[11px]"
                          >
                            恢复点 #{version.id}
                          </Badge>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void onPreviewVersion(version.id)}
                        >
                          <Eye className="mr-2 h-4 w-4" />
                          预览
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void onRestoreVersion(version.id)}
                        >
                          恢复这个版本
                        </Button>
                      </div>
                    </div>
                  ))}
                  <div className="rounded-2xl border border-dashed border-border/80 bg-background/60 px-4 py-3 text-center text-sm text-muted-foreground">
                    已显示全部 {versions.length} 个恢复点
                    {removedDuplicateCount > 0
                      ? `，本次已自动清理 ${removedDuplicateCount} 条重复快照`
                      : ''}
                    。
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6">
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button variant="outline" size="sm" onClick={onBackToList}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  返回列表
                </Button>
                {previewVersionDetail ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void onRestoreVersion(previewVersionDetail.id)}
                  >
                    恢复这个版本
                  </Button>
                ) : null}
              </div>

              {previewLoading ? (
                <div className="rounded-2xl border border-dashed border-border/80 bg-background/70 px-4 py-10 text-center text-sm text-muted-foreground">
                  正在加载版本预览…
                </div>
              ) : previewError ? (
                <div className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-4 text-sm text-destructive">
                  {previewError}
                </div>
              ) : previewVersionDetail ? (
                <div className="space-y-4">
                  <div className="rounded-[24px] border border-border/70 bg-card/90 px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                      <span>
                        {previewVersionDetail.trigger_reason === 'editor_save'
                          ? '自动恢复点'
                          : previewVersionDetail.trigger_reason}
                      </span>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-muted-foreground">
                        {formatVersionSavedAt(previewVersionDetail.created_at)}
                      </span>
                      <Badge
                        variant="outline"
                        className="rounded-full px-2.5 py-0.5 text-[11px]"
                      >
                        恢复点 #{previewVersionDetail.id}
                      </Badge>
                    </div>
                    <div className="mt-2 text-base font-semibold text-foreground">
                      {previewVersionDetail.title || '未命名宫殿'}
                    </div>
                  </div>

                  <Card className="border-border/70 bg-card/92">
                    <CardContent className="min-h-[56vh] p-4">
                      <MindMapFrame
                        key={`preview-version-${previewVersionDetail.id}`}
                        editorState={{
                          editor_doc: normalizePreviewEditorDoc(
                            previewVersionDetail.editor_doc,
                          ),
                          editor_config: normalizePreviewConfig(
                            previewVersionDetail.editor_config,
                          ),
                          editor_local_config: normalizePreviewConfig(
                            previewVersionDetail.editor_local_config,
                          ),
                          lang: editorStateLang || 'zh',
                        }}
                        readonly
                        onEditorStateChange={() => {}}
                        className="h-[56vh] w-full rounded-2xl border border-border/70 bg-background"
                      />
                    </CardContent>
                  </Card>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
