import { useCallback, useEffect, useRef, useState } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { getEnglishReadingDictionaryApi } from "@/features/english-reading/api/englishReadingApi";
import {
  canUseSpeechSynthesis,
  hasActiveTextSelection,
  normalizeLookupWord,
  resolveDictionaryPanelLeft,
  resolveDictionaryPanelMaxHeight,
  resolveDictionaryPanelPosition,
  resolveDictionaryPanelTop,
  type DictionaryPanelState,
} from "@/features/english-reading/model/englishReadingInteractions";
import type { ReadingDictionaryEntry } from "@/shared/api/contracts";
import type { EnglishReadingTimerController } from "@/features/english-reading/hooks/useEnglishReadingWorkflow";

export function useEnglishReadingDictionaryInteractions({
  isActive,
  timer,
}: {
  isActive: boolean;
  timer: EnglishReadingTimerController;
}) {
  const [dictionaryPanel, setDictionaryPanel] =
    useState<DictionaryPanelState | null>(null);

  const dictionaryPanelRef = useRef<HTMLDivElement | null>(null);
  const dictionaryEntriesCacheRef = useRef<Map<string, ReadingDictionaryEntry>>(
    new Map(),
  );
  const dictionaryRequestTokenRef = useRef(0);
  const dictionaryAudioRef = useRef<HTMLAudioElement | null>(null);
  const dictionaryDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originLeft: number;
    originTop: number;
  } | null>(null);
  const supportsSpeechSynthesis = canUseSpeechSynthesis();

  useEffect(() => {
    if (isActive) return;
    if (supportsSpeechSynthesis) {
      window.speechSynthesis.cancel();
    }
    dictionaryAudioRef.current?.pause();
    dictionaryDragRef.current = null;
    setDictionaryPanel((current) =>
      current ? { ...current, dragging: false } : current,
    );
  }, [isActive, supportsSpeechSynthesis]);

  useEffect(() => {
    if (!isActive || !dictionaryPanel) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (dictionaryPanelRef.current?.contains(target)) return;
      if (
        target instanceof HTMLElement &&
        target.closest("[data-reading-word='true']")
      ) {
        return;
      }
      if (dictionaryPanel.pinned) return;
      setDictionaryPanel(null);
    };
    const handleViewportChange = () => {
      setDictionaryPanel((current) => {
        if (!current) return current;
        if (!current.pinned) return null;
        const nextTop = resolveDictionaryPanelTop(current.top);
        return {
          ...current,
          left: resolveDictionaryPanelLeft(current.left),
          top: nextTop,
          maxHeight: resolveDictionaryPanelMaxHeight(nextTop),
        };
      });
    };
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("resize", handleViewportChange);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("resize", handleViewportChange);
    };
  }, [dictionaryPanel, isActive]);

  useEffect(() => {
    if (!isActive || !dictionaryPanel?.dragging) return;
    const updateDraggingPosition = (clientX: number, clientY: number) => {
      const dragState = dictionaryDragRef.current;
      if (!dragState || !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
        return;
      }
      const nextLeft = resolveDictionaryPanelLeft(
        dragState.originLeft + (clientX - dragState.startX),
      );
      const nextTop = resolveDictionaryPanelTop(
        dragState.originTop + (clientY - dragState.startY),
      );
      setDictionaryPanel((current) =>
        current
          ? {
              ...current,
              left: nextLeft,
              top: nextTop,
              maxHeight: resolveDictionaryPanelMaxHeight(nextTop),
            }
          : current,
      );
    };
    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dictionaryDragRef.current;
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      updateDraggingPosition(event.clientX, event.clientY);
    };
    const handleMouseMove = (event: MouseEvent) => {
      updateDraggingPosition(event.clientX, event.clientY);
    };
    const stopDragging = (event?: PointerEvent | MouseEvent) => {
      if (
        event &&
        dictionaryDragRef.current &&
        "pointerId" in event &&
        event.pointerId !== dictionaryDragRef.current.pointerId
      ) {
        return;
      }
      dictionaryDragRef.current = null;
      document.body.style.userSelect = "";
      setDictionaryPanel((current) =>
        current ? { ...current, dragging: false } : current,
      );
    };
    window.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("pointerup", stopDragging);
    document.addEventListener("pointerup", stopDragging);
    window.addEventListener("mouseup", stopDragging);
    document.addEventListener("mouseup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    document.addEventListener("pointercancel", stopDragging);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("pointerup", stopDragging);
      document.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("mouseup", stopDragging);
      document.removeEventListener("mouseup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
      document.removeEventListener("pointercancel", stopDragging);
      document.body.style.userSelect = "";
      dictionaryDragRef.current = null;
    };
  }, [dictionaryPanel?.dragging, isActive]);

  const resetDictionaryInteractions = useCallback(() => {
    setDictionaryPanel(null);
    dictionaryEntriesCacheRef.current.clear();
    dictionaryRequestTokenRef.current += 1;
    dictionaryAudioRef.current?.pause();
    dictionaryDragRef.current = null;
  }, []);

  const speakDictionaryWord = useCallback((word: string) => {
    if (!supportsSpeechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = "en-US";
    window.speechSynthesis.speak(utterance);
  }, [supportsSpeechSynthesis]);

  const playDictionaryPronunciation = useCallback(
    async (
      entry: ReadingDictionaryEntry,
      options: { allowTtsFallback: boolean },
    ) => {
      const { allowTtsFallback } = options;
      if (entry.audioUsUrl) {
        try {
          dictionaryAudioRef.current?.pause();
          const audio = new Audio(entry.audioUsUrl);
          dictionaryAudioRef.current = audio;
          await audio.play();
          return;
        } catch {
          if (!allowTtsFallback) return;
        }
      }
      if (allowTtsFallback) {
        speakDictionaryWord(entry.word || entry.lemma);
      }
    },
    [speakDictionaryWord],
  );

  const handleLookupWord = useCallback(
    async (word: string, event: ReactMouseEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (hasActiveTextSelection()) return;
      const normalizedWord = normalizeLookupWord(word);
      if (!normalizedWord) return;

      timer.registerActivity("practice_interaction", {
        source: "dictionary_lookup",
      });

      const nextPosition =
        dictionaryPanel?.pinned && dictionaryPanel
          ? {
              left: dictionaryPanel.left,
              top: dictionaryPanel.top,
              maxHeight: dictionaryPanel.maxHeight,
            }
          : resolveDictionaryPanelPosition(event.currentTarget);
      const cachedEntry =
        dictionaryEntriesCacheRef.current.get(normalizedWord) ?? null;
      if (cachedEntry) {
        setDictionaryPanel({
          ...nextPosition,
          pinned: dictionaryPanel?.pinned ?? false,
          dragging: false,
          queryWord: normalizedWord,
          entry: cachedEntry,
          error: null,
          loading: false,
        });
        void playDictionaryPronunciation(cachedEntry, {
          allowTtsFallback: false,
        });
        return;
      }

      const requestToken = dictionaryRequestTokenRef.current + 1;
      dictionaryRequestTokenRef.current = requestToken;
      setDictionaryPanel({
        ...nextPosition,
        pinned: dictionaryPanel?.pinned ?? false,
        dragging: false,
        queryWord: normalizedWord,
        entry: null,
        error: null,
        loading: true,
      });

      try {
        const entry = await getEnglishReadingDictionaryApi(normalizedWord);
        dictionaryEntriesCacheRef.current.set(normalizedWord, entry);
        if (dictionaryRequestTokenRef.current !== requestToken) return;
        setDictionaryPanel((current) => {
          const pinned = current?.pinned ?? dictionaryPanel?.pinned ?? false;
          const resolvedPosition =
            pinned && current
              ? {
                  left: current.left,
                  top: current.top,
                  maxHeight: current.maxHeight,
                }
              : nextPosition;
          return {
            ...resolvedPosition,
            pinned,
            dragging: false,
            queryWord: normalizedWord,
            entry,
            error: null,
            loading: false,
          };
        });
        void playDictionaryPronunciation(entry, {
          allowTtsFallback: false,
        });
      } catch (error) {
        if (dictionaryRequestTokenRef.current !== requestToken) return;
        setDictionaryPanel((current) => {
          const pinned = current?.pinned ?? dictionaryPanel?.pinned ?? false;
          const resolvedPosition =
            pinned && current
              ? {
                  left: current.left,
                  top: current.top,
                  maxHeight: current.maxHeight,
                }
              : nextPosition;
          return {
            ...resolvedPosition,
            pinned,
            dragging: false,
            queryWord: normalizedWord,
            entry: null,
            error:
              error instanceof Error ? error.message : "查词失败，请重试。",
            loading: false,
          };
        });
      }
    },
    [dictionaryPanel, playDictionaryPronunciation, timer],
  );

  const handleToggleDictionaryPin = useCallback(() => {
    setDictionaryPanel((current) =>
      current
        ? {
            ...current,
            pinned: !current.pinned,
            dragging: false,
          }
        : current,
    );
  }, []);

  const beginDictionaryDragging = useCallback(
    (startX: number, startY: number, pointerId: number) => {
      if (!dictionaryPanel?.pinned) return;
      if (!Number.isFinite(startX) || !Number.isFinite(startY)) return;
      dictionaryDragRef.current = {
        pointerId,
        startX,
        startY,
        originLeft: dictionaryPanel.left,
        originTop: dictionaryPanel.top,
      };
      document.body.style.userSelect = "none";
      setDictionaryPanel((current) =>
        current ? { ...current, dragging: true } : current,
      );
    },
    [dictionaryPanel],
  );

  const handleDictionaryHeaderPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!dictionaryPanel?.pinned) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("button")
      ) {
        return;
      }
      event.preventDefault();
      beginDictionaryDragging(event.clientX, event.clientY, event.pointerId);
    },
    [beginDictionaryDragging, dictionaryPanel?.pinned],
  );

  const handleDictionaryHeaderMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!dictionaryPanel?.pinned) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("button")
      ) {
        return;
      }
      event.preventDefault();
      beginDictionaryDragging(event.clientX, event.clientY, -1);
    },
    [beginDictionaryDragging, dictionaryPanel?.pinned],
  );

  return {
    dictionaryPanel,
    dictionaryPanelRef,
    supportsSpeechSynthesis,
    setDictionaryPanel,
    resetDictionaryInteractions,
    playDictionaryPronunciation,
    handleLookupWord,
    handleToggleDictionaryPin,
    handleDictionaryHeaderPointerDown,
    handleDictionaryHeaderMouseDown,
  };
}
