import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  lookupCambridgeApi,
  lookupVocabularyApi,
  translateEnglishLookupApi,
} from './api'
import { getLookupAudioManager } from './audioManager'
import {
  countLookupWords,
  isValidLookupQuery,
  normalizeLookupQuery,
  preferredAudioUrl,
} from './normalize'
import {
  readLookupCardPreferences,
  writeLookupCardPreferences,
} from './preferences'
import {
  clampPanelLeft,
  clampPanelTop,
  positionAnchorNearSelection,
  positionNearPoint,
  positionNearRect,
} from './position'
import type {
  DictCardHeight,
  EnglishLookupPanelState,
  EnglishLookupSearchResponse,
  CambridgeResult,
  GoogleTranslateResult,
  LookupAnchorState,
  LookupHistoryItem,
  VocabularyResult,
} from './types'
import {
  LOOKUP_PANEL_MIN_HEIGHT,
  LOOKUP_PANEL_MIN_WIDTH,
  LOOKUP_PANEL_WIDTH,
} from './types'

export type LookupResizeDirection = 'n' | 'e' | 's' | 'w' | 'nw' | 'ne' | 'se' | 'sw'

const EMPTY_PANEL: EnglishLookupPanelState = {
  open: false,
  pinned: false,
  dragging: false,
  left: 0,
  top: 0,
  width: LOOKUP_PANEL_WIDTH,
  maxHeight: 400,
  query: '',
  queryId: 0,
  searchInput: '',
  loading: false,
  result: null,
  error: null,
  vocabularyHeight: 'COLLAPSE',
  cambridgeHeight: 'COLLAPSE',
  googleHeight: 'COLLAPSE',
  autoPlayedQueryId: null,
}

export interface UseEnglishLookupOptions {
  isActive: boolean
}

