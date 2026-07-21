import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ChangeEvent,
  DragEvent,
  KeyboardEvent,
  RefObject,
} from "react";
import { toast } from "@/shared/feedback/toast";
import { appConfirm, appPrompt } from "@/shared/components/ui/native-dialog";
import {
  createEnglishReadingMaterialApi,
  deleteEnglishReadingMaterialApi,
  generateEnglishReadingVersionStreamApi,
  getEnglishReadingMaterialApi,
  getEnglishReadingWorkspaceApi,
  getEnglishReadingVersionApi,
  updateEnglishReadingMaterialApi,
  updateEnglishReadingProfileApi,
} from "@/features/english-reading/api";
import {
  completeTask,
  dismissTask,
  failTask,
  registerTask,
  updateTask,
} from "@/shared/background-tasks/backgroundTaskRegistry";
import {
  readTimerAutomationConfig,
  shouldAutoStartOnPageEnter,
  type TimerAutomationConfig,
} from "@/shared/components/session/timer-automation-config";
import type {
  AiRuntimeOptions,
  CefrLevel,
  ReadingCompletionResponse,
  ReadingDifficultyDelta,
  ReadingDifficultyDirection,
  ReadingGenerateRequest,
  ReadingGenerateStreamStatusEvent,
  ReadingMaterial,
  ReadingProfile,
  ReadingSessionResult,
  ReadingVersion,
  ReadingWorkspaceStats,
} from "@/shared/api/contracts";
import {
  useTimedSession,
  type TimedSessionController,
} from "@/shared/hooks/useTimedSession";
import { useGlobalTimerRegistration } from "@/shared/components/session/GlobalTimerProvider";

const READING_FILE_SUFFIXES = [".txt", ".md", ".pdf"] as const;

type PromptForAiOptions = (request: {
  scenarioKey: string;
  entrypointKey: string;
  title: string;
  description?: string;
  syncScenarioKeys?: string[];
}) => Promise<AiRuntimeOptions | undefined>;

type GenerationRequest =
  | { kind: "initial" }
  | {
      kind: "regenerate";
      direction: ReadingDifficultyDirection;
      delta: ReadingDifficultyDelta;
    };

function normalizeRuntimeAiOptions(
  aiOptions: AiRuntimeOptions | undefined,
): AiRuntimeOptions | undefined {
  if (!aiOptions) return undefined;
  const model = aiOptions.model?.trim();
  const hasThinking = aiOptions.thinking_enabled !== undefined;
  if (!model && !hasThinking) {
    return undefined;
  }
  return {
    ...(model ? { model } : {}),
    ...(hasThinking ? { thinking_enabled: aiOptions.thinking_enabled } : {}),
  };
}

function getGenerationSuccessMessage(request: GenerationRequest) {
  if (request.kind === "initial") {
    return "i+1 阅读材料已生成。";
  }
  if (request.direction === "easier") {
    return "已按更简单的难度重新生成。";
  }
  if (request.direction === "harder") {
    return "已按更高的难度重新生成。";
  }
  return "已重新生成当前内容。";
}

function isSupportedReadingFile(file: File) {
  const normalizedName = file.name.trim().toLowerCase();
  return READING_FILE_SUFFIXES.some((suffix) =>
    normalizedName.endsWith(suffix),
  );
}

