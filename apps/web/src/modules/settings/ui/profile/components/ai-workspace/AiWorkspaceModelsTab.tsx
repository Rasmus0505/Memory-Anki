import { Eye, Play, Save, Search, Trash2 } from "lucide-react";
import type {
  AiModelCatalogItem,
  AiModelType,
  AiProviderKey,
} from "@/shared/api/contracts";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import {
  MODEL_TYPE_HINTS,
  MODEL_TYPE_OPTIONS,
  PROVIDER_SELECT_OPTIONS,
  formatDateTime,
  renderModelCapabilityBadges,
  type AiWorkspaceModelCapabilityFilter,
  type AiWorkspaceModelOriginFilter,
  type AiWorkspaceProviderFilter,
  type ModelDraft,
} from "@/modules/settings/ui/profile/model/ai-workspace";

export function AiWorkspaceModelsTab({
  modelSearch,
  modelProviderFilter,
  modelTypeFilter,
  modelOriginFilter,
  modelCapabilityFilter,
  newModelType,
  modelDraft,
  filteredModels,
  savingKeys,
  onModelSearchChange,
  onModelProviderFilterChange,
  onModelTypeFilterChange,
  onModelOriginFilterChange,
  onModelCapabilityFilterChange,
  onNewModelTypeChange,
  onModelDraftChange,
  onCreateModel,
  onTestModel,
  onOpenImpact,
  onJumpToObservability,
}: {
  modelSearch: string;
  modelProviderFilter: AiWorkspaceProviderFilter;
  modelTypeFilter: "all" | AiModelType;
  modelOriginFilter: AiWorkspaceModelOriginFilter;
  modelCapabilityFilter: AiWorkspaceModelCapabilityFilter;
  newModelType: AiModelType;
  modelDraft: ModelDraft;
  filteredModels: AiModelCatalogItem[];
  savingKeys: Record<string, boolean>;
  onModelSearchChange: (value: string) => void;
  onModelProviderFilterChange: (value: AiWorkspaceProviderFilter) => void;
  onModelTypeFilterChange: (value: "all" | AiModelType) => void;
  onModelOriginFilterChange: (value: AiWorkspaceModelOriginFilter) => void;
  onModelCapabilityFilterChange: (
    value: AiWorkspaceModelCapabilityFilter,
  ) => void;
  onNewModelTypeChange: (value: AiModelType) => void;
  onModelDraftChange: (draft: ModelDraft) => void;
  onCreateModel: () => Promise<void>;
  onTestModel: (model: AiModelCatalogItem) => Promise<void>;
  onOpenImpact: (model: AiModelCatalogItem) => Promise<void>;
  onJumpToObservability: (filters: {
    provider?: string;
    model?: string;
    feature?: string;
    status?: string;
  }) => void;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={modelSearch}
              onChange={(event) => onModelSearchChange(event.target.value)}
              placeholder="搜索 key / 显示名…"
              className="pl-9"
            />
          </div>
          <select
            value={modelProviderFilter}
            onChange={(event) =>
              onModelProviderFilterChange(
                event.target.value as AiWorkspaceProviderFilter,
              )
            }
            className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="all">全部 Provider</option>
            {PROVIDER_SELECT_OPTIONS.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
          <select
            value={modelTypeFilter}
            onChange={(event) =>
              onModelTypeFilterChange(event.target.value as "all" | AiModelType)
            }
            className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="all">全部类型</option>
            {MODEL_TYPE_OPTIONS.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
          <select
            value={modelOriginFilter}
            onChange={(event) =>
              onModelOriginFilterChange(
                event.target.value as AiWorkspaceModelOriginFilter,
              )
            }
            className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="all">全部来源</option>
            <option value="builtin">仅内置</option>
            <option value="custom">仅自定义</option>
          </select>
          <select
            value={modelCapabilityFilter}
            onChange={(event) =>
              onModelCapabilityFilterChange(
                event.target.value as AiWorkspaceModelCapabilityFilter,
              )
            }
            className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="all">全部能力</option>
            <option value="thinking">支持思考</option>
            <option value="vision">有视觉</option>
          </select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">新增或覆盖模型</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[140px_repeat(3,minmax(0,1fr))]">
            <select
              value={newModelType}
              onChange={(event) =>
                onNewModelTypeChange(event.target.value as AiModelType)
              }
              className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {MODEL_TYPE_OPTIONS.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
            <Input
              value={modelDraft.key}
              onChange={(event) =>
                onModelDraftChange({ ...modelDraft, key: event.target.value })
              }
              placeholder="模型 key"
            />
            <Input
              value={modelDraft.displayName}
              onChange={(event) =>
                onModelDraftChange({
                  ...modelDraft,
                  displayName: event.target.value,
                })
              }
              placeholder="显示名称（可选）"
            />
            <select
              value={modelDraft.provider}
              onChange={(event) =>
                onModelDraftChange({
                  ...modelDraft,
                  provider: event.target.value as AiProviderKey,
                })
              }
              className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {PROVIDER_SELECT_OPTIONS.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <select
              value={modelDraft.structuredOutputMode}
              onChange={(event) => onModelDraftChange({
                ...modelDraft,
                structuredOutputMode: event.target.value as ModelDraft["structuredOutputMode"],
              })}
              className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="json_schema">JSON Schema</option>
              <option value="json_object">JSON Object</option>
              <option value="prompt_only">仅提示词</option>
            </select>
            <Input value={modelDraft.inputPrice} onChange={(event) => onModelDraftChange({ ...modelDraft, inputPrice: event.target.value })} placeholder="输入价/百万 token" type="number" min="0" step="0.0001" />
            <Input value={modelDraft.outputPrice} onChange={(event) => onModelDraftChange({ ...modelDraft, outputPrice: event.target.value })} placeholder="输出价/百万 token" type="number" min="0" step="0.0001" />
            <Input value={modelDraft.cachedInputPrice} onChange={(event) => onModelDraftChange({ ...modelDraft, cachedInputPrice: event.target.value })} placeholder="缓存输入价/百万" type="number" min="0" step="0.0001" />
          </div>
          <div className="flex flex-wrap gap-4 rounded-xl border border-dashed border-border/70 px-4 py-3">
            {newModelType === "llm" ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={modelDraft.hasVision}
                  onChange={(event) =>
                    onModelDraftChange({
                      ...modelDraft,
                      hasVision: event.target.checked,
                    })
                  }
                />
                有视觉
              </label>
            ) : null}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={modelDraft.supportsThinking}
                onChange={(event) =>
                  onModelDraftChange({
                    ...modelDraft,
                    supportsThinking: event.target.checked,
                  })
                }
              />
              支持思考
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={modelDraft.supportsTemperature}
                disabled={newModelType === "asr"}
                onChange={(event) =>
                  onModelDraftChange({
                    ...modelDraft,
                    supportsTemperature: event.target.checked,
                  })
                }
              />
              支持温度
            </label>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">
              {MODEL_TYPE_HINTS[newModelType]}
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => void onCreateModel()}
              disabled={Boolean(savingKeys["model:create"])}
            >
              <Save className="mr-2 size-4" />
              {savingKeys["model:create"] ? "保存中..." : "保存模型目录"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {filteredModels.map((model) => (
          <Card key={model.key} className="border-border/70">
            <CardHeader className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">
                    {model.display_name}
                  </CardTitle>
                  <div className="mt-1 font-mono text-xs text-muted-foreground">
                    {model.key}
                  </div>
                </div>
                <Badge
                  variant={
                    model.last_status === "error" ? "destructive" : "secondary"
                  }
                >
                  {model.last_status === "never_used"
                    ? "未调用"
                    : model.last_status ?? "未知"}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                {renderModelCapabilityBadges(model).map((item) => (
                  <Badge key={item} variant="outline">
                    {item}
                  </Badge>
                ))}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                <div>被场景使用：{model.usage_count ?? 0}</div>
                <div>最近调用：{formatDateTime(model.last_used_at)}</div>
              </div>
              {model.bound_scene_labels?.length ? (
                <div className="flex flex-wrap gap-2">
                  {model.bound_scene_labels.map((label) => (
                    <Badge key={label} variant="secondary">
                      {label}
                    </Badge>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  当前没有场景绑定这个模型。
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void onTestModel(model)}
                >
                  <Play className="mr-2 size-4" />
                  测试模型
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void onOpenImpact(model)}
                >
                  <Eye className="mr-2 size-4" />
                  查看使用影响
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => onJumpToObservability({ model: model.key })}
                >
                  查看最近调用
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={() => void onOpenImpact(model)}
                  disabled={Boolean(savingKeys[`delete:${model.key}`])}
                >
                  <Trash2 className="mr-2 size-4" />
                  停用模型
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