export function useEnglishLookup({ isActive }: UseEnglishLookupOptions) {
  const [panel, setPanel] = useState<EnglishLookupPanelState>(EMPTY_PANEL)
  const [anchor, setAnchor] = useState<LookupAnchorState | null>(null)
  const [historyMeta, setHistoryMeta] = useState({ index: -1, length: 0 })
  const panelRef = useRef<HTMLDivElement | null>(null)
  const historyRef = useRef<LookupHistoryItem[]>([])
  const historyIndexRef = useRef(-1)
  const resultCacheRef = useRef<Map<string, EnglishLookupSearchResponse>>(new Map())
  const queryIdRef = useRef(0)
  const cardPreferencesRef = useRef(readLookupCardPreferences())
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originLeft: number
    originTop: number
  } | null>(null)
  const resizeRef = useRef<{
    pointerId: number
    direction: LookupResizeDirection
    startX: number
    startY: number
    originLeft: number
    originTop: number
    originWidth: number
    originHeight: number
  } | null>(null)
  const panelSnapshotRef = useRef(panel)
  panelSnapshotRef.current = panel

  const stopAudio = useCallback(() => {
    getLookupAudioManager().stop()
  }, [])

  const clearHistory = useCallback(() => {
    historyRef.current = []
    historyIndexRef.current = -1
    setHistoryMeta({ index: -1, length: 0 })
  }, [])

  const closePanel = useCallback(() => {
    stopAudio()
    clearHistory()
    setAnchor(null)
    setPanel(EMPTY_PANEL)
    dragRef.current = null
  }, [clearHistory, stopAudio])

  const reset = useCallback(() => {
    closePanel()
    resultCacheRef.current.clear()
    queryIdRef.current = 0
  }, [closePanel])

  useEffect(() => {
    if (!isActive) reset()
  }, [isActive, reset])

  useEffect(() => {
    if (!isActive || !panel.open) return

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (panelRef.current?.contains(target)) return
      if (target instanceof HTMLElement) {
        if (target.closest('[data-lookup-token="true"]')) return
        if (target.closest('[data-lookup-anchor="true"]')) return
        if (target.closest('[data-reading-word="true"]')) return
      }
      if (panelSnapshotRef.current.pinned) return
      closePanel()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closePanel()
      }
    }

    const onResize = () => {
      setPanel((current) => {
        if (!current.open) return current
        if (!current.pinned) return EMPTY_PANEL
        const top = clampPanelTop(current.top)
        const width = Math.min(current.width, Math.max(LOOKUP_PANEL_MIN_WIDTH, window.innerWidth - 16))
        const maxHeight = Math.min(current.maxHeight, Math.max(LOOKUP_PANEL_MIN_HEIGHT, window.innerHeight - 16))
        return {
          ...current,
          left: clampPanelLeft(current.left, width),
          top,
          width,
          maxHeight,
        }
      })
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onResize)
    }
  }, [closePanel, isActive, panel.open])

  const pushHistory = useCallback((item: LookupHistoryItem) => {
    const stack = historyRef.current.slice(0, historyIndexRef.current + 1)
    stack.push(item)
    historyRef.current = stack
    historyIndexRef.current = stack.length - 1
    setHistoryMeta({ index: historyIndexRef.current, length: stack.length })
  }, [])

  const maybeAutoPlay = useCallback(
    (queryId: number, result: EnglishLookupSearchResponse | null) => {
      const url = preferredAudioUrl(result?.audio)
      if (!url) return
      setPanel((current) => {
        if (!current.open || current.queryId !== queryId) return current
        if (current.autoPlayedQueryId === queryId) return current
        void getLookupAudioManager().play(url)
        return { ...current, autoPlayedQueryId: queryId }
      })
    },
    [],
  )

  const runSearch = useCallback(
    async (
      rawQuery: string,
      position: { left: number; top: number; maxHeight: number },
      options?: { toggleSame?: boolean },
    ) => {
      const query = normalizeLookupQuery(rawQuery)
      if (!isValidLookupQuery(query)) return

      const current = panelSnapshotRef.current
      if (
        options?.toggleSame &&
        !current.pinned &&
        current.open &&
        current.query === query
      ) {
        closePanel()
        return
      }

      setAnchor(null)

      const queryId = queryIdRef.current + 1
      queryIdRef.current = queryId

      const pinned = current.pinned
      const resolvedPosition =
        pinned && current.open
          ? {
              left: current.left,
              top: current.top,
              maxHeight: current.maxHeight,
            }
          : position

      const cached = resultCacheRef.current.get(query) ?? null
      const dictionaryLookupAllowed = countLookupWords(query) <= 5
      const pendingResult = createPendingLookupResult(query, dictionaryLookupAllowed)
      setPanel({
        open: true,
        pinned,
        dragging: false,
        ...resolvedPosition,
        width: current.width || LOOKUP_PANEL_WIDTH,
        query,
        queryId,
        searchInput: query,
        loading: !cached,
        result: cached ?? pendingResult,
        error: null,
        ...cardPreferencesRef.current,
        autoPlayedQueryId: null,
      })

      if (cached) {
        pushHistory({ queryId, query, result: cached, error: null })
        maybeAutoPlay(queryId, cached)
        return
      }

      const googlePromise = translateEnglishLookupApi(query).catch(() => googleErrorResult())
      const vocabularyPromise = dictionaryLookupAllowed
        ? lookupVocabularyApi(query).catch(() => vocabularyErrorResult())
        : Promise.resolve(skippedVocabularyResult())
      const cambridgePromise = dictionaryLookupAllowed
        ? lookupCambridgeApi(query).catch(() => cambridgeErrorResult())
        : Promise.resolve(skippedCambridgeResult())

      const applyPartial = <K extends 'vocabulary' | 'cambridge' | 'google'>(
        key: K,
        value: EnglishLookupSearchResponse[K],
      ) => {
        setPanel((prev) => {
          if (prev.queryId !== queryId || !prev.result) return prev
          return {
            ...prev,
            result: {
              ...prev.result,
              [key]: value,
              sourceUrls: { ...prev.result.sourceUrls, [key]: value.sourceUrl },
            },
          }
        })
      }
      void googlePromise.then((result) => applyPartial('google', result))
      void vocabularyPromise.then((result) => applyPartial('vocabulary', result))
      void cambridgePromise.then((result) => applyPartial('cambridge', result))

      try {
        const [google, vocabulary, cambridge] = await Promise.all([
          googlePromise,
          vocabularyPromise,
          cambridgePromise,
        ])
        const result: EnglishLookupSearchResponse = {
          ...pendingResult,
          vocabulary,
          cambridge,
          google,
          audio: cambridge.audio,
          sourceUrls: {
            vocabulary: vocabulary.sourceUrl,
            cambridge: cambridge.sourceUrl,
            google: google.sourceUrl,
          },
        }
        resultCacheRef.current.set(query, result)
        if (queryIdRef.current !== queryId) return
        pushHistory({ queryId, query, result, error: null })
        setPanel((prev) => {
          if (prev.queryId !== queryId) return prev
          return {
            ...prev,
            loading: false,
            result,
            error: null,
            ...cardPreferencesRef.current,
          }
        })
        maybeAutoPlay(queryId, result)
      } catch (error) {
        if (queryIdRef.current !== queryId) return
        const message =
          error instanceof Error ? error.message : '查词失败，请重试。'
        pushHistory({ queryId, query, result: null, error: message })
        setPanel((prev) => {
          if (prev.queryId !== queryId) return prev
          return {
            ...prev,
            loading: false,
            result: null,
            error: message,
            ...cardPreferencesRef.current,
          }
        })
      }
    },
    [closePanel, maybeAutoPlay, pushHistory],
  )

  /** Click a single token → open/toggle panel directly (no anchor). */
  const handleTokenClick = useCallback(
    (word: string, event: ReactMouseEvent<HTMLElement>) => {
      event.preventDefault()
      event.stopPropagation()
      // Clear any selection so selection path does not fight click.
      const selection = window.getSelection()
      selection?.removeAllRanges()
      const query = normalizeLookupQuery(word)
      if (!isValidLookupQuery(query)) return
      const rect = event.currentTarget.getBoundingClientRect()
      void runSearch(query, positionNearRect(rect), { toggleSame: true })
    },
    [runSearch],
  )

  /** Selection change → show anchor for 1–5 words only. */
  const handleSelectionChange = useCallback(() => {
    if (!isActive) return
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      setAnchor(null)
      return
    }
    const text = selection.toString()
    const query = normalizeLookupQuery(text)
    if (!isValidLookupQuery(query) || countLookupWords(query) < 1) {
      setAnchor(null)
      return
    }
    // Single-word click path often leaves a collapsed-or-tiny selection; still allow.
    const range = selection.getRangeAt(0)
    const pos = positionAnchorNearSelection(range)
    setAnchor({ visible: true, query, ...pos })
  }, [isActive])

  useEffect(() => {
    if (!isActive) return
    document.addEventListener('selectionchange', handleSelectionChange)
    return () => document.removeEventListener('selectionchange', handleSelectionChange)
  }, [handleSelectionChange, isActive])

  const handleAnchorClick = useCallback(() => {
    if (!anchor?.visible) return
    const query = anchor.query
    const pos = positionNearPoint(anchor.left, anchor.top)
    window.getSelection()?.removeAllRanges()
    setAnchor(null)
    void runSearch(query, pos)
  }, [anchor, runSearch])

  const handleSearchSubmit = useCallback(() => {
    const current = panelSnapshotRef.current
    if (!current.open) return
    const query = normalizeLookupQuery(current.searchInput)
    if (!isValidLookupQuery(query)) return
    void runSearch(query, {
      left: current.left,
      top: current.top,
      maxHeight: current.maxHeight,
    })
  }, [runSearch])

  const setSearchInput = useCallback((value: string) => {
    setPanel((current) =>
      current.open ? { ...current, searchInput: value } : current,
    )
  }, [])

  const togglePin = useCallback(() => {
    setPanel((current) =>
      current.open
        ? { ...current, pinned: !current.pinned, dragging: false }
        : current,
    )
  }, [])

  const replayAudio = useCallback(() => {
    const url = preferredAudioUrl(panelSnapshotRef.current.result?.audio)
    if (!url) return
    void getLookupAudioManager().play(url)
  }, [])

  const playSrc = useCallback((src: string) => {
    void getLookupAudioManager().play(src)
  }, [])

  const goHistory = useCallback(
    (delta: -1 | 1) => {
      const next = historyIndexRef.current + delta
      if (next < 0 || next >= historyRef.current.length) return
      historyIndexRef.current = next
      setHistoryMeta({ index: next, length: historyRef.current.length })
      const item = historyRef.current[next]
      setPanel((current) => {
        if (!current.open) return current
        return {
          ...current,
          query: item.query,
          queryId: item.queryId,
          searchInput: item.query,
          loading: false,
          result: item.result,
          error: item.error,
          ...cardPreferencesRef.current,
          autoPlayedQueryId: null,
        }
      })
      if (item.result) maybeAutoPlay(item.queryId, item.result)
    },
    [maybeAutoPlay],
  )

  const setCardHeight = useCallback(
    (which: 'vocabulary' | 'cambridge' | 'google', height: DictCardHeight) => {
      setPanel((current) => {
        if (!current.open) return current
        const next =
          which === 'vocabulary'
            ? { ...current, vocabularyHeight: height }
            : which === 'cambridge'
              ? { ...current, cambridgeHeight: height }
              : { ...current, googleHeight: height }
        cardPreferencesRef.current = {
          vocabularyHeight: next.vocabularyHeight,
          cambridgeHeight: next.cambridgeHeight,
          googleHeight: next.googleHeight,
        }
        writeLookupCardPreferences(cardPreferencesRef.current)
        return next
      })
    },
    [],
  )

  const cycleCardHeight = useCallback((which: 'vocabulary' | 'cambridge' | 'google') => {
    setPanel((current) => {
      if (!current.open) return current
      const key =
        which === 'vocabulary'
          ? 'vocabularyHeight'
          : which === 'cambridge'
            ? 'cambridgeHeight'
            : 'googleHeight'
      const now = current[key]
      const next: DictCardHeight =
        now === 'COLLAPSE' ? 'HALF' : now === 'HALF' ? 'FULL' : 'COLLAPSE'
      const updated = { ...current, [key]: next }
      cardPreferencesRef.current = {
        vocabularyHeight: updated.vocabularyHeight,
        cambridgeHeight: updated.cambridgeHeight,
        googleHeight: updated.googleHeight,
      }
      writeLookupCardPreferences(cardPreferencesRef.current)
      return updated
    })
  }, [])

  // Drag (unpinned and pinned both allowed per plan)
  useEffect(() => {
    if (!panel.dragging || !dragRef.current) return
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || event.pointerId !== drag.pointerId) return
      const width = panelSnapshotRef.current.width
      const left = clampPanelLeft(drag.originLeft + (event.clientX - drag.startX), width)
      const top = clampPanelTop(drag.originTop + (event.clientY - drag.startY))
      setPanel((current) =>
        current.open
          ? { ...current, left, top }
          : current,
      )
    }
    const onUp = () => {
      dragRef.current = null
      document.body.style.userSelect = ''
      setPanel((current) =>
        current.open ? { ...current, dragging: false } : current,
      )
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [panel.dragging])

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const resize = resizeRef.current
      if (!resize || event.pointerId !== resize.pointerId) return
      const dx = event.clientX - resize.startX
      const dy = event.clientY - resize.startY
      let left = resize.originLeft
      let top = resize.originTop
      let width = resize.originWidth
      let height = resize.originHeight

      if (resize.direction.includes('e')) width += dx
      if (resize.direction.includes('s')) height += dy
      if (resize.direction.includes('w')) {
        width -= dx
        left += dx
      }
      if (resize.direction.includes('n')) {
        height -= dy
        top += dy
      }

      if (width < LOOKUP_PANEL_MIN_WIDTH) {
        if (resize.direction.includes('w')) left -= LOOKUP_PANEL_MIN_WIDTH - width
        width = LOOKUP_PANEL_MIN_WIDTH
      }
      if (height < LOOKUP_PANEL_MIN_HEIGHT) {
        if (resize.direction.includes('n')) top -= LOOKUP_PANEL_MIN_HEIGHT - height
        height = LOOKUP_PANEL_MIN_HEIGHT
      }
      width = Math.min(width, window.innerWidth - 16)
      height = Math.min(height, window.innerHeight - 16)
      left = clampPanelLeft(left, width)
      top = Math.min(clampPanelTop(top), window.innerHeight - height - 8)

      setPanel((current) =>
        current.open ? { ...current, left, top, width, maxHeight: height } : current,
      )
    }
    const onUp = (event: PointerEvent) => {
      if (resizeRef.current?.pointerId !== event.pointerId) return
      resizeRef.current = null
      document.body.style.userSelect = ''
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [])

  const handleHeaderPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.target instanceof HTMLElement && event.target.closest('button, input')) {
        return
      }
      const current = panelSnapshotRef.current
      if (!current.open) return
      event.preventDefault()
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originLeft: current.left,
        originTop: current.top,
      }
      document.body.style.userSelect = 'none'
      setPanel((p) => (p.open ? { ...p, dragging: true } : p))
    },
    [],
  )

  const handleResizePointerDown = useCallback(
    (direction: LookupResizeDirection, event: ReactPointerEvent<HTMLButtonElement>) => {
      const current = panelSnapshotRef.current
      if (!current.open) return
      event.preventDefault()
      event.stopPropagation()
      resizeRef.current = {
        pointerId: event.pointerId,
        direction,
        startX: event.clientX,
        startY: event.clientY,
        originLeft: current.left,
        originTop: current.top,
        originWidth: current.width,
        originHeight: current.maxHeight,
      }
      document.body.style.userSelect = 'none'
      event.currentTarget.setPointerCapture?.(event.pointerId)
    },
    [],
  )

  const canHistoryBack = historyMeta.index > 0
  const canHistoryForward =
    historyMeta.index >= 0 && historyMeta.index < historyMeta.length - 1

  return {
    panel,
    panelRef,
    anchor,
    handleTokenClick,
    handleAnchorClick,
    handleSearchSubmit,
    setSearchInput,
    togglePin,
    closePanel,
    reset,
    replayAudio,
    playSrc,
    goHistory,
    canHistoryBack,
    canHistoryForward,
    setCardHeight,
    cycleCardHeight,
    handleHeaderPointerDown,
    handleResizePointerDown,
    runSearch,
  }
}

