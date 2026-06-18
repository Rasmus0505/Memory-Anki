import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "@/shared/feedback/toast";
import { readVoiceCoachSettings } from "@/entities/preferences/model/voiceCoachSettings";
import { getAiCallLogApi, listAiCallLogsApi } from "@/entities/ai-log/api/aiLogsApi";
import type {
  AiCallLogDetail,
  AiCallLogSummary,
  AiConnectionTestResponse,
  AiModelCategory,
  AiModelCatalogItem,
  AiModelImpactResponse,
  AiModelSettingsResponse,
  AiModelType,
  AiProviderSettings,
  AiSceneBinding,
} from "@/shared/api/contracts";
import {
  createOrUpdateAiModelApi,
  deleteAiModelApi,
  getAiModelImpactApi,
  getAiModelScenariosApi,
  testAiModelApi,
  testAiProviderApi,
  updateAiModelScenariosApi,
} from "@/entities/preferences/api/aiModelSettingsApi";
import { synthesizeVoiceCoachApi } from "@/features/voice-coach/api";
import {
  buildEmptyModelDraft,
  categorySupportsThinking,
  normalizeWorkspaceTab,
  sceneSupportsThinking,
  type AiWorkspaceLogFilters,
  type AiWorkspaceModelCapabilityFilter,
  type AiWorkspaceModelOriginFilter,
  type AiWorkspaceProviderFilter,
  type ModelDraft,
  type ProviderDraft,
  type WorkspaceTab,
} from "@/features/profile/model/ai-workspace";

