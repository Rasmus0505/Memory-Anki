import {
  DEFAULT_TODAY_TRAINING_CONFIG,
  TODAY_TRAINING_ROUND_SIZE,
  type TodayTrainingConfig,
} from '@/modules/practice/ui/freestyle/model/today-training'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Switch } from '@/shared/components/ui/switch'

export function TodayTrainingSettingsDialog({
  open,
  config,
  onOpenChange,
  onConfigChange,
  onClearProgress,
}: {
  open: boolean
  config: TodayTrainingConfig
  onOpenChange: (open: boolean) => void
  onConfigChange: (updater: (current: TodayTrainingConfig) => TodayTrainingConfig) => void
  onClearProgress: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-lg border-border/70 bg-background p-0">
        <DialogHeader>
          <div className="min-w-0">
            <DialogTitle>今日训练设置</DialogTitle>
            <DialogDescription className="mt-1">
              每轮固定 {TODAY_TRAINING_ROUND_SIZE} 个任务，优先处理到期复习。
            </DialogDescription>
          </div>
          <DialogClose onClick={() => onOpenChange(false)} />
        </DialogHeader>

        <div className="space-y-3 px-5 py-5">
          <label className="flex items-center justify-between rounded-lg border border-border/70 bg-card/70 px-3 py-3 text-sm">
            <span>混入英语听力</span>
            <Switch
              checked={config.includeEnglish}
              onCheckedChange={(checked) =>
                onConfigChange((current) => ({
                  ...current,
                  includeEnglish: Boolean(checked),
                }))
              }
            />
          </label>
          <label className="flex items-center justify-between rounded-lg border border-border/70 bg-card/70 px-3 py-3 text-sm">
            <span>混入英语阅读</span>
            <Switch
              checked={config.includeEnglishReading}
              onCheckedChange={(checked) =>
                onConfigChange((current) => ({
                  ...current,
                  includeEnglishReading: Boolean(checked),
                }))
              }
            />
          </label>
        </div>

        <DialogFooter>
          <Button type="button" variant="destructive" onClick={onClearProgress}>
            清空当前模式进度
          </Button>
          <Button type="button" variant="outline" onClick={() => onConfigChange(() => DEFAULT_TODAY_TRAINING_CONFIG)}>
            恢复默认
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)}>
            完成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
