import { useCallback, useEffect, useRef, useState } from "react";
import { useEnglishReadingDictionaryInteractions } from "@/features/english-reading/hooks/useEnglishReadingDictionaryInteractions";
import { useEnglishReadingSentenceTranslationInteractions } from "@/features/english-reading/hooks/useEnglishReadingSentenceTranslationInteractions";
import type { AiRuntimeOptions } from "@/shared/api/contracts";
import type { EnglishReadingTimerController } from "@/features/english-reading/hooks/useEnglishReadingWorkflow";

type PromptForAiOptions = (request: {
  scenarioKey: string;
  entrypointKey: string;
  title: string;
  description?: string;
  syncScenarioKeys?: string[];
}) => Promise<AiRuntimeOptions | undefined>;

export function useEnglishReadingInteractions({
  isActive,
  materialId,
  versionId,
  timer,
  promptForAiOptions,
}: {
  isActive: boolean;
  materialId: number | null;
  versionId: number | null;
  timer: EnglishReadingTimerController;
  promptForAiOptions: PromptForAiOptions;
}) {
  const [hoveredAnnotationIds, setHoveredAnnotationIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedSentenceIds, setExpandedSentenceIds] = useState<Set<string>>(
    () => new Set(),
  );
  const versionResetMaterialIdRef = useRef<number | null>(null);

  const dictionary = useEnglishReadingDictionaryInteractions({
    isActive,
    timer,
  });
  const sentenceTranslation = useEnglishReadingSentenceTranslationInteractions({
    isActive,
    timer,
    promptForAiOptions,
    dictionaryPanelRef: dictionary.dictionaryPanelRef,
  });
  const resetDictionaryInteractions = dictionary.resetDictionaryInteractions;
  const resetSentenceTranslationInteractions =
    sentenceTranslation.resetSentenceTranslationInteractions;

  useEffect(() => {
    if (!versionId) return;
    if (versionResetMaterialIdRef.current === materialId) {
      return;
    }
    versionResetMaterialIdRef.current = materialId;
    setHoveredAnnotationIds(new Set());
    setExpandedSentenceIds(new Set());
    resetDictionaryInteractions();
    resetSentenceTranslationInteractions();
  }, [
    materialId,
    resetDictionaryInteractions,
    resetSentenceTranslationInteractions,
    versionId,
  ]);

  const handleAnnotationHover = useCallback(
    (annotationId: string) => {
      setHoveredAnnotationIds((current) => {
        if (current.has(annotationId)) return current;
        const next = new Set(current);
        next.add(annotationId);
        return next;
      });
      timer.registerActivity("practice_interaction", {
        source: "english_reading_hover",
      });
    },
    [timer],
  );

  const handleToggleExpandedSentence = useCallback(
    (sentenceId: string) => {
      setExpandedSentenceIds((current) => {
        const next = new Set(current);
        if (next.has(sentenceId)) {
          next.delete(sentenceId);
        } else {
          next.add(sentenceId);
        }
        return next;
      });
      timer.registerActivity("practice_interaction", {
        source: "english_reading_expand",
      });
    },
    [timer],
  );

  return {
    readingContentRef: sentenceTranslation.readingContentRef,
    dictionaryPanelRef: dictionary.dictionaryPanelRef,
    sentenceTranslationTriggerRef:
      sentenceTranslation.sentenceTranslationTriggerRef,
    sentenceTranslationPanelRef: sentenceTranslation.sentenceTranslationPanelRef,
    hoveredAnnotationIds,
    expandedSentenceIds,
    hoveredAnnotationCount: hoveredAnnotationIds.size,
    expandedSentenceCount: expandedSentenceIds.size,
    dictionaryPanel: dictionary.dictionaryPanel,
    sentenceTranslationTrigger: sentenceTranslation.sentenceTranslationTrigger,
    sentenceTranslationPanel: sentenceTranslation.sentenceTranslationPanel,
    supportsSpeechSynthesis: dictionary.supportsSpeechSynthesis,
    setDictionaryPanel: dictionary.setDictionaryPanel,
    setSentenceTranslationPanel: sentenceTranslation.setSentenceTranslationPanel,
    handleAnnotationHover,
    handleToggleExpandedSentence,
    playDictionaryPronunciation: dictionary.playDictionaryPronunciation,
    handleLookupWord: dictionary.handleLookupWord,
    handleConfirmSentenceTranslation:
      sentenceTranslation.handleConfirmSentenceTranslation,
    handleToggleDictionaryPin: dictionary.handleToggleDictionaryPin,
    handleDictionaryHeaderPointerDown:
      dictionary.handleDictionaryHeaderPointerDown,
    handleDictionaryHeaderMouseDown:
      dictionary.handleDictionaryHeaderMouseDown,
    handleReadingContentPointerDown:
      sentenceTranslation.handleReadingContentPointerDown,
    handleToggleSentenceTranslationPin:
      sentenceTranslation.handleToggleSentenceTranslationPin,
    handleSentenceTranslationHeaderPointerDown:
      sentenceTranslation.handleSentenceTranslationHeaderPointerDown,
    handleSentenceTranslationHeaderMouseDown:
      sentenceTranslation.handleSentenceTranslationHeaderMouseDown,
  };
}