export type EnglishLookupController = ReturnType<typeof useEnglishLookup>

function createPendingLookupResult(
  query: string,
  dictionaryLookupAllowed: boolean,
): EnglishLookupSearchResponse {
  return {
    query,
    wordCount: countLookupWords(query),
    vocabulary: dictionaryLookupAllowed ? pendingVocabularyResult() : skippedVocabularyResult(),
    cambridge: dictionaryLookupAllowed ? pendingCambridgeResult() : skippedCambridgeResult(),
    google: pendingGoogleResult(),
    audio: { us: null, uk: null },
    sourceUrls: { vocabulary: null, cambridge: null, google: null },
  }
}

function pendingVocabularyResult(): VocabularyResult {
  return { status: 'searching', short: null, long: null, error: null, sourceUrl: null }
}

function pendingCambridgeResult(): CambridgeResult {
  return { status: 'searching', entries: [], audio: { us: null, uk: null }, error: null, sourceUrl: null }
}

function pendingGoogleResult(): GoogleTranslateResult {
  return { status: 'searching', translation: '', detectedLanguage: null, error: null, sourceUrl: null }
}

function vocabularyErrorResult(): VocabularyResult {
  return { status: 'error', short: null, long: null, error: 'Vocabulary.com 查询失败，请稍后重试。', sourceUrl: null }
}

function cambridgeErrorResult(): CambridgeResult {
  return { status: 'error', entries: [], audio: { us: null, uk: null }, error: 'Cambridge 查询失败，请稍后重试。', sourceUrl: null }
}

function googleErrorResult(): GoogleTranslateResult {
  return { status: 'error', translation: '', detectedLanguage: null, error: '谷歌翻译查询失败，请稍后重试。', sourceUrl: null }
}

function skippedVocabularyResult(): VocabularyResult {
  return { status: 'empty', short: null, long: null, error: 'Vocabulary.com 仅在查询 1–5 个英文词时启用。', sourceUrl: null }
}

function skippedCambridgeResult(): CambridgeResult {
  return { status: 'empty', entries: [], audio: { us: null, uk: null }, error: 'Cambridge 仅在查询 1–5 个英文词时启用。', sourceUrl: null }
}
