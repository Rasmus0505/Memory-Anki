import { useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BookOpenText, Library, Settings2 } from "lucide-react";
import { toast } from "@/shared/feedback/toast";
import { useAiRunConfigDialog } from "@/entities/ai-runtime";
import { completeEnglishReadingMaterialApi } from "@/features/english-reading/api";
import { EnglishReadingDialogs } from "@/features/english-reading/components/EnglishReadingDialogs";
import { EnglishReadingReadingPanels } from "@/features/english-reading/components/EnglishReadingReadingPanels";
import {
  EnglishReadingGeneratorCard,
  EnglishReadingProfileCard,
  EnglishReadingRecentMaterialsCard,
} from "@/features/english-reading/components/EnglishReadingWorkspace";
import { useEnglishReadingInteractions } from "@/features/english-reading/hooks/useEnglishReadingInteractions";
import { useEnglishReadingWorkflow } from "@/features/english-reading/hooks/useEnglishReadingWorkflow";
import { collectEnglishPatternSentenceApi } from "@/entities/english/api";
import { saveWordToVocabularyNotebook } from "@/features/english/components/EnglishVocabularyPanel";
import { EnglishFocusChrome } from "@/features/english-shell";
import type {
  CefrLevel,
  ReadingDifficultyDelta,
  ReadingSessionResult,
} from "@/shared/api/contracts";
import { useRouteResidency } from "@/shared/routing/RouteResidency";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet";
import { TimerAutomationDialog } from "@/shared/components/session/TimerAutomationDialog";
import {
  resetTimerAutomationConfig,
  saveTimerAutomationConfig,
} from "@/shared/components/session/timer-automation-config";
import { LoadingState } from "@/shared/components/state-placeholders";
import { formatDuration } from "@/entities/session/model";

const CEFR_LEVELS: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
const READING_FILE_ACCEPT =
  ".txt,.md,.pdf,text/plain,text/markdown,application/pdf";
const READING_DIFFICULTY_OPTIONS: ReadonlyArray<ReadingDifficultyDelta> = [
  0.5, 1, 1.5, 2,
];

function clampLevelIndex(index: number) {
  return Math.min(CEFR_LEVELS.length - 1, Math.max(0, index));
}

function formatWorkingBand(value: number) {
  const base = Math.floor(value);
  const safeBase = clampLevelIndex(base);
  const level = CEFR_LEVELS[safeBase];
  const offset = value - safeBase;
  if (offset >= 0.66 && safeBase < CEFR_LEVELS.length - 1) {
    return `${level}+`;
  }
  if (offset <= 0.2) {
    return level;
  }
  return `${level} 中段`;
}

function formatMinutes(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = seconds % 60;
  if (minutes <= 0) return `${remainSeconds} 秒`;
  return `${minutes} 分 ${remainSeconds} 秒`;
}

function formatDifficultyDelta(value: ReadingDifficultyDelta) {
  return value % 1 === 0 ? `${value.toFixed(1)} 级` : `${value} 级`;
}

function summarizeFeedback(feedback: ReadingSessionResult["feedback"]) {
  if (feedback === "too_easy") return "太简单";
  if (feedback === "too_hard") return "有点难";
  return "刚刚好";
}