export function useAiWorkspaceController() {
  const [searchParams, setSearchParams] = useSearchParams();
  const workspaceTab = normalizeWorkspaceTab(searchParams.get("aiTab"));
  const [categories, setCategories] = useState<AiModelCategory[]>([]);
  const [models, setModels] = useState<AiModelCatalogItem[]>([]);
  const [scenes, setScenes] = useState<AiSceneBinding[]>([]);
  const [providers, setProviders] = useState<AiProviderSettings[]>([]);
  const [summary, setSummary] =
    useState<AiModelSettingsResponse["summary"] | null>(null);
  const [modelSelections, setModelSelections] = useState<Record<string, string>>({});
  const [thinkingSelections, setThinkingSelections] = useState<Record<string, boolean>>({});
  const [categoryModelSelections, setCategoryModelSelections] = useState<Record<string, string>>({});
  const [categoryThinkingSelections, setCategoryThinkingSelections] = useState<Record<string, boolean>>({});
  const [providerDrafts, setProviderDrafts] = useState<Record<string, ProviderDraft>>({});
  const [savingKeys, setSavingKeys] = useState<Record<string, boolean>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [testingVoice, setTestingVoice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [providerSearch, setProviderSearch] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [modelProviderFilter, setModelProviderFilter] =
    useState<AiWorkspaceProviderFilter>("all");
  const [modelTypeFilter, setModelTypeFilter] = useState<"all" | AiModelType>("all");
  const [modelOriginFilter, setModelOriginFilter] =
    useState<AiWorkspaceModelOriginFilter>("all");
  const [modelCapabilityFilter, setModelCapabilityFilter] =
    useState<AiWorkspaceModelCapabilityFilter>("all");
  const [newModelType, setNewModelType] = useState<AiModelType>("llm");
  const [modelDraft, setModelDraft] = useState<ModelDraft>(buildEmptyModelDraft("llm"));
  const [currentCategoryKey, setCurrentCategoryKey] = useState<AiModelType>("llm");
  const [sceneSearch, setSceneSearch] = useState("");
  const [sceneProviderFilter, setSceneProviderFilter] =
    useState<AiWorkspaceProviderFilter>("all");
  const [sceneCustomOnly, setSceneCustomOnly] = useState(false);
  const [batchModel, setBatchModel] = useState("");
  const [batchThinking, setBatchThinking] = useState(false);
  const [impactOpen, setImpactOpen] = useState(false);
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactModel, setImpactModel] = useState<AiModelCatalogItem | null>(null);
  const [impact, setImpact] = useState<AiModelImpactResponse | null>(null);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [connectionLoading, setConnectionLoading] = useState(false);
  const [connectionTitle, setConnectionTitle] = useState("连接测试");
  const [connectionResult, setConnectionResult] =
    useState<AiConnectionTestResponse | null>(null);
  const [logFilters, setLogFilters] = useState<AiWorkspaceLogFilters>({
    provider: "",
    model: "",
    feature: "",
    status: "",
  });
  const [logs, setLogs] = useState<AiCallLogSummary[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logDetailOpen, setLogDetailOpen] = useState(false);
  const [logDetailLoading, setLogDetailLoading] = useState(false);
  const [logDetail, setLogDetail] = useState<AiCallLogDetail | null>(null);

  const hydrateState = (response: AiModelSettingsResponse) => {
    const nextCategories = response.categories ?? [];
    const nextScenes = response.scenes ?? response.scenarios ?? [];
    setCategories(nextCategories);
    setModels(response.models ?? []);
    setScenes(nextScenes);
    setProviders(response.providers ?? []);
    setSummary(response.summary ?? null);
    setModelSelections(
      Object.fromEntries(
        nextScenes.map((item) => [
          item.key,
          item.effective_model || item.current_model || item.default_model,
        ]),
      ),
    );
    setThinkingSelections(
      Object.fromEntries(
        nextScenes.map((item) => [
          item.key,
          Boolean(item.effective_thinking_enabled ?? item.current_thinking_enabled),
        ]),
      ),
    );
    setCategoryModelSelections(
      Object.fromEntries(nextCategories.map((item) => [item.key, item.shared_model ?? ""])),
    );
    setCategoryThinkingSelections(
      Object.fromEntries(
        nextCategories.map((item) => [item.key, Boolean(item.shared_thinking_enabled)]),
      ),
    );
    setProviderDrafts(
      Object.fromEntries(
        (response.providers ?? []).map((item) => [
          item.key,
          { baseUrl: item.base_url, apiKeyInput: "", clearApiKey: false },
        ]),
      ),
    );
    if (!nextCategories.find((item) => item.key === currentCategoryKey) && nextCategories[0]) {
      setCurrentCategoryKey(nextCategories[0].key);
    }
  };

  const loadSettings = async () => {
    setError(null);
    setLoading(true);
    try {
      hydrateState(await getAiModelScenariosApi());
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "无法加载 AI 模型配置，请确认后端服务已启动。",
      );
    } finally {
      setLoading(false);
    }
  };

  const loadLogs = async (nextFilters = logFilters) => {
    setLogsLoading(true);
    try {
      const response = await listAiCallLogsApi({
        provider: nextFilters.provider || null,
        model: nextFilters.model || null,
        feature: nextFilters.feature || null,
        status: nextFilters.status || null,
        limit: 80,
      });
      setLogs(response.items ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载 AI 调用日志失败。");
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => {
    void loadSettings();
  }, []);

  useEffect(() => {
    if (workspaceTab === "observability") {
      void loadLogs();
    }
  }, [workspaceTab]);

  const configurableProviders = useMemo(
    () =>
      providers.filter(
        (provider, index, items) =>
          items.findIndex(
            (item) =>
              item.api_key_config_key === provider.api_key_config_key &&
              item.base_url_config_key === provider.base_url_config_key,
          ) === index,
      ),
    [providers],
  );

  const filteredProviders = useMemo(
    () =>
      configurableProviders.filter((provider) => {
        const query = providerSearch.trim().toLowerCase();
        if (!query) return true;
        return `${provider.label} ${provider.key} ${provider.last_model ?? ""}`
          .toLowerCase()
          .includes(query);
      }),
    [configurableProviders, providerSearch],
  );

  const filteredModels = useMemo(
    () =>
      models.filter((model) => {
        const text = `${model.key} ${model.display_name} ${model.label}`.toLowerCase();
        if (modelSearch.trim() && !text.includes(modelSearch.trim().toLowerCase())) return false;
        if (modelProviderFilter !== "all" && model.provider !== modelProviderFilter) return false;
        if (modelTypeFilter !== "all" && model.model_type !== modelTypeFilter) return false;
        if (modelOriginFilter === "builtin" && !model.is_builtin) return false;
        if (modelOriginFilter === "custom" && model.is_builtin) return false;
        if (modelCapabilityFilter === "thinking" && !model.supports_thinking) return false;
        if (modelCapabilityFilter === "vision" && !model.has_vision) return false;
        return true;
      }),
    [
      modelCapabilityFilter,
      modelOriginFilter,
      modelProviderFilter,
      modelSearch,
      modelTypeFilter,
      models,
    ],
  );

  const groupedScenes = useMemo(
    () =>
      Object.fromEntries(
        categories.map((category) => [
          category.key,
          scenes.filter((item) => item.category_key === category.key),
        ]),
      ) as Record<AiModelType, AiSceneBinding[]>,
    [categories, scenes],
  );

  const currentCategory =
    categories.find((item) => item.key === currentCategoryKey) ?? categories[0] ?? null;
  const currentCategoryScenes = currentCategory ? groupedScenes[currentCategory.key] ?? [] : [];
  const filteredCurrentScenes = useMemo(
    () =>
      currentCategoryScenes.filter((scene) => {
        const sceneText = `${scene.label} ${scene.description} ${scene.key}`.toLowerCase();
        if (sceneSearch.trim() && !sceneText.includes(sceneSearch.trim().toLowerCase())) return false;
        if (sceneCustomOnly && scene.inherits_category_default) return false;
        if (sceneProviderFilter !== "all") {
          const selectedModel = modelSelections[scene.key] ?? scene.effective_model;
          const meta = scene.available_models.find((item) => item.key === selectedModel);
          if (meta?.provider !== sceneProviderFilter) return false;
        }
        return true;
      }),
    [currentCategoryScenes, modelSelections, sceneCustomOnly, sceneProviderFilter, sceneSearch],
  );

  useEffect(() => {
    if (!currentCategory) return;
    setBatchModel(currentCategory.available_models[0]?.key ?? "");
    setBatchThinking(false);
  }, [currentCategory]);

  const setWorkspaceTab = (nextTab: WorkspaceTab) => {
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.set("aiTab", nextTab);
    setSearchParams(nextSearchParams, { replace: true });
  };

  const jumpToObservability = (filters?: Partial<AiWorkspaceLogFilters>) => {
    const nextFilters = {
      provider: filters?.provider ?? "",
      model: filters?.model ?? "",
      feature: filters?.feature ?? "",
      status: filters?.status ?? "",
    };
    setLogFilters(nextFilters);
    setWorkspaceTab("observability");
    void loadLogs(nextFilters);
  };

  const handleProviderSave = async (providerKey: string) => {
    setSavingKeys((current) => ({ ...current, [`provider:${providerKey}`]: true }));
    try {
      const draft = providerDrafts[providerKey];
      const provider = configurableProviders.find((item) => item.key === providerKey);
      if (!draft || !provider) return;
      const providerPayload: Record<string, string> = { base_url: draft.baseUrl.trim() };
      if (draft.clearApiKey) providerPayload.api_key = "";
      else if (draft.apiKeyInput.trim()) providerPayload.api_key = draft.apiKeyInput.trim();
      hydrateState(
        await updateAiModelScenariosApi({
          provider_updates: { [providerKey]: providerPayload },
        }),
      );
      toast.success(`${provider.label} 配置已更新`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存 Provider 配置失败。");
    } finally {
      setSavingKeys((current) => ({ ...current, [`provider:${providerKey}`]: false }));
    }
  };

  const handleProviderTest = async (provider: AiProviderSettings) => {
    setConnectionTitle(`${provider.label} 连接测试`);
    setConnectionResult(null);
    setConnectionOpen(true);
    setConnectionLoading(true);
    try {
      setConnectionResult(await testAiProviderApi(provider.key));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Provider 测试失败。");
      setConnectionOpen(false);
    } finally {
      setConnectionLoading(false);
    }
  };

  const handleCreateModel = async () => {
    if (!modelDraft.key.trim()) {
      toast.error("模型 key 不能为空。");
      return;
    }
    setSavingKeys((current) => ({ ...current, "model:create": true }));
    try {
      hydrateState(
        await createOrUpdateAiModelApi({
          key: modelDraft.key.trim(),
          display_name: modelDraft.displayName.trim() || modelDraft.key.trim(),
          provider: modelDraft.provider,
          model_type: newModelType,
          has_vision: newModelType === "llm" ? modelDraft.hasVision : false,
          supports_thinking: modelDraft.supportsThinking,
          supports_temperature: modelDraft.supportsTemperature,
        }),
      );
      setModelDraft(buildEmptyModelDraft(newModelType));
      toast.success("模型目录已保存");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存模型目录失败。");
    } finally {
      setSavingKeys((current) => ({ ...current, "model:create": false }));
    }
  };

  const handleOpenImpact = async (model: AiModelCatalogItem) => {
    setImpactModel(model);
    setImpact(null);
    setImpactOpen(true);
    setImpactLoading(true);
    try {
      setImpact(await getAiModelImpactApi(model.key));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载模型影响分析失败。");
      setImpactOpen(false);
    } finally {
      setImpactLoading(false);
    }
  };

  const handleDeleteModel = async () => {
    if (!impactModel || !impact) return;
    setSavingKeys((current) => ({ ...current, [`delete:${impactModel.key}`]: true }));
    try {
      hydrateState(await deleteAiModelApi(impactModel.key));
      setImpactOpen(false);
      toast.success(`${impactModel.label} 已停用`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除模型失败。");
      await handleOpenImpact(impactModel);
    } finally {
      setSavingKeys((current) => ({ ...current, [`delete:${impactModel.key}`]: false }));
    }
  };

  const handleTestModel = async (model: AiModelCatalogItem) => {
    setConnectionTitle(`${model.display_name} 模型测试`);
    setConnectionResult(null);
    setConnectionOpen(true);
    setConnectionLoading(true);
    try {
      setConnectionResult(await testAiModelApi(model.key));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "模型测试失败。");
      setConnectionOpen(false);
    } finally {
      setConnectionLoading(false);
    }
  };

  const handleCategorySave = async (category: AiModelCategory) => {
    const selectedModel = categoryModelSelections[category.key]?.trim();
    if (!selectedModel) {
      toast.error("请先给这一类选择通用模型。");
      return;
    }
    setSavingKeys((current) => ({ ...current, [`category:${category.key}`]: true }));
    try {
      const supportsThinking = categorySupportsThinking(category, selectedModel);
      hydrateState(
        await updateAiModelScenariosApi({
          category_updates: {
            [category.key]: {
              default_model: selectedModel,
              default_thinking_enabled: supportsThinking
                ? Boolean(categoryThinkingSelections[category.key])
                : false,
              apply_to_scenes: true,
            },
          },
        }),
      );
      toast.success(`${category.label} 通用配置已保存，并已覆盖该类全部场景`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存分类通用配置失败。");
    } finally {
      setSavingKeys((current) => ({ ...current, [`category:${category.key}`]: false }));
    }
  };

  const handleSceneSave = async (scene: AiSceneBinding) => {
    setSavingKeys((current) => ({ ...current, [scene.key]: true }));
    try {
      const selectedModel =
        modelSelections[scene.key] ?? scene.effective_model ?? scene.current_model;
      const supportsThinking = sceneSupportsThinking(scene, selectedModel);
      hydrateState(
        await updateAiModelScenariosApi({
          scene_updates: {
            [scene.key]: {
              default_model: selectedModel,
              current_model: selectedModel,
              default_thinking_enabled: supportsThinking
                ? Boolean(thinkingSelections[scene.key])
                : false,
              current_thinking_enabled: supportsThinking
                ? Boolean(thinkingSelections[scene.key])
                : false,
            },
          },
        }),
      );
      toast.success(`${scene.label} 默认模型已更新`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存场景默认模型失败。");
    } finally {
      setSavingKeys((current) => ({ ...current, [scene.key]: false }));
    }
  };

  const handleRestoreScene = async (scene: AiSceneBinding, category: AiModelCategory) => {
    const sharedModel = category.shared_model?.trim();
    if (!sharedModel) return;
    const supportsThinking = categorySupportsThinking(category, sharedModel);
    setSavingKeys((current) => ({ ...current, [`restore:${scene.key}`]: true }));
    try {
      hydrateState(
        await updateAiModelScenariosApi({
          scene_updates: {
            [scene.key]: {
              default_model: sharedModel,
              current_model: sharedModel,
              default_thinking_enabled: supportsThinking
                ? Boolean(category.shared_thinking_enabled)
                : false,
              current_thinking_enabled: supportsThinking
                ? Boolean(category.shared_thinking_enabled)
                : false,
            },
          },
        }),
      );
      toast.success(`${scene.label} 已恢复为通用配置`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "恢复通用配置失败。");
    } finally {
      setSavingKeys((current) => ({ ...current, [`restore:${scene.key}`]: false }));
    }
  };

  const handleRestoreCategoryScenes = async (category: AiModelCategory) => {
    const sharedModel = category.shared_model?.trim();
    if (!sharedModel) {
      toast.error("当前分类还没有通用配置。");
      return;
    }
    const supportsThinking = categorySupportsThinking(category, sharedModel);
    const updates = Object.fromEntries(
      (groupedScenes[category.key] ?? []).map((scene) => [
        scene.key,
        {
          default_model: sharedModel,
          current_model: sharedModel,
          default_thinking_enabled: supportsThinking
            ? Boolean(category.shared_thinking_enabled)
            : false,
          current_thinking_enabled: supportsThinking
            ? Boolean(category.shared_thinking_enabled)
            : false,
        },
      ]),
    );
    setSavingKeys((current) => ({ ...current, [`restore-all:${category.key}`]: true }));
    try {
      hydrateState(await updateAiModelScenariosApi({ scene_updates: updates }));
      toast.success(`${category.label} 全部场景已恢复为通用配置`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "恢复全部场景失败。");
    } finally {
      setSavingKeys((current) => ({ ...current, [`restore-all:${category.key}`]: false }));
    }
  };

  const handleApplyBatch = async (category: AiModelCategory) => {
    if (!batchModel) {
      toast.error("请先选择批量模型。");
      return;
    }
    const supportsThinking = categorySupportsThinking(category, batchModel);
    const updates = Object.fromEntries(
      filteredCurrentScenes.map((scene) => [
        scene.key,
        {
          default_model: batchModel,
          current_model: batchModel,
          default_thinking_enabled: supportsThinking ? batchThinking : false,
          current_thinking_enabled: supportsThinking ? batchThinking : false,
        },
      ]),
    );
    setSavingKeys((current) => ({ ...current, [`batch:${category.key}`]: true }));
    try {
      hydrateState(await updateAiModelScenariosApi({ scene_updates: updates }));
      toast.success(`已批量更新 ${filteredCurrentScenes.length} 个场景`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "批量更新场景失败。");
    } finally {
      setSavingKeys((current) => ({ ...current, [`batch:${category.key}`]: false }));
    }
  };

  const handleVoiceTest = async (rethrow = false) => {
    setTestingVoice(true);
    try {
      const response = await synthesizeVoiceCoachApi("session_start");
      const audio = new Audio(response.audio_url);
      audio.volume = readVoiceCoachSettings().volume;
      await audio.play();
      toast.success(response.cached ? "已播放缓存语音" : "已合成并播放语音");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "语音测试失败，请检查配置。");
      if (rethrow) throw err;
    } finally {
      setTestingVoice(false);
    }
  };

  const handleOpenLogDetail = async (logId: string) => {
    setLogDetailOpen(true);
    setLogDetail(null);
    setLogDetailLoading(true);
    try {
      setLogDetail(await getAiCallLogApi(logId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载日志详情失败。");
      setLogDetailOpen(false);
    } finally {
      setLogDetailLoading(false);
    }
  };

  return {
    workspaceTab,
    categories,
    models,
    scenes,
    summary,
    modelSelections,
    thinkingSelections,
    categoryModelSelections,
    categoryThinkingSelections,
    providerDrafts,
    savingKeys,
    settingsOpen,
    testingVoice,
    error,
    loading,
    providerSearch,
    modelSearch,
    modelProviderFilter,
    modelTypeFilter,
    modelOriginFilter,
    modelCapabilityFilter,
    newModelType,
    modelDraft,
    currentCategoryKey,
    sceneSearch,
    sceneProviderFilter,
    sceneCustomOnly,
    batchModel,
    batchThinking,
    impactOpen,
    impactLoading,
    impactModel,
    impact,
    connectionOpen,
    connectionLoading,
    connectionTitle,
    connectionResult,
    logFilters,
    logs,
    logsLoading,
    logDetailOpen,
    logDetailLoading,
    logDetail,
    configurableProviders,
    filteredProviders,
    filteredModels,
    currentCategory,
    currentCategoryScenes,
    filteredCurrentScenes,
    setProviderDrafts,
    setSettingsOpen,
    setProviderSearch,
    setModelSearch,
    setModelProviderFilter,
    setModelTypeFilter,
    setModelOriginFilter,
    setModelCapabilityFilter,
    setNewModelType,
    setModelDraft,
    setCurrentCategoryKey,
    setCategoryModelSelections,
    setCategoryThinkingSelections,
    setSceneSearch,
    setSceneProviderFilter,
    setSceneCustomOnly,
    setBatchModel,
    setBatchThinking,
    setModelSelections,
    setThinkingSelections,
    setLogFilters,
    setImpactOpen,
    setConnectionOpen,
    setLogDetailOpen,
    setWorkspaceTab,
    jumpToObservability,
    loadSettings,
    loadLogs,
    handleProviderSave,
    handleProviderTest,
    handleCreateModel,
    handleOpenImpact,
    handleDeleteModel,
    handleTestModel,
    handleCategorySave,
    handleSceneSave,
    handleRestoreScene,
    handleRestoreCategoryScenes,
    handleApplyBatch,
    handleVoiceTest,
    handleOpenLogDetail,
  };
}

export type AiWorkspaceController = ReturnType<typeof useAiWorkspaceController>;
