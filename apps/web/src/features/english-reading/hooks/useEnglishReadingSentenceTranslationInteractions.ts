import { useCallback, useEffect, useRef, useState } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";
import { translateEnglishReadingSentenceApi } from "@/features/english-reading/api";
import {
  extractSentenceSelection,
  resolveSentenceTranslationPanelLeft,
  resolveSentenceTranslationPanelMaxHeight,
  resolveSentenceTranslationPanelPosition,
  resolveSentenceTranslationPanelTop,
  resolveSentenceTranslationTriggerPosition,
  SENTENCE_TRANSLATION_LONG_PRESS_MOVE_TOLERANCE_PX,
  SENTENCE_TRANSLATION_LONG_PRESS_MS,
  type SentenceSelectionPayload,
  type SentenceTranslationPanelState,
  type SentenceTranslationTriggerState,
} from "@/features/english-reading/model/englishReadingInteractions";
import type {
  AiRuntimeOptions,
  ReadingSentenceTranslationResponse,
} from "@/shared/api/contracts";
import type { EnglishReadingTimerController } from "@/features/english-reading/hooks/useEnglishReadingWorkflow";
import { usePinnedPanelDrag } from "@/features/english-reading/hooks/usePinnedPanelDrag";
import type { PinnedPanelDragState } from "@/features/english-reading/hooks/usePinnedPanelDrag";

type PromptForAiOptions = (request: {
  scenarioKey: string;
  entrypointKey: string;
  title: string;
  description?: string;
  syncScenarioKeys?: string[];
}) => Promise<AiRuntimeOptions | undefined>;

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