export function useEnglishReadingWorkflow({
  isActive,
  becameActiveAt,
  routePath,
  resolvedMaterialId,
  navigateToMaterial,
  promptForAiOptions,
}: {
  isActive: boolean;
  becameActiveAt: number;
  routePath: string;
  resolvedMaterialId: number | null;
  navigateToMaterial: (materialId: number | null) => void;
  promptForAiOptions: PromptForAiOptions;
}) {
  const [profile, setProfile] = useState<ReadingProfile | null>(null);
  const [workspaceStats, setWorkspaceStats] =
    useState<ReadingWorkspaceStats | null>(null);
  const [recentMaterials, setRecentMaterials] = useState<ReadingMaterial[]>([]);
  const [material, setMaterial] = useState<ReadingMaterial | null>(null);
  const [version, setVersion] = useState<ReadingVersion | null>(null);
  const [textInput, setTextInput] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sourceMode, setSourceMode] = useState<"text" | "file">("text");
  const [dropzoneActive, setDropzoneActive] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [versionLoading, setVersionLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState<CefrLevel | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] =
    useState<ReadingGenerateStreamStatusEvent | null>(null);
  const [completionPanelOpen, setCompletionPanelOpen] = useState(false);
  const [completionSubmitting, setCompletionSubmitting] = useState<
    ReadingSessionResult["feedback"] | null
  >(null);
  const [completionResponse, setCompletionResponse] =
    useState<ReadingCompletionResponse | null>(null);
  const [automationOpen, setAutomationOpen] = useState(false);
  const [automationConfig, setAutomationConfig] =
    useState<TimerAutomationConfig>(() => readTimerAutomationConfig());
  const [openingMaterialId, setOpeningMaterialId] = useState<number | null>(
    null,
  );
  const [renamingMaterialId, setRenamingMaterialId] = useState<number | null>(
    null,
  );
  const [deletingMaterialId, setDeletingMaterialId] = useState<number | null>(
    null,
  );
  const [regenerateDialogOpen, setRegenerateDialogOpen] = useState(false);
  const [regenerateDirection, setRegenerateDirection] =
    useState<ReadingDifficultyDirection>("same");
  const [regenerateDelta, setRegenerateDelta] =
    useState<ReadingDifficultyDelta>(0.5);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const readingPanelRef = useRef<HTMLDivElement | null>(null);
  const hardUnloadRef = useRef(false);
  const versionResetMaterialIdRef = useRef<number | null>(null);

  const timer = useTimedSession({
    kind: "practice",
    title: material ? `英语阅读 · ${material.title}` : "英语阅读",
    palaceId: null,
    automationScene: "english_reading",
    sourceKind: "english_reading",
    persistKey: material ? `english-reading:${material.id}` : null,
  });
  useGlobalTimerRegistration({
    scene: "english_reading",
    title: material ? `英语阅读 · ${material.title}` : "英语阅读",
    timer,
    isRouteActive: isActive,
    becameActiveAt,
    routePath,
  });
  const timerRef = useRef(timer);
  const activeReadingSessionKey =
    material && version && version.materialId === material.id
      ? `${material.id}:${version.id}`
      : null;
  const setTimerSceneActive = timer.setSceneActive;
  const resetTimer = timer.reset;
  const startTimer = timer.start;
  const timerStatus = timer.status;

  const loadWorkspace = useCallback(async () => {
    const nextWorkspace = await getEnglishReadingWorkspaceApi();
    setProfile(nextWorkspace.profile);
    setWorkspaceStats(nextWorkspace.stats);
    setRecentMaterials(nextWorkspace.recentMaterials);
  }, []);

  const loadMaterialAndVersion = useCallback(async (materialId: number) => {
    setVersionLoading(true);
    try {
      const nextMaterial = await getEnglishReadingMaterialApi(materialId);
      setMaterial(nextMaterial);
      try {
        const nextVersion = await getEnglishReadingVersionApi(materialId);
        setVersion(nextVersion);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "加载阅读版本失败。";
        if (!/还没有生成阅读版本/.test(message)) {
          toast.error(message);
        }
        setVersion(null);
      }
    } finally {
      setVersionLoading(false);
    }
  }, []);

  const scrollToReadingPanel = useCallback(() => {
    window.setTimeout(() => {
      if (typeof readingPanelRef.current?.scrollIntoView === "function") {
        readingPanelRef.current.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }
    }, 0);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (cancelled) return;
        await loadWorkspace();
        if (cancelled || !resolvedMaterialId) return;
        await loadMaterialAndVersion(resolvedMaterialId);
      } catch (error) {
        if (!cancelled) {
          toast.error(
            error instanceof Error ? error.message : "英语阅读加载失败。",
          );
        }
      } finally {
        if (!cancelled) {
          setPageLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadMaterialAndVersion, loadWorkspace, resolvedMaterialId]);

  useEffect(() => {
    setTimerSceneActive?.(isActive, {
      source: isActive ? "route_active" : "route_inactive",
    });
  }, [isActive, setTimerSceneActive]);

  useEffect(() => {
    timerRef.current = timer;
  }, [timer]);

  useEffect(() => {
    const markHardUnload = () => {
      hardUnloadRef.current = true;
    };

    window.addEventListener("beforeunload", markHardUnload);
    window.addEventListener("pagehide", markHardUnload);

    return () => {
      window.removeEventListener("beforeunload", markHardUnload);
      window.removeEventListener("pagehide", markHardUnload);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (hardUnloadRef.current) return;
    };
  }, [activeReadingSessionKey]);

  useEffect(() => {
    if (!version?.id) return;
    const currentMaterialId = material?.id ?? null;
    if (versionResetMaterialIdRef.current === currentMaterialId) {
      resetTimer();
      return;
    }
    versionResetMaterialIdRef.current = currentMaterialId;
    resetTimer();
    setCompletionResponse(null);
    setCompletionPanelOpen(false);
  }, [material?.id, resetTimer, version?.id]);

  useEffect(() => {
    if (!version?.id || !isActive || timerStatus !== "idle") return;
    if (
      !shouldAutoStartOnPageEnter(
        readTimerAutomationConfig(),
        "english_reading",
      )
    ) {
      return;
    }
    startTimer({ source: "english_reading_open" });
  }, [isActive, startTimer, timerStatus, version?.id]);

  const handleSelectLevel = useCallback(async (level: CefrLevel) => {
    setProfileSaving(level);
    try {
      const nextProfile = await updateEnglishReadingProfileApi({
        declaredCefr: level,
      });
      setProfile(nextProfile);
      setCompletionResponse(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新 CEFR 失败。");
    } finally {
      setProfileSaving(null);
    }
  }, []);

  const handleUseSelectedFile = useCallback((file: File | null) => {
    if (!file) return;
    if (!isSupportedReadingFile(file)) {
      toast.error("目前只支持拖入或上传 txt / md / pdf 文件。");
      return;
    }
    setSelectedFile(file);
    setSourceMode("file");
  }, []);

  const handleTextInputChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const nextValue = event.target.value;
      setTextInput(nextValue);
      if (nextValue.trim() || !selectedFile) {
        setSourceMode("text");
      }
    },
    [selectedFile],
  );

  const handleFileInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      handleUseSelectedFile(event.target.files?.[0] ?? null);
      event.target.value = "";
    },
    [handleUseSelectedFile],
  );

  const handleOpenFilePicker = useCallback(() => {
    if (generating) return;
    fileInputRef.current?.click();
  }, [generating]);

  const handleDropzoneKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      handleOpenFilePicker();
    },
    [handleOpenFilePicker],
  );

  const handleDropzoneDragEnter = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (generating) return;
      dragDepthRef.current += 1;
      setDropzoneActive(true);
    },
    [generating],
  );

  const handleDropzoneDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (generating) return;
      event.dataTransfer.dropEffect = "copy";
      setDropzoneActive(true);
    },
    [generating],
  );

  const handleDropzoneDragLeave = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (generating) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setDropzoneActive(false);
      }
    },
    [generating],
  );

  const handleDropzoneDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current = 0;
      setDropzoneActive(false);
      if (generating) return;
      handleUseSelectedFile(event.dataTransfer.files?.[0] ?? null);
    },
    [generating, handleUseSelectedFile],
  );

  const runGeneration = useCallback(
    async (request: GenerationRequest) => {
      setGenerating(true);
      const taskId = `english-reading-gen-${Date.now()}`;
      registerTask({
        id: taskId,
        section: "englishReading",
        title: "英语阅读 · 生成中",
        detail: "正在准备生成阅读稿……",
        navigateTarget: "/english/reading",
      });
      setGenerationStatus({
        stage: "queued",
        step: 1,
        totalSteps: 8,
        message: "正在准备生成阅读稿……",
      });
      try {
        const aiOptions = await promptForAiOptions({
          scenarioKey: "reading_sentence_rewrite",
          entrypointKey:
            request.kind === "initial"
              ? "english-reading-generate-initial"
              : "english-reading-generate-regenerate",
          title:
            request.kind === "initial"
              ? "英语阅读生成配置"
              : "英语阅读重新生成配置",
          syncScenarioKeys: ["reading_lexical_resolution"],
        });
        if (!aiOptions) {
          dismissTask(taskId);
          setGenerating(false);
          return;
        }
        const runtimeAiOptions = normalizeRuntimeAiOptions(aiOptions);
        let activeMaterial = material;
        if (request.kind === "initial") {
          const useFileInput = sourceMode === "file" && selectedFile;
          activeMaterial = await createEnglishReadingMaterialApi({
            text: useFileInput ? "" : textInput,
            file: useFileInput ? selectedFile : null,
          });
          setMaterial(activeMaterial);
          navigateToMaterial(activeMaterial.id);
        }
        if (!activeMaterial) {
          throw new Error("当前没有可生成的阅读材料。");
        }
        const generationPayload: ReadingGenerateRequest =
          request.kind === "initial"
            ? {
                mode: "initial",
                ...(runtimeAiOptions ? { ai_options: runtimeAiOptions } : {}),
              }
            : request.direction === "same"
              ? {
                  mode: "regenerate",
                  difficultyDirection: "same",
                  ...(runtimeAiOptions ? { ai_options: runtimeAiOptions } : {}),
                }
              : {
                  mode: "regenerate",
                  difficultyDirection: request.direction,
                  difficultyDelta: request.delta,
                  ...(runtimeAiOptions ? { ai_options: runtimeAiOptions } : {}),
                };
        const nextVersion = await generateEnglishReadingVersionStreamApi(
          activeMaterial.id,
          generationPayload,
          {
            onStatus: (event) => {
              setGenerationStatus(event);
              const total = event.totalSteps || 8;
              const progress = Math.min(
                99,
                Math.round(((event.step || 0) / total) * 100),
              );
              updateTask(taskId, {
                progress,
                detail: event.message || event.stage,
              });
            },
          },
        );
        const nextMaterial = await getEnglishReadingMaterialApi(
          activeMaterial.id,
        );
        setMaterial(nextMaterial);
        setVersion(nextVersion);
        setCompletionResponse(null);
        await loadWorkspace();
        if (request.kind === "regenerate") {
          setRegenerateDialogOpen(false);
        }
        toast.success(getGenerationSuccessMessage(request));
        completeTask(taskId, { detail: "阅读稿已生成" });
      } catch (error) {
        failTask(
          taskId,
          error instanceof Error ? error.message : "生成阅读材料失败。",
        );
        if (error === undefined || error === null) {
          dismissTask(taskId);
        }
        toast.error(
          error instanceof Error ? error.message : "生成阅读材料失败。",
        );
      } finally {
        setGenerationStatus(null);
        setGenerating(false);
      }
    },
    [
      loadWorkspace,
      material,
      navigateToMaterial,
      promptForAiOptions,
      selectedFile,
      sourceMode,
      textInput,
    ],
  );

  const handleCreateAndGenerate = useCallback(async () => {
    if (!textInput.trim() && !selectedFile) {
      toast.error("请先粘贴正文或选择 txt / md / pdf 文件。");
      return;
    }
    await runGeneration({ kind: "initial" });
  }, [runGeneration, selectedFile, textInput]);

  const handleOpenRegenerateDialog = useCallback(() => {
    if (!material) return;
    setRegenerateDirection("same");
    setRegenerateDelta(0.5);
    setRegenerateDialogOpen(true);
  }, [material]);

  const handleConfirmRegenerate = useCallback(async () => {
    if (!material) return;
    await runGeneration({
      kind: "regenerate",
      direction: regenerateDirection,
      delta: regenerateDelta,
    });
  }, [material, regenerateDelta, regenerateDirection, runGeneration]);

  const handleOpenRecentMaterial = useCallback(
    async (item: ReadingMaterial) => {
      if (openingMaterialId === item.id) return;
      setOpeningMaterialId(item.id);
      try {
        navigateToMaterial(item.id);
        await loadMaterialAndVersion(item.id);
        scrollToReadingPanel();
        if (!item.latestVersionId) {
          toast.success("这篇材料已打开，还没有阅读稿，你可以继续生成。");
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "打开阅读材料失败。",
        );
      } finally {
        setOpeningMaterialId(null);
      }
    },
    [
      loadMaterialAndVersion,
      navigateToMaterial,
      openingMaterialId,
      scrollToReadingPanel,
    ],
  );

  const handleRenameRecentMaterial = useCallback(
    async (item: ReadingMaterial) => {
      if (renamingMaterialId || deletingMaterialId) return;
      const nextTitle = (await appPrompt("Edit title", {
        title: "重命名阅读材料",
        defaultValue: item.title,
      }))?.trim();
      if (!nextTitle || nextTitle === item.title) return;
      setRenamingMaterialId(item.id);
      try {
        const updated = await updateEnglishReadingMaterialApi(item.id, {
          title: nextTitle,
        });
        setRecentMaterials((current) =>
          current.map((entry) => (entry.id === updated.id ? updated : entry)),
        );
        setMaterial((current) =>
          current?.id === updated.id ? updated : current,
        );
        toast.success("阅读材料标题已更新。");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "重命名阅读材料失败。",
        );
      } finally {
        setRenamingMaterialId(null);
      }
    },
    [deletingMaterialId, renamingMaterialId],
  );

  const handleDeleteRecentMaterial = useCallback(
    async (item: ReadingMaterial) => {
      if (deletingMaterialId || renamingMaterialId) return;
      const confirmed = await appConfirm(
        `Delete "${item.title}" from reading history?`,
        { title: "删除阅读历史", tone: "danger" },
      );
      if (!confirmed) return;
      setDeletingMaterialId(item.id);
      try {
        await deleteEnglishReadingMaterialApi(item.id);
        setRecentMaterials((current) =>
          current.filter((entry) => entry.id !== item.id),
        );
        setWorkspaceStats((current) =>
          current
            ? {
                ...current,
                totalMaterials: Math.max(0, current.totalMaterials - 1),
                generatedMaterials:
                  item.latestVersionId == null
                    ? current.generatedMaterials
                    : Math.max(0, current.generatedMaterials - 1),
              }
            : current,
        );
        if (material?.id === item.id) {
          setMaterial(null);
          setVersion(null);
          setCompletionResponse(null);
          setCompletionPanelOpen(false);
          navigateToMaterial(null);
        }
        toast.success("阅读历史已删除。");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "删除阅读历史失败。",
        );
      } finally {
        setDeletingMaterialId(null);
      }
    },
    [deletingMaterialId, material?.id, navigateToMaterial, renamingMaterialId],
  );

  return {
    profile,
    workspaceStats,
    recentMaterials,
    material,
    version,
    textInput,
    selectedFile,
    sourceMode,
    dropzoneActive,
    pageLoading,
    versionLoading,
    profileSaving,
    generating,
    generationStatus,
    completionPanelOpen,
    completionSubmitting,
    completionResponse,
    automationOpen,
    automationConfig,
    openingMaterialId,
    renamingMaterialId,
    deletingMaterialId,
    regenerateDialogOpen,
    regenerateDirection,
    regenerateDelta,
    fileInputRef,
    readingPanelRef,
    timer,
    setAutomationOpen,
    setAutomationConfig,
    setCompletionResponse,
    setCompletionPanelOpen,
    setCompletionSubmitting,
    setMaterial,
    setProfile,
    setRegenerateDialogOpen,
    setRegenerateDirection,
    setRegenerateDelta,
    handleSelectLevel,
    handleTextInputChange,
    handleFileInputChange,
    handleOpenFilePicker,
    handleDropzoneKeyDown,
    handleDropzoneDragEnter,
    handleDropzoneDragOver,
    handleDropzoneDragLeave,
    handleDropzoneDrop,
    handleCreateAndGenerate,
    handleOpenRegenerateDialog,
    handleConfirmRegenerate,
    handleOpenRecentMaterial,
    handleRenameRecentMaterial,
    handleDeleteRecentMaterial,
    loadWorkspace,
    runGeneration,
  };
}

export type EnglishReadingWorkflowController = ReturnType<
  typeof useEnglishReadingWorkflow
>;
export type EnglishReadingTimerController = TimedSessionController;
export type EnglishReadingFileInputRef = RefObject<HTMLInputElement | null>;
