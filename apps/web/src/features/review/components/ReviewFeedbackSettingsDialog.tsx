import { Badge } from "@/shared/components/ui/badge";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { cn } from "@/shared/lib/utils";

export function ReviewFeedbackSettingsDialog({
  open,
  onOpenChange,
  mode,
  soundEnabled,
  volume,
  animationEnabled,
  surpriseEnabled,
  globalIntensity,
  onToggleMode,
  onToggleSound,
  onVolumeChange,
  onToggleAnimation,
  onToggleSurprise,
  onCycleGlobalIntensity,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "immersive" | "quiet";
  soundEnabled: boolean;
  volume: number;
  animationEnabled: boolean;
  surpriseEnabled: boolean;
  globalIntensity: "quiet" | "balanced" | "immersive";
  onToggleMode: () => void;
  onToggleSound: () => void;
  onVolumeChange: (volume: number) => void;
  onToggleAnimation: () => void;
  onToggleSurprise: () => void;
  onCycleGlobalIntensity: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div>
            <DialogTitle>反馈强度</DialogTitle>
            <DialogDescription className="mt-1 text-sm text-muted-foreground">
              默认是沉浸反馈；觉得太吵时可一键切换到安静模式。
            </DialogDescription>
          </div>
          <DialogClose onClick={() => onOpenChange(false)} />
        </DialogHeader>
        <div className="space-y-4 px-6 py-5">
          <button
            type="button"
            onClick={onToggleMode}
            className={cn(
              "flex w-full items-center justify-between rounded-2xl border px-4 py-4 text-left transition-colors",
              mode === "immersive"
                ? "border-warning/30 bg-warning/5"
                : "border-border/70 bg-muted",
            )}
          >
            <div>
              <div className="text-sm font-semibold">
                {mode === "immersive" ? "沉浸模式已开启" : "安静模式已开启"}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {mode === "immersive"
                  ? "保留声音、扫光、里程碑惊喜和结算仪式。"
                  : "关闭强刺激，保留核心信息和基础操作流。"}
              </div>
            </div>
            <Badge variant={mode === "immersive" ? "default" : "outline"}>
              {mode === "immersive" ? "切到安静" : "切到沉浸"}
            </Badge>
          </button>

          <button
            type="button"
            onClick={onCycleGlobalIntensity}
            className="flex items-center justify-between rounded-2xl border border-border/70 bg-background/80 px-4 py-3 text-left"
          >
            <div>
              <div className="text-sm font-medium">全局界面反馈</div>
              <div className="mt-1 text-sm text-muted-foreground">
                普通点击、悬停、打字等通用操作的粒子与声音强度。不影响脑图与复习的反馈。
              </div>
            </div>
            <Badge variant="secondary">
              {globalIntensity === "immersive"
                ? "沉浸"
                : globalIntensity === "balanced"
                  ? "平衡"
                  : "安静"}
            </Badge>
          </button>

          <div className="grid gap-3">
            <button
              type="button"
              onClick={onToggleSound}
              className="flex items-center justify-between rounded-2xl border border-border/70 bg-background/80 px-4 py-3 text-left"
            >
              <div>
                <div className="text-sm font-medium">声音反馈</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  揭晓、通关和完成会用合成短音提示。
                </div>
              </div>
              <Badge variant={soundEnabled ? "secondary" : "outline"}>
                {soundEnabled ? "开启" : "关闭"}
              </Badge>
            </button>
            <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <Label htmlFor="review-feedback-volume">音量</Label>
                <span className="text-sm font-medium text-muted-foreground">
                  {Math.round(volume * 100)}%
                </span>
              </div>
              <Input
                id="review-feedback-volume"
                type="range"
                min="0"
                max="2"
                step="0.05"
                value={volume}
                onChange={(event) =>
                  onVolumeChange(Number(event.currentTarget.value))
                }
              />
              <div className="mt-2 text-sm text-muted-foreground">
                调高后，揭晓、通关和完成提示会更明显。
              </div>
            </div>
            <button
              type="button"
              onClick={onToggleAnimation}
              className="flex items-center justify-between rounded-2xl border border-border/70 bg-background/80 px-4 py-3 text-left"
            >
              <div>
                <div className="text-sm font-medium">动画反馈</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  包括边框闪光、HUD 弹跳、扫光和结算条幅。
                </div>
              </div>
              <Badge variant={animationEnabled ? "secondary" : "outline"}>
                {animationEnabled ? "开启" : "关闭"}
              </Badge>
            </button>
            <button
              type="button"
              onClick={onToggleSurprise}
              className="flex items-center justify-between rounded-2xl border border-border/70 bg-background/80 px-4 py-3 text-left"
            >
              <div>
                <div className="text-sm font-medium">里程碑惊喜</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  连击到 3、5、8、13 时偶尔给你一句奖励反馈。
                </div>
              </div>
              <Badge variant={surpriseEnabled ? "secondary" : "outline"}>
                {surpriseEnabled ? "开启" : "关闭"}
              </Badge>
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
