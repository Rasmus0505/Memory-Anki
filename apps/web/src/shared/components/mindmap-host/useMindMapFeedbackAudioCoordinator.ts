import { useCallback, useEffect, useRef } from 'react'
import { useMindMapFeedbackAudioFromSettings } from '@/shared/components/mindmap-host/useMindMapFeedback'
import {
  areRelatedFeedbackAudioEvents,
  getFeedbackAudioCoalesceMs,
  getFeedbackAudioPriority,
  isImmediateFeedbackAudioEvent,
  readMindMapFeedbackAudioEvent,
  type MindMapFeedbackAudioEvent,
} from './mindMapFeedbackAudioModel'

const FEEDBACK_AUDIO_COALESCE_MS = 110
const FEEDBACK_AUDIO_DEDUP_MS = 140

export function useMindMapFeedbackAudioCoordinator() {
  const feedbackAudio = useMindMapFeedbackAudioFromSettings()
  const feedbackAudioRef = useRef(feedbackAudio)
  const pendingFeedbackAudioRef = useRef<{
    event: MindMapFeedbackAudioEvent
    receivedAt: number
    timerId: number
  } | null>(null)
  const lastPlayedFeedbackAudioRef = useRef<{
    event: MindMapFeedbackAudioEvent
    playedAt: number
  } | null>(null)

  feedbackAudioRef.current = feedbackAudio

  const clearPendingFeedbackAudio = useCallback(() => {
    const pending = pendingFeedbackAudioRef.current
    if (pending) {
      window.clearTimeout(pending.timerId)
      pendingFeedbackAudioRef.current = null
    }
  }, [])

  const playFeedbackAudioNow = useCallback((event: MindMapFeedbackAudioEvent) => {
    lastPlayedFeedbackAudioRef.current = {
      event,
      playedAt: Date.now(),
    }
    feedbackAudioRef.current.playEvent(event.type)
  }, [])

  const emitCoalescedFeedbackAudio = useCallback(
    (event: MindMapFeedbackAudioEvent) => {
      const now = Date.now()
      const priority = getFeedbackAudioPriority(event.type)
      const lastPlayed = lastPlayedFeedbackAudioRef.current
      if (
        lastPlayed &&
        now - lastPlayed.playedAt < FEEDBACK_AUDIO_DEDUP_MS &&
        getFeedbackAudioPriority(lastPlayed.event.type) >= priority &&
        areRelatedFeedbackAudioEvents(lastPlayed.event, event)
      ) {
        return
      }

      const pending = pendingFeedbackAudioRef.current
      if (pending) {
        const pendingPriority = getFeedbackAudioPriority(pending.event.type)
        if (pendingPriority > priority && now - pending.receivedAt < FEEDBACK_AUDIO_COALESCE_MS) {
          return
        }
        window.clearTimeout(pending.timerId)
        pendingFeedbackAudioRef.current = null
      }

      if (isImmediateFeedbackAudioEvent(event.type)) {
        playFeedbackAudioNow(event)
        return
      }

      const timerId = window.setTimeout(() => {
        pendingFeedbackAudioRef.current = null
        playFeedbackAudioNow(event)
      }, getFeedbackAudioCoalesceMs(event.type))
      pendingFeedbackAudioRef.current = {
        event,
        receivedAt: now,
        timerId,
      }
    },
    [playFeedbackAudioNow],
  )

  const handleFeedbackRuntimePayload = useCallback(
    (payload: unknown) => {
      const feedbackEvent = readMindMapFeedbackAudioEvent(payload)
      if (feedbackEvent) {
        emitCoalescedFeedbackAudio(feedbackEvent)
      }
    },
    [emitCoalescedFeedbackAudio],
  )

  useEffect(() => clearPendingFeedbackAudio, [clearPendingFeedbackAudio])

  return {
    handleFeedbackRuntimePayload,
  }
}
