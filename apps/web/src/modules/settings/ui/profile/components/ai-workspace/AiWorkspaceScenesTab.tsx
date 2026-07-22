import { RefreshCcw, Save, Search } from "lucide-react";
import type {
  AiModelCategory,
  AiModelType,
  AiSceneBinding,
} from "@/shared/api/contracts";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  PROVIDER_SELECT_OPTIONS,
  categorySupportsThinking,
  formatDateTime,
  sceneSupportsThinking,
  type AiWorkspaceProviderFilter,
} from "@/modules/settings/ui/profile/model/ai-workspace";
import { cn } from "@/shared/lib/utils";

export function AiWorkspaceScenesTab({
  categories,
  currentCategory,
  currentCategoryKey,
  currentCategoryScenes,
  filteredCurrentScenes,
  sceneSearch,
  sceneProviderFilter,
  sceneCustomOnly,
  batchModel,
  batchThinking,
  modelSelections,
  thinkingSelections,
  categoryModelSelections,
  categoryThinkingSelections,
  savingKeys,
  onCurrentCategoryChange,
  onCategoryModelSelectionChange,
  onCategoryThinkingSelectionChange,
  onSceneSearchChange,
  onSceneProviderFilterChange,
  onSceneCustomOnlyChange,
  onBatchModelChange,
  onBatchThinkingChange,
  onSceneModelSelectionChange,
  onSceneThinkingSelectionChange,
  onCategorySave,
  onRestoreCategoryScenes,
  onApplyBatch,
  onSceneSave,
  onRestoreScene,
  onJumpToObservability,
}: {
  categories: AiModelCategory[];
  currentCategory: AiModelCategory | null;
  currentCategoryKey: AiModelType;
  currentCategoryScenes: AiSceneBinding[];
  filteredCurrentScenes: AiSceneBinding[];
  sceneSearch: string;
  sceneProviderFilter: AiWorkspaceProviderFilter;
  sceneCustomOnly: boolean;
  batchModel: string;
  batchThinking: boolean;
  modelSelections: Record<string, string>;
  thinkingSelections: Record<string, boolean>;
  categoryModelSelections: Record<string, string>;
  categoryThinkingSelections: Record<string, boolean>;
  savingKeys: Record<string, boolean>;
  onCurrentCategoryChange: (value: AiModelType) => void;
  onCategoryModelSelectionChange: (
    category: AiModelCategory,
    modelKey: string,
  ) => void;
  onCategoryThinkingSelectionChange: (
    categoryKey: AiModelType,
    enabled: boolean,
  ) => void;
  onSceneSearchChange: (value: string) => void;
  onSceneProviderFilterChange: (value: AiWorkspaceProviderFilter) => void;
  onSceneCustomOnlyChange: (value: boolean) => void;
  onBatchModelChange: (category: AiModelCategory, modelKey: string) => void;
  onBatchThinkingChange: (enabled: boolean) => void;
  onSceneModelSelectionChange: (
    scene: AiSceneBinding,
    modelKey: string,
  ) => void;
  onSceneThinkingSelectionChange: (sceneKey: string, enabled: boolean) => void;
  onCategorySave: (category: AiModelCategory) => Promise<void>;
  onRestoreCategoryScenes: (category: AiModelCategory) => Promise<void>;
  onApplyBatch: (category: AiModelCategory) => Promise<void>;
  onSceneSave: (scene: AiSceneBinding) => Promise<void>;
  onRestoreScene: (
    scene: AiSceneBinding,
    category: AiModelCategory,
  ) => Promise<void>;
  onJumpToObservability: (filters: {
    provider?: string;
    model?: string;
    feature?: string;
    status?: string;
  }) => void;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">分类</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {categories.map((category) => (
            <button
              key={category.key}
              type="button"
              onClick={() => onCurrentCategoryChange(category.key)}
              className={cn(
                "w-full rounded-xl border px-3 py-3 text-left transition-colors",
                currentCategoryKey === category.key
                  ? "border-primary bg-primary/5"
                  : "border-border/60",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium">{category.label}</div>
                <Badge variant="secondary">
                  {category.scene_count ?? category.scene_keys.length}
                </Badge>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {category.custom_scene_count ?? 0} 个单独覆盖
              </div>
            </button>
          ))}
        </CardContent>
      </Card>

      {currentCategory ? (
        <div className="space-y-4">
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">通用配置</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {currentCategory.description}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {currentCategory.has_shared_config ? (
                    <Badge variant="secondary">
                      当前通用：{currentCategory.shared_model}
                    </Badge>
                  ) : (
                    <Badge variant="outline">未设置通用配置</Badge>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_180px_auto_auto] lg:items-end">
                <div className="space-y-1.5">
                  <Label htmlFor={`category-model-${currentCategory.key}`}>
                    通用模型
                  </Label>
                  <select
                    id={`category-model-${currentCategory.key}`}
                    value={categoryModelSelections[currentCategory.key] ?? ""}
                    onChange={(event) =>
                      onCategoryModelSelectionChange(
                        currentCategory,
                        event.target.value,
                      )
                    }
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">请选择通用模型</option>
                    {currentCategory.available_models.map((model) => (
                      <option key={model.key} value={model.key}>
                        {model.label} · {model.provider_label}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="flex h-10 items-center justify-between rounded-md border border-input bg-background px-3 text-sm">
                  <span>默认思考</span>
                  <input
                    type="checkbox"
                    checked={Boolean(
                      categoryThinkingSelections[currentCategory.key],
                    )}
                    disabled={
                      !categorySupportsThinking(
                        currentCategory,
                        categoryModelSelections[currentCategory.key] ?? "",
                      )
                    }
                    onChange={(event) =>
                      onCategoryThinkingSelectionChange(
                        currentCategory.key,
                        event.target.checked,
                      )
                    }
                  />
                </label>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void onCategorySave(currentCategory)}
                  disabled={Boolean(savingKeys[`category:${currentCategory.key}`])}
                >
                  <Save className="mr-2 size-4" />
                  {savingKeys[`category:${currentCategory.key}`]
                    ? "保存中..."
                    : "保存并覆盖全部场景"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void onRestoreCategoryScenes(currentCategory)}
                  disabled={
                    Boolean(savingKeys[`restore-all:${currentCategory.key}`]) ||
                    !currentCategory.has_shared_config
                  }
                >
                  <RefreshCcw className="mr-2 size-4" />
                  恢复本类全部场景
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="text-base">批量操作与筛选</CardTitle>
                <Badge variant="secondary">
                  {filteredCurrentScenes.length} / {currentCategoryScenes.length} 个场景
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_180px_140px]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={sceneSearch}
                    onChange={(event) => onSceneSearchChange(event.target.value)}
                    placeholder="搜索场景名或说明…"
                    className="pl-9"
                  />
                </div>
                <select
                  value={sceneProviderFilter}
                  onChange={(event) =>
                    onSceneProviderFilterChange(
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
                <label className="flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
                  <input
                    type="checkbox"
                    checked={sceneCustomOnly}
                    onChange={(event) =>
                      onSceneCustomOnlyChange(event.target.checked)
                    }
                  />
                  仅看单独覆盖
                </label>
              </div>
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_auto] lg:items-end">
                <div className="space-y-1.5">
                  <Label htmlFor="batch-model">批量切换到</Label>
                  <select
                    id="batch-model"
                    value={batchModel}
                    onChange={(event) =>
                      onBatchModelChange(currentCategory, event.target.value)
                    }
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    {currentCategory.available_models.map((model) => (
                      <option key={model.key} value={model.key}>
                        {model.label} · {model.provider_label}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="flex h-10 items-center justify-between rounded-md border border-input bg-background px-3 text-sm">
                  <span>批量思考</span>
                  <input
                    type="checkbox"
                    checked={batchThinking}
                    disabled={
                      !categorySupportsThinking(currentCategory, batchModel)
                    }
                    onChange={(event) =>
                      onBatchThinkingChange(event.target.checked)
                    }
                  />
                </label>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void onApplyBatch(currentCategory)}
                  disabled={
                    Boolean(savingKeys[`batch:${currentCategory.key}`]) ||
                    filteredCurrentScenes.length === 0
                  }
                >
                  <Save className="mr-2 size-4" />
                  {savingKeys[`batch:${currentCategory.key}`]
                    ? "批量保存中..."
                    : "批量应用到当前筛选"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-3">
            {filteredCurrentScenes.map((scene) => {
              const selectedModel =
                modelSelections[scene.key] ?? scene.effective_model;
              const supportsThinking = sceneSupportsThinking(scene, selectedModel);
              const selectedThinking = supportsThinking
                ? Boolean(thinkingSelections[scene.key])
                : false;
              const isDirty =
                selectedModel !== scene.effective_model ||
                selectedThinking !== Boolean(scene.effective_thinking_enabled);
              const isSaving = Boolean(savingKeys[scene.key]);
              const isCustomScene = Boolean(
                currentCategory.has_shared_config &&
                  !scene.inherits_category_default,
              );

              return (
                <Card
                  key={scene.key}
                  className={cn(
                    isCustomScene
                      ? "border-warning/40 bg-warning/5"
                      : "border-border/60",
                  )}
                >
                  <CardContent className="space-y-4 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="font-medium">{scene.label}</div>
                          {isCustomScene ? (
                            <Badge variant="secondary">已单独配置</Badge>
                          ) : null}
                          {scene.last_status ? (
                            <Badge
                              variant={
                                scene.last_status === "error"
                                  ? "destructive"
                                  : "outline"
                              }
                            >
                              {scene.last_status}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {scene.description}
                        </p>
                        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                          <span>当前生效：{scene.effective_model}</span>
                          <span>最近调用：{formatDateTime(scene.last_called_at)}</span>
                          <span>
                            最近真实模型：{scene.resolved_model_label ?? "暂无"}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline">{scene.key}</Badge>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            onJumpToObservability({ model: selectedModel })
                          }
                        >
                          查看调用
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_180px_auto_auto] lg:items-end">
                      <div className="space-y-1.5">
                        <Label htmlFor={`scene-model-${scene.key}`}>默认模型</Label>
                        <select
                          id={`scene-model-${scene.key}`}
                          value={selectedModel}
                          onChange={(event) =>
                            onSceneModelSelectionChange(scene, event.target.value)
                          }
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        >
                          {scene.available_models
                            .filter(
                              (model) =>
                                sceneProviderFilter === "all" ||
                                model.provider === sceneProviderFilter,
                            )
                            .map((model) => (
                              <option key={model.key} value={model.key}>
                                {model.label} · {model.provider_label}
                              </option>
                            ))}
                        </select>
                      </div>
                      <label className="flex h-10 items-center justify-between rounded-md border border-input bg-background px-3 text-sm">
                        <span>默认思考</span>
                        <input
                          type="checkbox"
                          checked={selectedThinking}
                          disabled={!supportsThinking}
                          onChange={(event) =>
                            onSceneThinkingSelectionChange(
                              scene.key,
                              event.target.checked,
                            )
                          }
                        />
                      </label>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void onSceneSave(scene)}
                        disabled={isSaving || !isDirty}
                      >
                        <Save className="mr-2 size-4" />
                        {isSaving ? "保存中..." : "保存场景默认"}
                      </Button>
                      {currentCategory.has_shared_config ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void onRestoreScene(scene, currentCategory)
                          }
                          disabled={
                            Boolean(savingKeys[`restore:${scene.key}`]) ||
                            scene.inherits_category_default
                          }
                        >
                          <RefreshCcw className="mr-2 size-4" />
                          恢复通用配置
                        </Button>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