export function useEnglishReadingSentenceTranslationInteractions({
  isActive,
  timer,
  promptForAiOptions,
  dictionaryPanelRef,
}: {
  isActive: boolean;
  timer: EnglishReadingTimerController;
  promptForAiOptions: PromptForAiOptions;
  dictionaryPanelRef: RefObject<HTMLDivElement | null>;
}) {
  const [sentenceTranslationTrigger, setSentenceTranslationTrigger] =
    useState<SentenceTranslationTriggerState | null>(null);
  const [sentenceTranslationPanel, setSentenceTranslationPanel] =
    useState<SentenceTranslationPanelState | null>(null);

  const readingContentRef = useRef<HTMLDivElement | null>(null);
  const sentenceTranslationTriggerRef = useRef<HTMLButtonElement | null>(null);
  const sentenceTranslationPanelRef = useRef<HTMLDivElement | null>(null);
  const sentenceTranslationCacheRef = useRef<
    Map<string, ReadingSentenceTranslationResponse>
  >(new Map());
  const sentenceTranslationRequestTokenRef = useRef(0);
  const sentenceTranslationDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originLeft: number;
    originTop: number;
  } | null>(null);
  const sentenceSelectionGestureRef = useRef<{
    pointerId: number | null;
    startX: number;
    startY: number;
    longPressReady: boolean;
    movedTooFar: boolean;
    timerId: number | null;
  } | null>(null);

  useEffect(() => {
    return () => {
      const gesture = sentenceSelectionGestureRef.current;
      if (gesture?.timerId != null) {
        window.clearTimeout(gesture.timerId);
      }
    };
  }, []);

  useEffect(() => {
    if (isActive) return;
    sentenceTranslationDragRef.current = null;
    setSentenceTranslationPanel((current) =>
      current ? { ...current, dragging: false } : current,
    );
  }, [isActive]);

  useEffect(() => {
    if (!isActive || !sentenceTranslationTrigger) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (sentenceTranslationTriggerRef.current?.contains(target)) return;
      if (sentenceTranslationPanelRef.current?.contains(target)) return;
      if (dictionaryPanelRef.current?.contains(target)) return;
      if (
        target instanceof HTMLElement &&
        target.closest("[data-reading-word='true']")
      ) {
        return;
      }
      setSentenceTranslationTrigger(null);
    };
    const handleViewportChange = () => {
      setSentenceTranslationTrigger(null);
    };
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("resize", handleViewportChange);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("resize", handleViewportChange);
    };
  }, [dictionaryPanelRef, isActive, sentenceTranslationTrigger]);

  useEffect(() => {
    if (!isActive || !sentenceTranslationPanel) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (sentenceTranslationPanelRef.current?.contains(target)) return;
      if (sentenceTranslationTriggerRef.current?.contains(target)) return;
      if (dictionaryPanelRef.current?.contains(target)) return;
      if (
        target instanceof HTMLElement &&
        target.closest("[data-reading-word='true']")
      ) {
        return;
      }
      if (sentenceTranslationPanel.pinned) return;
      setSentenceTranslationPanel(null);
    };
    const handleViewportChange = () => {
      setSentenceTranslationPanel((current) => {
        if (!current) return current;
        if (!current.pinned) return null;
        const nextTop = resolveSentenceTranslationPanelTop(current.top);
        return {
          ...current,
          width: current.width,
          left: resolveSentenceTranslationPanelLeft(current.left, current.width),
          top: nextTop,
          maxHeight: resolveSentenceTranslationPanelMaxHeight(nextTop),
        };
      });
    };
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("resize", handleViewportChange);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("resize", handleViewportChange);
    };
  }, [dictionaryPanelRef, isActive, sentenceTranslationPanel]);

  const updateSentenceTranslationDraggingPosition = useCallback(
    (clientX: number, clientY: number, dragState: PinnedPanelDragState) => {
      if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
      const width = sentenceTranslationPanel?.width ?? 0;
      const nextLeft = resolveSentenceTranslationPanelLeft(
        dragState.originLeft + (clientX - dragState.startX),
        width,
      );
      const nextTop = resolveSentenceTranslationPanelTop(
        dragState.originTop + (clientY - dragState.startY),
      );
      setSentenceTranslationPanel((current) =>
        current
          ? {
              ...current,
              left: nextLeft,
              top: nextTop,
              maxHeight: resolveSentenceTranslationPanelMaxHeight(nextTop),
            }
          : current,
      );
    },
    [sentenceTranslationPanel?.width],
  );
  const stopSentenceTranslationDragging = useCallback(() => {
    setSentenceTranslationPanel((current) =>
      current ? { ...current, dragging: false } : current,
    );
  }, []);
  usePinnedPanelDrag({
    active: isActive && Boolean(sentenceTranslationPanel?.dragging),
    dragRef: sentenceTranslationDragRef,
    onMove: updateSentenceTranslationDraggingPosition,
    onStop: stopSentenceTranslationDragging,
  });

  const resetSentenceTranslationInteractions = useCallback(() => {
    setSentenceTranslationTrigger(null);
    setSentenceTranslationPanel(null);
    sentenceTranslationCacheRef.current.clear();
    sentenceTranslationRequestTokenRef.current += 1;
    sentenceTranslationDragRef.current = null;
    const gesture = sentenceSelectionGestureRef.current;
    if (gesture?.timerId != null) {
      window.clearTimeout(gesture.timerId);
    }
    sentenceSelectionGestureRef.current = null;
  }, []);

  const handleOpenSentenceTranslation = useCallback(
    async (payload: SentenceSelectionPayload) => {
      setSentenceTranslationTrigger(null);
      timer.registerActivity("practice_interaction", {
        source: "sentence_translation",
      });
      const nextPosition =
        sentenceTranslationPanel?.pinned && sentenceTranslationPanel
          ? {
              left: sentenceTranslationPanel.left,
              top: sentenceTranslationPanel.top,
              width: sentenceTranslationPanel.width,
              maxHeight: sentenceTranslationPanel.maxHeight,
            }
          : resolveSentenceTranslationPanelPosition(payload.rect);
      const cachedTranslation =
        sentenceTranslationCacheRef.current.get(payload.cacheKey) ?? null;
      if (cachedTranslation) {
        setSentenceTranslationPanel({
          ...nextPosition,
          pinned: sentenceTranslationPanel?.pinned ?? false,
          dragging: false,
          loading: false,
          error: null,
          cacheKey: payload.cacheKey,
          originalText: cachedTranslation.originalText,
          translatedText: cachedTranslation.translatedText,
          resolvedAi: cachedTranslation.resolved_ai,
        });
        return;
      }

      const requestToken = sentenceTranslationRequestTokenRef.current + 1;
      sentenceTranslationRequestTokenRef.current = requestToken;
      setSentenceTranslationPanel({
        ...nextPosition,
        pinned: sentenceTranslationPanel?.pinned ?? false,
        dragging: false,
        loading: true,
        error: null,
        cacheKey: payload.cacheKey,
        originalText: payload.originalText,
        translatedText: "",
        resolvedAi: null,
      });

      try {
        const aiOptions = await promptForAiOptions({
          scenarioKey: "translation_reading_sentence",
          entrypointKey: "english-reading-sentence-translation",
          title: "英语句子翻译配置",
        });
        if (!aiOptions) {
          if (sentenceTranslationRequestTokenRef.current !== requestToken) return;
          setSentenceTranslationPanel(null);
          return;
        }
        const runtimeAiOptions = normalizeRuntimeAiOptions(aiOptions);
        const response = runtimeAiOptions
          ? await translateEnglishReadingSentenceApi(
              payload.originalText,
              runtimeAiOptions,
            )
          : await translateEnglishReadingSentenceApi(payload.originalText);
        sentenceTranslationCacheRef.current.set(payload.cacheKey, response);
        if (sentenceTranslationRequestTokenRef.current !== requestToken) return;
        setSentenceTranslationPanel((current) => {
          const pinned =
            current?.pinned ?? sentenceTranslationPanel?.pinned ?? false;
          const resolvedPosition =
            pinned && current
              ? {
                  left: current.left,
                  top: current.top,
                  width: current.width,
                  maxHeight: current.maxHeight,
                }
              : nextPosition;
          return {
            ...resolvedPosition,
            pinned,
            dragging: false,
            loading: false,
            error: null,
            cacheKey: payload.cacheKey,
            originalText: response.originalText,
            translatedText: response.translatedText,
            resolvedAi: response.resolved_ai,
          };
        });
      } catch (error) {
        if (sentenceTranslationRequestTokenRef.current !== requestToken) return;
        setSentenceTranslationPanel((current) => {
          const pinned =
            current?.pinned ?? sentenceTranslationPanel?.pinned ?? false;
          const resolvedPosition =
            pinned && current
              ? {
                  left: current.left,
                  top: current.top,
                  width: current.width,
                  maxHeight: current.maxHeight,
                }
              : nextPosition;
          return {
            ...resolvedPosition,
            pinned,
            dragging: false,
            loading: false,
            error:
              error instanceof Error ? error.message : "句子翻译失败，请重试。",
            cacheKey: payload.cacheKey,
            originalText: payload.originalText,
            translatedText: "",
            resolvedAi: null,
          };
        });
      }
    },
    [promptForAiOptions, sentenceTranslationPanel, timer],
  );

  const handleConfirmSentenceTranslation = useCallback(() => {
    const trigger = sentenceTranslationTrigger;
    if (!trigger) return;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    void handleOpenSentenceTranslation(trigger.payload);
  }, [handleOpenSentenceTranslation, sentenceTranslationTrigger]);

  const handleReadingContentPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (typeof event.button === "number" && event.button > 0) return;
      setSentenceTranslationTrigger(null);
      const existingGesture = sentenceSelectionGestureRef.current;
      if (existingGesture?.timerId != null) {
        window.clearTimeout(existingGesture.timerId);
      }
      const pointerId =
        typeof event.pointerId === "number" && event.pointerId > 0
          ? event.pointerId
          : null;
      sentenceSelectionGestureRef.current = {
        pointerId,
        startX: event.clientX,
        startY: event.clientY,
        longPressReady: false,
        movedTooFar: false,
        timerId: window.setTimeout(() => {
          if (!sentenceSelectionGestureRef.current) return;
          sentenceSelectionGestureRef.current.longPressReady = true;
        }, SENTENCE_TRANSLATION_LONG_PRESS_MS),
      };
    },
    [],
  );

  const handleToggleSentenceTranslationPin = useCallback(() => {
    setSentenceTranslationPanel((current) =>
      current
        ? {
            ...current,
            pinned: !current.pinned,
            dragging: false,
          }
        : current,
    );
  }, []);

  const beginSentenceTranslationDragging = useCallback(
    (startX: number, startY: number, pointerId: number) => {
      if (!sentenceTranslationPanel?.pinned) return;
      if (!Number.isFinite(startX) || !Number.isFinite(startY)) return;
      sentenceTranslationDragRef.current = {
        pointerId,
        startX,
        startY,
        originLeft: sentenceTranslationPanel.left,
        originTop: sentenceTranslationPanel.top,
      };
      document.body.style.userSelect = "none";
      setSentenceTranslationPanel((current) =>
        current ? { ...current, dragging: true } : current,
      );
    },
    [sentenceTranslationPanel],
  );

  const handleSentenceTranslationHeaderPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!sentenceTranslationPanel?.pinned) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("button")
      ) {
        return;
      }
      event.preventDefault();
      beginSentenceTranslationDragging(
        event.clientX,
        event.clientY,
        event.pointerId,
      );
    },
    [beginSentenceTranslationDragging, sentenceTranslationPanel?.pinned],
  );

  const handleSentenceTranslationHeaderMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!sentenceTranslationPanel?.pinned) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("button")
      ) {
        return;
      }
      event.preventDefault();
      beginSentenceTranslationDragging(event.clientX, event.clientY, -1);
    },
    [beginSentenceTranslationDragging, sentenceTranslationPanel?.pinned],
  );

  useEffect(() => {
    if (!isActive) return;
    const clearSentenceSelectionGesture = () => {
      const gesture = sentenceSelectionGestureRef.current;
      if (!gesture) return;
      if (gesture.timerId != null) {
        window.clearTimeout(gesture.timerId);
      }
      sentenceSelectionGestureRef.current = null;
    };
    const showSentenceTranslationTriggerFromSelection = () => {
      window.setTimeout(() => {
        const payload = extractSentenceSelection(readingContentRef.current);
        if (!payload) {
          setSentenceTranslationTrigger(null);
          return;
        }
        const nextPosition = resolveSentenceTranslationTriggerPosition(
          payload.rect,
        );
        setSentenceTranslationTrigger({
          ...nextPosition,
          payload,
        });
      }, 0);
    };
    const trackSentenceSelection = (event: PointerEvent) => {
      const gesture = sentenceSelectionGestureRef.current;
      const pointerId =
        typeof event.pointerId === "number" && event.pointerId > 0
          ? event.pointerId
          : null;
      if (!gesture) return;
      if (
        pointerId != null &&
        gesture.pointerId != null &&
        pointerId !== gesture.pointerId
      ) {
        return;
      }
      const distance = Math.hypot(
        event.clientX - gesture.startX,
        event.clientY - gesture.startY,
      );
      if (distance <= SENTENCE_TRANSLATION_LONG_PRESS_MOVE_TOLERANCE_PX) {
        return;
      }
      gesture.movedTooFar = true;
    };
    const finishSentenceSelection = (event: PointerEvent) => {
      const gesture = sentenceSelectionGestureRef.current;
      const pointerId =
        typeof event.pointerId === "number" && event.pointerId > 0
          ? event.pointerId
          : null;
      if (!gesture) return;
      if (
        pointerId != null &&
        gesture.pointerId != null &&
        pointerId !== gesture.pointerId
      ) {
        return;
      }
      clearSentenceSelectionGesture();
      showSentenceTranslationTriggerFromSelection();
    };
    const cancelSentenceSelection = (event: PointerEvent) => {
      const gesture = sentenceSelectionGestureRef.current;
      const pointerId =
        typeof event.pointerId === "number" && event.pointerId > 0
          ? event.pointerId
          : null;
      if (!gesture) return;
      if (
        pointerId != null &&
        gesture.pointerId != null &&
        pointerId !== gesture.pointerId
      ) {
        return;
      }
      clearSentenceSelectionGesture();
    };
    document.addEventListener("pointermove", trackSentenceSelection);
    document.addEventListener("pointerup", finishSentenceSelection);
    document.addEventListener("pointercancel", cancelSentenceSelection);
    return () => {
      document.removeEventListener("pointermove", trackSentenceSelection);
      document.removeEventListener("pointerup", finishSentenceSelection);
      document.removeEventListener("pointercancel", cancelSentenceSelection);
    };
  }, [isActive]);

  return {
    readingContentRef,
    sentenceTranslationTriggerRef,
    sentenceTranslationPanelRef,
    sentenceTranslationTrigger,
    sentenceTranslationPanel,
    setSentenceTranslationPanel,
    resetSentenceTranslationInteractions,
    handleConfirmSentenceTranslation,
    handleReadingContentPointerDown,
    handleToggleSentenceTranslationPin,
    handleSentenceTranslationHeaderPointerDown,
    handleSentenceTranslationHeaderMouseDown,
  };
}
