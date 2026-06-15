import { CheckCircle2, Save } from 'lucide-react'
import type { PalaceMeta } from '@/features/palace-edit/hooks/usePalaceEditPage'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'

interface PalaceMetaPanelProps {
  palace: PalaceMeta | null
  title: string
  createdAt: string
  onTitleChange: (value: string) => void
  onCreatedAtChange: (value: string) => void
  onSave: () => void | Promise<void>
  onEstablishCreatedAt: () => void | Promise<void>
}

export function PalaceMetaPanel({
  palace,
  title,
  createdAt,
  onTitleChange,
  onCreatedAtChange,
  onSave,
  onEstablishCreatedAt,
}: PalaceMetaPanelProps) {
  return (
    <Card className="border-border/70 bg-card/92">
      <CardHeader>
        <CardTitle className="text-base">宫殿字段</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="palace-title">标题</Label>
          <Input
            id="palace-title"
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="palace-created-at">建造状态</Label>
          {palace?.created_at ? (
            <div className="space-y-3 rounded-2xl border border-border/70 bg-background/70 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <CheckCircle2 className="h-4 w-4 text-success" />
                已确立建造宫殿
              </div>
              <div className="space-y-2">
                <Label htmlFor="palace-created-at">创建时间</Label>
                <Input
                  id="palace-created-at"
                  type="datetime-local"
                  value={createdAt}
                  onChange={(event) => onCreatedAtChange(event.target.value)}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3 rounded-2xl border border-dashed border-border/80 bg-background/70 p-4">
              <p className="text-sm text-muted-foreground">
                确立后会以你点击按钮的时间作为该宫殿的创建时间，之后仍可继续修改。
              </p>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => void onEstablishCreatedAt()}
              >
                确立建造宫殿
              </Button>
            </div>
          )}
        </div>
        <Button type="button" className="w-full" onClick={() => void onSave()}>
          <Save className="mr-2 h-4 w-4" />
          保存
        </Button>
      </CardContent>
    </Card>
  )
}
