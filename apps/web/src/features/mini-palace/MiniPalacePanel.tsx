import * as React from 'react'
import { Play, Plus, Save, Trash2, X } from 'lucide-react'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { cn } from '@/shared/lib/utils'
import type { MiniPalaceController } from './useMiniPalaceController'

interface MiniPalacePanelProps {
  controller: MiniPalaceController
  className?: string
  onEditSave?: () => void | Promise<void>
  onEditCancel?: () => void
}

export function MiniPalacePanel({ controller, className, onEditSave, onEditCancel }: MiniPalacePanelProps) {
  const [namesById, setNamesById] = React.useState<Record<number, string>>({})

  React.useEffect(() => {
    setNamesById((current) => {
      const next = { ...current }
      controller.items.forEach((item) => {
        if (next[item.id] == null) {
          next[item.id] = item.name
        }
      })
      return next
    })
  }, [controller.items])

  return (
    <>
      <Dialog open={controller.panelOpen} onOpenChange={controller.setPanelOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>小宫殿</DialogTitle>
            <DialogClose onClick={controller.closePanel} />
          </DialogHeader>
          <div className="space-y-4 px-6 py-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{controller.items.length} 个</Badge>
                {controller.loading ? <Badge variant="secondary">加载中</Badge> : null}
                {controller.error ? <Badge variant="destructive">{controller.error}</Badge> : null}
              </div>
              <Button type="button" size="sm" onClick={controller.startCreate}>
                <Plus className="mr-2 h-4 w-4" />
                新建小宫殿
              </Button>
            </div>

            <div className="max-h-[52vh] space-y-2 overflow-auto pr-1">
              {controller.items.length === 0 && !controller.loading ? (
                <div className="rounded-lg border border-border/70 bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
                  还没有小宫殿。
                </div>
              ) : null}
              {controller.items.map((item) => (
                <div
                  key={item.id}
                  className="grid gap-2 rounded-lg border border-border/70 bg-background/80 p-3 sm:grid-cols-[minmax(0,1fr)_auto]"
                >
                  <div className="min-w-0 space-y-2">
                    <Input
                      value={namesById[item.id] ?? item.name}
                      onChange={(event) =>
                        setNamesById((current) => ({
                          ...current,
                          [item.id]: event.currentTarget.value,
                        }))
                      }
                      aria-label={`${item.name} 名称`}
                    />
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant={item.is_empty ? 'destructive' : 'outline'}>
                        {item.node_count} 张
                      </Badge>
                      {item.updated_at ? <span>{item.updated_at.replace('T', ' ').slice(0, 16)}</span> : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={controller.saving}
                      onClick={() => controller.renameMiniPalace(item, namesById[item.id] ?? item.name)}
                    >
                      <Save className="mr-2 h-4 w-4" />
                      保存
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={controller.saving || item.is_empty}
                      onClick={() => controller.startPractice(item)}
                    >
                      <Play className="mr-2 h-4 w-4" />
                      进入
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      disabled={controller.saving}
                      onClick={() => void controller.deleteMiniPalace(item)}
                      aria-label={`删除 ${item.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {controller.isSelecting ? (
        <div
          className={cn(
            'fixed right-5 top-20 z-[140] w-[min(420px,calc(100vw-40px))] rounded-lg border border-slate-200 bg-white/96 p-4 shadow-xl',
            className,
          )}
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-sm font-semibold">{controller.activeMiniPalace ? "编辑小宫殿" : "新建小宫殿"}</div>
            <Button type="button" size="icon" variant="ghost" onClick={controller.cancelCreate}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="space-y-3">
            <Input
              value={controller.draftName}
              onChange={(event) => controller.setDraftName(event.currentTarget.value)}
              placeholder="不填则使用默认名字"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge variant="outline">已选 {controller.draftNodeUids.length} 张</Badge>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={controller.saving}
                  onClick={() => {
                    if (onEditCancel) onEditCancel()
                    else controller.cancelCreate()
                  }}
                >
                  取消
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={controller.saving || controller.draftNodeUids.length === 0}
                  onClick={() => {
                    if (controller.activeMiniPalace && onEditSave) {
                      void (async () => { await onEditSave() })()
                    } else {
                      void controller.confirmCreate()
                    }
                  }}
                >
                  确认新建小宫殿
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {controller.isPracticing && controller.activeMiniPalace ? (
        <div
          className={cn(
            'fixed right-5 top-20 z-[140] w-[min(380px,calc(100vw-40px))] rounded-lg border border-emerald-200 bg-white/96 p-4 shadow-xl',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{controller.activeMiniPalace.name}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge variant="outline">{controller.activeMiniPalace.node_count} 个检查点</Badge>
                {controller.completed ? (
                  <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">已完成</Badge>
                ) : (
                  <Badge variant="secondary">小宫殿翻卡</Badge>
                )}
              </div>
            </div>
            <Button type="button" size="icon" variant="ghost" onClick={controller.exitPractice}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button type="button" size="sm" variant="outline" onClick={controller.openPanel}>
              管理
            </Button>
            <Button type="button" size="sm" onClick={controller.exitPractice}>
              返回原场景
            </Button>
          </div>
        </div>
      ) : null}
    </>
  )
}
