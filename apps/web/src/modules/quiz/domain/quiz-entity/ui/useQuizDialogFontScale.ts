import { useCallback, useEffect, useRef, useState } from 'react'
import {
  QUIZ_FONT_SCALE_DEFAULT_PERCENT,
  adjustQuizFontPercent,
  consumeWheelNotches,
  sanitizeQuizFontScaleSettings,
} from '@/modules/quiz/domain/quiz-entity/model/quizFontScale'
import {
  QUIZ_FONT_SCALE_UPDATED_EVENT,
  readQuizFontScale,
  saveQuizFontScale,
} from '@/modules/quiz/domain/quiz-entity/model/quizFontScaleSettings'

const HINT_MS = 900
const SAVE_MS = 200

export function useQuizDialogFontScale(active: boolean) {
  const [percent, setPercent] = useState(() => readQuizFontScale())
  const [hintVisible, setHintVisible] = useState(false)
  const [contentNode, setContentNode] = useState<HTMLElement | null>(null)
  const percentRef = useRef(percent)
  const pendingNotches = useRef(0)
  const hintTimer = useRef<number | null>(null)
  const saveTimer = useRef<number | null>(null)
  const pendingSave = useRef<number | null>(null)

  percentRef.current = percent

  const contentRef = useCallback((node: HTMLDivElement | null) => {
    setContentNode((current) => (current === node ? current : node))
  }, [])

  const flushSave = useCallback(() => {
    if (saveTimer.current != null) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    if (pendingSave.current == null) return
    const value = pendingSave.current
    pendingSave.current = null
    saveQuizFontScale(value)
  }, [])

  const showHint = useCallback(() => {
    setHintVisible(true)
    if (hintTimer.current != null) window.clearTimeout(hintTimer.current)
    hintTimer.current = window.setTimeout(() => {
      hintTimer.current = null
      setHintVisible(false)
    }, HINT_MS)
  }, [])

  const commitPercent = useCallback(
    (next: number) => {
      const snapped = adjustQuizFontPercent(next, 0)
      percentRef.current = snapped
      setPercent(snapped)
      showHint()
      pendingSave.current = snapped
      if (saveTimer.current != null) window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = null
        if (pendingSave.current == null) return
        const value = pendingSave.current
        pendingSave.current = null
        saveQuizFontScale(value)
      }, SAVE_MS)
    },
    [showHint],
  )

  useEffect(() => {
    setPercent(readQuizFontScale())
    const handleUpdate = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : null
      setPercent(sanitizeQuizFontScaleSettings(detail).percent)
    }
    window.addEventListener(QUIZ_FONT_SCALE_UPDATED_EVENT, handleUpdate)
    return () => window.removeEventListener(QUIZ_FONT_SCALE_UPDATED_EVENT, handleUpdate)
  }, [])

  useEffect(
    () => () => {
      if (hintTimer.current != null) window.clearTimeout(hintTimer.current)
      flushSave()
    },
    [flushSave],
  )

  useEffect(() => {
    if (!active || !contentNode) return
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      const target = event.target
      if (!(target instanceof Node) || !contentNode.contains(target)) return
      event.preventDefault()
      const consumed = consumeWheelNotches(pendingNotches.current, {
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
      })
      pendingNotches.current = consumed.pending
      if (consumed.steps === 0) return
      commitPercent(adjustQuizFontPercent(percentRef.current, consumed.steps))
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '0') return
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.repeat) return
      const target = event.target
      if (!(target instanceof Node) || !contentNode.contains(target)) return
      event.preventDefault()
      pendingNotches.current = 0
      commitPercent(QUIZ_FONT_SCALE_DEFAULT_PERCENT)
    }
    window.addEventListener('wheel', onWheel, { capture: true, passive: false })
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('wheel', onWheel, { capture: true })
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [active, commitPercent, contentNode])

  return { percent, hintVisible, contentRef }
}
