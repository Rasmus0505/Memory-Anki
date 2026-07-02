import { Trash2 } from "lucide-react";
import { VoiceCoachSettingsDialog } from "@/features/voice-coach";
import type {
  AiCallLogDetail,
  AiConnectionTestResponse,
  AiModelCatalogItem,
  AiModelImpactResponse,
} from "@/shared/api/contracts";
import { LoadingState } from "@/shared/components/state-placeholders";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import {
  formatDateTime,
  stringifyJson,
} from "@/features/profile/model/ai-workspace";
import { cn } from "@/shared/lib/utils";

export function AiWorkspaceDialogs({
  impactOpen,
  impactLoading,
  impactModel,
  impact,
  connectionOpen,
  connectionLoading,
  connectionTitle,
  connectionResult,
  logDetailOpen,
  logDetailLoading,
  logDetail,
  settingsOpen,
  savingKeys,
  onImpactOpenChange,
  onConnectionOpenChange,
  onLogDetailOpenChange,
  onSettingsOpenChange,
  onDeleteModel,
  onTestVoice,
}: {
  impactOpen: boolean;
  impactLoading: boolean;
  impactModel: AiModelCatalogItem | null;
  impact: AiModelImpactResponse | null;
  connectionOpen: boolean;
  connectionLoading: boolean;
  connectionTitle: string;
  connectionResult: AiConnectionTestResponse | null;
  logDetailOpen: boolean;
  logDetailLoading: boolean;
  logDetail: AiCallLogDetail | null;
  settingsOpen: boolean;
  savingKeys: Record<string, boolean>;
  onImpactOpenChange: (open: boolean) => void;
  onConnectionOpenChange: (open: boolean) => void;
  onLogDetailOpenChange: (open: boolean) => void;
  onSettingsOpenChange: (open: boolean) => void;
  onDeleteModel: () => Promise<void>;
  onTestVoice: () => Promise<void>;
}) {
  return (
    <>
      <Dialog open={impactOpen} onOpenChange={onImpactOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>模型影响分析</DialogTitle>
            <DialogDescription>
              {impactModel
                ? `正在查看 ${impactModel.display_name} 的绑定影响。`
                : "查看模型在当前系统中的使用范围。"}
            </DialogDescription>
            <DialogClose onClick={() => onImpactOpenChange(false)} />
          </DialogHeader>
          {impactLoading ? (
            <LoadingState text="正在分析模型影响…" />
          ) : impact ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Card>
                  <CardContent className="p-4">
                    <div className="text-xs text-muted-foreground">场景引用</div>
                    <div className="mt-2 text-xl font-semibold">
                      {impact.usage_count}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-xs text-muted-foreground">
                      分类通用引用
                    </div>
                    <div className="mt-2 text-xl font-semibold">
                      {impact.category_impacts.length}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-xs text-muted-foreground">
                      是否可删除
                    </div>
                    <div className="mt-2 text-xl font-semibold">
                      {impact.can_delete ? "可以" : "不可以"}
                    </div>
                  </CardContent>
                </Card>
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium">场景绑定</div>
                {impact.scene_impacts.length > 0 ? (
                  impact.scene_impacts.map((item) => (
                    <div
                      key={item.key}
                      className="rounded-lg border border-border/60 px-3 py-2 text-sm"
                    >
                      {item.label} · {item.category_label}
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-muted-foreground">
                    没有场景直接绑定这个模型。
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium">分类通用配置</div>
                {impact.category_impacts.length > 0 ? (
                  impact.category_impacts.map((item) => (
                    <div
                      key={item.key}
                      className="rounded-lg border border-border/60 px-3 py-2 text-sm"
                    >
                      {item.label}
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-muted-foreground">
                    没有分类把它设为通用模型。
                  </div>
                )}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onImpactOpenChange(false)}
            >
              关闭
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void onDeleteModel()}
              disabled={
                !impact?.can_delete ||
                !impactModel ||
                Boolean(savingKeys[`delete:${impactModel?.key ?? ""}`])
              }
            >
              <Trash2 className="mr-2 size-4" />
              {impactModel && savingKeys[`delete:${impactModel.key}`]
                ? "停用中..."
                : "确认停用模型"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={connectionOpen} onOpenChange={onConnectionOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{connectionTitle}</DialogTitle>
            <DialogDescription>
              使用当前配置对目标 Provider / 模型发起一次轻量探测请求。
            </DialogDescription>
            <DialogClose onClick={() => onConnectionOpenChange(false)} />
          </DialogHeader>
          {connectionLoading ? (
            <LoadingState text="正在测试连接…" />
          ) : connectionResult ? (
            <div className="space-y-3">
              <div
                className={cn(
                  "rounded-xl border px-4 py-3 text-sm",
                  connectionResult.ok
                    ? "border-success/30 bg-success/5"
                    : "border-destructive/30 bg-destructive/5",
                )}
              >
                <div className="font-medium">
                  {connectionResult.ok ? "测试成功" : "测试失败"}
                </div>
                <div className="mt-1 text-muted-foreground">
                  Provider：
                  {connectionResult.provider_label ?? connectionResult.provider}
                </div>
                <div className="text-muted-foreground">
                  模型：{connectionResult.model}
                </div>
                <div className="text-muted-foreground">
                  延迟：{connectionResult.latency_ms} ms
                </div>
                <div className="text-muted-foreground">
                  配置来源：{connectionResult.source ?? "default"}
                </div>
                {connectionResult.error ? (
                  <div className="mt-2 text-destructive">
                    {connectionResult.error}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={logDetailOpen} onOpenChange={onLogDetailOpenChange}>
        <DialogContent className="h-[min(88vh,920px)] max-w-[min(92vw,1100px)] overflow-hidden">
          <DialogHeader>
            <DialogTitle>AI 调用详情</DialogTitle>
            <DialogDescription>
              查看请求、响应、错误和输入工件等完整上下文。
            </DialogDescription>
            <DialogClose onClick={() => onLogDetailOpenChange(false)} />
          </DialogHeader>
          {logDetailLoading ? (
            <LoadingState text="正在加载日志详情…" />
          ) : logDetail ? (
            <div className="grid h-full gap-4 overflow-hidden lg:grid-cols-2">
              <div className="space-y-3 overflow-y-auto pr-2">
                <div className="rounded-xl border border-border/60 p-3 text-sm">
                  <div>Feature：{logDetail.feature}</div>
                  <div>Provider：{logDetail.provider}</div>
                  <div>Model：{logDetail.model}</div>
                  <div>Status：{logDetail.status}</div>
                  <div>Created：{formatDateTime(logDetail.created_at)}</div>
                </div>
                <div>
                  <div className="mb-2 text-sm font-medium">Prompt</div>
                  <pre className="max-h-64 overflow-auto rounded-xl border border-border/60 bg-muted/30 p-3 text-xs">
                    {logDetail.prompt_text || "暂无"}
                  </pre>
                </div>
                <div>
                  <div className="mb-2 text-sm font-medium">Response Text</div>
                  <pre className="max-h-64 overflow-auto rounded-xl border border-border/60 bg-muted/30 p-3 text-xs">
                    {logDetail.response_text || "暂无"}
                  </pre>
                </div>
              </div>
              <div className="space-y-3 overflow-y-auto pr-2">
                <div>
                  <div className="mb-2 text-sm font-medium">Request Payload</div>
                  <pre className="max-h-56 overflow-auto rounded-xl border border-border/60 bg-muted/30 p-3 text-xs">
                    {stringifyJson(logDetail.request_payload)}
                  </pre>
                </div>
                <div>
                  <div className="mb-2 text-sm font-medium">Response Payload</div>
                  <pre className="max-h-56 overflow-auto rounded-xl border border-border/60 bg-muted/30 p-3 text-xs">
                    {stringifyJson(logDetail.response_payload)}
                  </pre>
                </div>
                <div>
                  <div className="mb-2 text-sm font-medium">Error Payload</div>
                  <pre className="max-h-40 overflow-auto rounded-xl border border-border/60 bg-muted/30 p-3 text-xs">
                    {stringifyJson(logDetail.error_payload)}
                  </pre>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <VoiceCoachSettingsDialog
        open={settingsOpen}
        onOpenChange={onSettingsOpenChange}
        onTest={() => onTestVoice()}
      />
    </>
  );
}