export default function EnglishReadingPage() {
  const { isActive, becameActiveAt, fullPath } = useRouteResidency();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentMaterialId = Number(searchParams.get("material") || "");
  const resolvedMaterialId =
    Number.isFinite(currentMaterialId) && currentMaterialId > 0
      ? currentMaterialId
      : null;
  const { promptForAiOptions, aiRunConfigDialog } = useAiRunConfigDialog();
  const [libraryToolsOpen, setLibraryToolsOpen] = useState(false);
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [savingVocabulary, setSavingVocabulary] = useState(false);
  const [savingPattern, setSavingPattern] = useState(false);

  const workflow = useEnglishReadingWorkflow({
    isActive,
    becameActiveAt,
    routePath: fullPath,
    resolvedMaterialId,
    setSearchParams,
    promptForAiOptions,
  });
  const interactions = useEnglishReadingInteractions({
    isActive,
    materialId: workflow.material?.id ?? null,
    versionId: workflow.version?.id ?? null,
    timer: workflow.timer,
    promptForAiOptions,
  });

  const annotationMap = useMemo(
    () =>
      new Map(
        (workflow.version?.spanAnnotations ?? []).map((item) => [item.id, item]),
      ),
    [workflow.version?.spanAnnotations],
  );
  const sentenceAnnotationMap = useMemo(
    () =>
      new Map(
        (workflow.version?.sentenceAnnotations ?? []).map((item) => [
          item.id,
          item,
        ]),
      ),
    [workflow.version?.sentenceAnnotations],
  );

  const handleCompleteReading = useCallback(
    async (feedback: ReadingSessionResult["feedback"]) => {
      if (!workflow.material || !workflow.version) return;
      workflow.setCompletionSubmitting(feedback);
      try {
        await workflow.timer.complete("manual_complete", {
          source: "english_reading_complete",
        });
        const response = await completeEnglishReadingMaterialApi(
          workflow.material.id,
          {
            versionId: workflow.version.id,
            feedback,
            durationSeconds: Math.max(1, workflow.timer.effectiveSeconds),
            hoverCount: interactions.hoveredAnnotationCount,
            expandCount: interactions.expandedSentenceCount,
          },
        );
        workflow.setCompletionResponse(response);
        workflow.setProfile(response.profile);
        workflow.setMaterial(response.material);
        workflow.setCompletionPanelOpen(true);
        await workflow.loadWorkspace();
        toast.success("阅读反馈已保存。");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "保存阅读反馈失败。",
        );
      } finally {
        workflow.setCompletionSubmitting(null);
      }
    },
    [interactions, workflow],
  );

  const handleSaveVocabulary = useCallback(async () => {
    const panel = interactions.dictionaryPanel;
    if (!panel?.entry) return;
    setSavingVocabulary(true);
    try {
      const definitionZh =
        panel.entry.summaryZh.join("；") ||
        panel.entry.senses[0]?.definitionZh ||
        panel.entry.senses[0]?.definition ||
        "";
      await saveWordToVocabularyNotebook({
        word: panel.entry.word || panel.queryWord,
        definitionZh,
        materialId: workflow.material?.id ?? null,
        versionId: workflow.version?.id ?? null,
      });
      toast.success("已加入生词本。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加入生词本失败。");
    } finally {
      setSavingVocabulary(false);
    }
  }, [interactions.dictionaryPanel, workflow.material?.id, workflow.version?.id]);

  const handleSaveToPattern = useCallback(async () => {
    const panel = interactions.sentenceTranslationPanel;
    if (!panel?.originalText?.trim()) return;
    setSavingPattern(true);
    try {
      const result = await collectEnglishPatternSentenceApi({
        patternTitle: workflow.material?.title
          ? `${workflow.material.title} · 阅读摘句`
          : "阅读摘句",
        textEn: panel.originalText,
        textZh: panel.translatedText || "",
        source: "from_reading",
        sourceMaterialId: workflow.material?.id ?? null,
        sourceVersionId: workflow.version?.id ?? null,
      });
      toast.success(`已加入句模「${result.pattern.title}」`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加入句模失败。");
    } finally {
      setSavingPattern(false);
    }
  }, [
    interactions.sentenceTranslationPanel,
    workflow.material?.id,
    workflow.material?.title,
    workflow.version?.id,
  ]);

  if (workflow.pageLoading || !workflow.profile) {
    return <LoadingState text="正在加载英语阅读…" />;
  }

  const visibleStage = workflow.generationStatus?.message || "正在准备生成阅读稿……";
  const generationProgress =
    workflow.generationStatus && workflow.generationStatus.totalSteps > 0
      ? Math.min(
          100,
          Math.max(
            8,
            (workflow.generationStatus.step /
              workflow.generationStatus.totalSteps) *
              100,
          ),
        )
      : 8;

  const isReaderMode = Boolean(workflow.material && workflow.version);
  const isPendingMaterial = Boolean(workflow.material && !workflow.version && !workflow.versionLoading);

  const libraryTools = (
    <>
      <div className="space-y-4">
        <EnglishReadingProfileCard
          cefrLevels={CEFR_LEVELS}
          profile={workflow.profile}
          profileSaving={workflow.profileSaving}
          onSelectLevel={(level) => void workflow.handleSelectLevel(level)}
          formatWorkingBand={formatWorkingBand}
        />
        <EnglishReadingGeneratorCard
          textInput={workflow.textInput}
          onTextInputChange={workflow.handleTextInputChange}
          fileInputRef={workflow.fileInputRef}
          readingFileAccept={READING_FILE_ACCEPT}
          dropzoneActive={workflow.dropzoneActive}
          generating={workflow.generating}
          selectedFile={workflow.selectedFile}
          sourceMode={workflow.sourceMode}
          visibleStage={visibleStage}
          generationProgress={generationProgress}
          onOpenAutomation={() => workflow.setAutomationOpen(true)}
          onOpenFilePicker={workflow.handleOpenFilePicker}
          onDropzoneKeyDown={workflow.handleDropzoneKeyDown}
          onDropzoneDragEnter={workflow.handleDropzoneDragEnter}
          onDropzoneDragOver={workflow.handleDropzoneDragOver}
          onDropzoneDragLeave={workflow.handleDropzoneDragLeave}
          onDropzoneDrop={workflow.handleDropzoneDrop}
          onFileInputChange={workflow.handleFileInputChange}
          onCreateAndGenerate={() => void workflow.handleCreateAndGenerate()}
        />
      </div>
    </>
  );

  const readingPanels = (
    <EnglishReadingReadingPanels
      versionLoading={workflow.versionLoading}
      material={workflow.material}
      version={workflow.version}
      readingPanelRef={workflow.readingPanelRef}
      readingContentRef={interactions.readingContentRef}
      generating={workflow.generating}
      timer={workflow.timer}
      annotationMap={annotationMap}
      sentenceAnnotationMap={sentenceAnnotationMap}
      expandedSentenceIds={interactions.expandedSentenceIds}
      completionPanelOpen={workflow.completionPanelOpen}
      completionSubmitting={workflow.completionSubmitting}
      completionResponse={workflow.completionResponse}
      onGeneratePendingMaterial={() =>
        void workflow.runGeneration({
          kind: "regenerate",
          direction: "same",
          delta: 0.5,
        })
      }
      onOpenRegenerateDialog={workflow.handleOpenRegenerateDialog}
      onReadingContentPointerDown={interactions.handleReadingContentPointerDown}
      onHoverAnnotation={interactions.handleAnnotationHover}
      onLookupWord={interactions.handleLookupWord}
      onToggleExpandedSentence={interactions.handleToggleExpandedSentence}
      onToggleCompletionPanel={() =>
        workflow.setCompletionPanelOpen((current) => !current)
      }
      onCompleteReading={(feedback) => void handleCompleteReading(feedback)}
      formatMinutes={formatMinutes}
      summarizeFeedback={summarizeFeedback}
    />
  );

  const dialogs = (
    <>
      <EnglishReadingDialogs
        sentenceTranslationTrigger={interactions.sentenceTranslationTrigger}
        sentenceTranslationTriggerRef={interactions.sentenceTranslationTriggerRef}
        onConfirmSentenceTranslation={interactions.handleConfirmSentenceTranslation}
        dictionaryPanel={interactions.dictionaryPanel}
        dictionaryPanelRef={interactions.dictionaryPanelRef}
        onCloseDictionaryPanel={() => interactions.setDictionaryPanel(null)}
        onDictionaryHeaderPointerDown={
          interactions.handleDictionaryHeaderPointerDown
        }
        onDictionaryHeaderMouseDown={interactions.handleDictionaryHeaderMouseDown}
        onToggleDictionaryPin={interactions.handleToggleDictionaryPin}
        playDictionaryPronunciation={interactions.playDictionaryPronunciation}
        supportsSpeechSynthesis={interactions.supportsSpeechSynthesis}
        onSaveVocabulary={() => void handleSaveVocabulary()}
        savingVocabulary={savingVocabulary}
        onSaveToPattern={() => void handleSaveToPattern()}
        savingPattern={savingPattern}
        sentenceTranslationPanel={interactions.sentenceTranslationPanel}
        sentenceTranslationPanelRef={interactions.sentenceTranslationPanelRef}
        onCloseSentenceTranslationPanel={() =>
          interactions.setSentenceTranslationPanel(null)
        }
        onSentenceTranslationHeaderPointerDown={
          interactions.handleSentenceTranslationHeaderPointerDown
        }
        onSentenceTranslationHeaderMouseDown={
          interactions.handleSentenceTranslationHeaderMouseDown
        }
        onToggleSentenceTranslationPin={
          interactions.handleToggleSentenceTranslationPin
        }
        onLookupWord={interactions.handleLookupWord}
        regenerateDialogOpen={workflow.regenerateDialogOpen}
        generating={workflow.generating}
        regenerateDirection={workflow.regenerateDirection}
        regenerateDelta={workflow.regenerateDelta}
        readingDifficultyOptions={READING_DIFFICULTY_OPTIONS}
        onCloseRegenerateDialog={() => workflow.setRegenerateDialogOpen(false)}
        onSetRegenerateDirection={workflow.setRegenerateDirection}
        onSetRegenerateDelta={workflow.setRegenerateDelta}
        onConfirmRegenerate={() => void workflow.handleConfirmRegenerate()}
        formatDifficultyDelta={formatDifficultyDelta}
      />

      <TimerAutomationDialog
        open={workflow.automationOpen}
        config={workflow.automationConfig}
        onOpenChange={workflow.setAutomationOpen}
        onSave={(nextConfig) => {
          workflow.setAutomationConfig(saveTimerAutomationConfig(nextConfig));
        }}
        onReset={() => {
          workflow.setAutomationConfig(resetTimerAutomationConfig());
        }}
      />
    </>
  );

  if (isReaderMode || isPendingMaterial) {
    return (
      <div
        className="flex min-h-[calc(100dvh-3rem)] flex-col"
        data-testid="english-reading-reader-mode"
      >
        {aiRunConfigDialog}
        <EnglishFocusChrome
          backTo="/english?tab=reading"
          backLabel="返回英语阅读"
          title={workflow.material?.title || "英语阅读"}
          subtitle={
            workflow.version ? (
              <span className="inline-flex flex-wrap items-center gap-2">
                <span>目标 {workflow.version.targetCefr}</span>
                <span>·</span>
                <span>{formatDuration(workflow.timer.effectiveSeconds)}</span>
              </span>
            ) : (
              "尚未生成阅读稿"
            )
          }
          trailing={
            <>
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl"
                onClick={() => setMaterialsOpen(true)}
              >
                <Library className="size-4" />
                材料
              </Button>
              {workflow.version ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  onClick={workflow.handleOpenRegenerateDialog}
                  disabled={workflow.generating}
                >
                  重新生成
                </Button>
              ) : null}
            </>
          }
        />
        <div className="mx-auto w-full max-w-4xl flex-1 px-3 py-4 sm:px-6 sm:py-6">
          {readingPanels}
        </div>

        <Sheet open={materialsOpen} onOpenChange={setMaterialsOpen}>
          <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
            <SheetHeader>
              <SheetTitle>切换材料</SheetTitle>
              <SheetDescription>选择另一篇阅读材料，不会强制结束当前计时场景。</SheetDescription>
            </SheetHeader>
            <div className="mt-4">
              <EnglishReadingRecentMaterialsCard
                recentMaterials={workflow.recentMaterials}
                activeMaterialId={workflow.material?.id}
                openingMaterialId={workflow.openingMaterialId}
                renamingMaterialId={workflow.renamingMaterialId}
                deletingMaterialId={workflow.deletingMaterialId}
                onOpenRecentMaterial={(item) => {
                  setMaterialsOpen(false);
                  void workflow.handleOpenRecentMaterial(item);
                }}
                onRenameRecentMaterial={(item) =>
                  void workflow.handleRenameRecentMaterial(item)
                }
                onDeleteRecentMaterial={(item) =>
                  void workflow.handleDeleteRecentMaterial(item)
                }
              />
            </div>
          </SheetContent>
        </Sheet>
        {dialogs}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5" data-testid="english-reading-library-mode">
      {aiRunConfigDialog}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-info">
            <BookOpenText className="size-3.5" />
            Reading
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">英语阅读</h1>
          <p className="max-w-xl text-sm leading-6 text-muted-foreground">
            在舒适区外半步处，持续制造真正能读进去的 i+1 材料。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className="rounded-xl">
            <Link to="/english?tab=reading">返回英语区</Link>
          </Button>
          <Button
            variant="outline"
            className="rounded-xl sm:hidden"
            onClick={() => setLibraryToolsOpen(true)}
          >
            <Settings2 className="size-4" />
            等级与生成
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">CEFR {workflow.profile.declaredCefr}</Badge>
        <Badge variant="outline">材料 {workflow.recentMaterials.length}</Badge>
        <Badge variant="outline">
          今日{" "}
          {formatDuration(workflow.workspaceStats?.todayReadingSeconds ?? 0)}
        </Badge>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="hidden space-y-4 sm:block">{libraryTools}</div>
        <div className="space-y-4">
          <EnglishReadingRecentMaterialsCard
            recentMaterials={workflow.recentMaterials}
            activeMaterialId={workflow.material?.id}
            openingMaterialId={workflow.openingMaterialId}
            renamingMaterialId={workflow.renamingMaterialId}
            deletingMaterialId={workflow.deletingMaterialId}
            onOpenRecentMaterial={(item) =>
              void workflow.handleOpenRecentMaterial(item)
            }
            onRenameRecentMaterial={(item) =>
              void workflow.handleRenameRecentMaterial(item)
            }
            onDeleteRecentMaterial={(item) =>
              void workflow.handleDeleteRecentMaterial(item)
            }
          />
          {readingPanels}
        </div>
      </div>

      <Sheet open={libraryToolsOpen} onOpenChange={setLibraryToolsOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-3xl">
          <SheetHeader>
            <SheetTitle>等级与生成</SheetTitle>
            <SheetDescription>设置 CEFR，并导入或粘贴新材料。</SheetDescription>
          </SheetHeader>
          <div className="mt-4">{libraryTools}</div>
        </SheetContent>
      </Sheet>

      {dialogs}
    </div>
  );
}
