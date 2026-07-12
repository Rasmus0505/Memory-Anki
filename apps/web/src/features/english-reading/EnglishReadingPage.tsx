import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
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
import type {
  CefrLevel,
  ReadingDifficultyDelta,
  ReadingSessionResult,
} from "@/shared/api/contracts";
import { useRouteResidency } from "@/shared/routing/RouteResidency";
import { PageIntro } from "@/shared/components/layout/PageIntro";
import { TimerAutomationDialog } from "@/shared/components/session/TimerAutomationDialog";
import {
  resetTimerAutomationConfig,
  saveTimerAutomationConfig,
} from "@/shared/components/session/timer-automation-config";
import { LoadingState } from "@/shared/components/state-placeholders";

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

  return (
    <div className="space-y-6">
      {aiRunConfigDialog}
      <PageIntro
        title="英语阅读"
        description="在你的舒适区外半步处，持续制造真正能读进去的 i+1 材料。"
      />

      <div className="grid gap-4 sm:grid-cols-[minmax(0,0.9fr)_minmax(320px,1.1fr)]">
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
    </div>
  );
}
