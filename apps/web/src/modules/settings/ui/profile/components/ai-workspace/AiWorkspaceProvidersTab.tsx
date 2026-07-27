import { AlertTriangle, Play, Save, Search, Trash2 } from "lucide-react";
import type { AiProviderSettings } from "@/shared/api/contracts";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  formatDateTime,
  getConnectionStatusTone,
  type ProviderDraft,
} from "@/modules/settings/ui/profile/model/ai-workspace";
import { cn } from "@/shared/lib/utils";

export function AiWorkspaceProvidersTab({
  providerSearch,
  filteredProviders,
  providerDrafts,
  savingKeys,
  onProviderSearchChange,
  onProviderDraftChange,
  onProviderSave,
  onProviderTest,
  onClearAllApiKeys,
  onJumpToObservability,
}: {
  providerSearch: string;
  filteredProviders: AiProviderSettings[];
  providerDrafts: Record<string, ProviderDraft>;
  savingKeys: Record<string, boolean>;
  onProviderSearchChange: (value: string) => void;
  onProviderDraftChange: (providerKey: string, draft: ProviderDraft) => void;
  onProviderSave: (providerKey: string) => Promise<void>;
  onProviderTest: (provider: AiProviderSettings) => Promise<void>;
  onClearAllApiKeys: () => Promise<void>;
  onJumpToObservability: (filters: {
    provider?: string;
    model?: string;
    feature?: string;
    status?: string;
  }) => void;
}) {
  return (
    <div className="space-y-4">
      <Card className="border-destructive/40 bg-destructive/5">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div>
              <p className="font-medium">需要临时停用站内全部 AI？</p>
              <p className="text-sm text-muted-foreground">
                清空所有 Provider 与旧版 AI 分卡密钥，显式空值会覆盖环境变量。
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void onClearAllApiKeys()}
            disabled={Boolean(savingKeys["providers:clear-all"])}
          >
            {savingKeys["providers:clear-all"] ? "正在停用…" : "停用全部 AI"}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-[260px] flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={providerSearch}
              onChange={(event) => onProviderSearchChange(event.target.value)}
              placeholder="搜索 Provider、最近使用模型…"
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        {filteredProviders.map((provider) => {
          const draft = providerDrafts[provider.key] ?? {
            baseUrl: provider.base_url,
            apiKeyInput: "",
            clearApiKey: false,
          };
          const isSaving = Boolean(savingKeys[`provider:${provider.key}`]);
          const isDirty =
            draft.baseUrl.trim() !== provider.base_url ||
            draft.clearApiKey ||
            draft.apiKeyInput.trim().length > 0;
          return (
            <Card
              key={provider.key}
              className={cn("border", getConnectionStatusTone(provider))}
            >
              <CardHeader className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{provider.label}</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      当前密钥：
                      {provider.has_api_key ? provider.api_key_masked : "未配置"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">
                      {provider.model_count ?? 0} 个模型
                    </Badge>
                    <Badge
                      variant={
                        provider.last_status === "error"
                          ? "destructive"
                          : "outline"
                      }
                    >
                      {provider.last_status === "error" ? "最近失败" : "连接状态"}
                    </Badge>
                  </div>
                </div>
                <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
                  <div>最近调用：{formatDateTime(provider.last_called_at)}</div>
                  <div>最近成功：{formatDateTime(provider.last_success_at)}</div>
                  <div>最近失败：{formatDateTime(provider.last_error_at)}</div>
                  <div>最近模型：{provider.last_model ?? "暂无"}</div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={`provider-base-${provider.key}`}>Base URL</Label>
                    <Input
                      id={`provider-base-${provider.key}`}
                      value={draft.baseUrl}
                      onChange={(event) =>
                        onProviderDraftChange(provider.key, {
                          ...draft,
                          baseUrl: event.target.value,
                        })
                      }
                    />
                    <div className="text-xs text-muted-foreground">
                      来源：{provider.base_url_source ?? "default"}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`provider-key-${provider.key}`}>API Key</Label>
                    <Input
                      id={`provider-key-${provider.key}`}
                      type="password"
                      value={draft.apiKeyInput}
                      placeholder={
                        draft.clearApiKey
                          ? "保存后将清空"
                          : provider.api_key_masked || "输入新密钥即可更新"
                      }
                      className={draft.clearApiKey ? "border-destructive" : undefined}
                      onChange={(event) =>
                        onProviderDraftChange(provider.key, {
                          ...draft,
                          apiKeyInput: event.target.value,
                          clearApiKey: false,
                        })
                      }
                    />
                    <div className="text-xs text-muted-foreground">
                      来源：{provider.api_key_source ?? "default"}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void onProviderSave(provider.key)}
                    disabled={isSaving || !isDirty}
                  >
                    <Save className="mr-2 size-4" />
                    {isSaving
                      ? "保存中..."
                      : draft.clearApiKey
                        ? "保存并清空密钥"
                        : "保存 Provider 配置"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void onProviderTest(provider)}
                  >
                    <Play className="mr-2 size-4" />
                    测试连接
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      onJumpToObservability({
                        provider: provider.key,
                        status: "error",
                      })
                    }
                  >
                    查看最近错误
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={draft.clearApiKey ? "secondary" : "outline"}
                    onClick={() =>
                      onProviderDraftChange(provider.key, {
                        ...draft,
                        apiKeyInput: "",
                        clearApiKey: !draft.clearApiKey,
                      })
                    }
                  >
                    <Trash2 className="mr-2 size-4" />
                    {draft.clearApiKey ? "撤销清空" : "清空密钥"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
