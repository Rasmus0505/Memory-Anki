import { Paperclip, Upload } from 'lucide-react'
import type { PalaceMeta } from '@/features/palace-edit/hooks/usePalaceEditPage'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'

interface PalaceAttachmentPanelProps {
  palace: PalaceMeta | null
  onUpload: (event: React.ChangeEvent<HTMLInputElement>) => void | Promise<void>
  onDelete: (attachmentId: number) => void | Promise<void>
}

export function PalaceAttachmentPanel({
  palace,
  onUpload,
  onDelete,
}: PalaceAttachmentPanelProps) {
  return (
    <Card className="border-border/70 bg-card/92">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Paperclip className="size-4" />
          附件
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-border/80 px-3 py-4 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <Upload className="mr-2 size-4" />
          上传附件
          <input
            type="file"
            className="hidden"
            onChange={(event) => void onUpload(event)}
          />
        </label>
        <div className="space-y-2">
          {palace?.attachments?.length
            ? palace.attachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="flex items-center justify-between rounded-lg border border-border/70 bg-background/70 px-3 py-3 text-sm"
                >
                  <span>{attachment.original_name}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void onDelete(attachment.id)}
                  >
                    删除
                  </Button>
                </div>
              ))
            : null}
        </div>
      </CardContent>
    </Card>
  )
}
