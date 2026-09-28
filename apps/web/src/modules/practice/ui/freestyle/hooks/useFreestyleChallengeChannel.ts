import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { UnitRating } from '@/modules/practice/public'
import type { useImmersiveQueue } from '@/modules/practice/ui/freestyle/hooks/useImmersiveQueue'
import {
  CHANNEL_HINT_COOLDOWN_MS,
  EMPTY_CHANNEL_LOG,
  channelAdjustment,
  channelLogSamples,
  readChallengeChannel,
  recordChannelRating,
  shouldSurfaceChannelHint,
  type ChannelLog,
} from '@/modules/practice/ui/freestyle/model/freestyleChallengeChannel'

type ImmersiveQueue = ReturnType<typeof useImmersiveQueue>

/** Challenge–skill channel: reads rating drift and offers one in-feed correction. */
export function useFreestyleChallengeChannel({
  config,
  cardCount,
  currentCardId,
  roundComplete,
  loading,
  error,
  setConfigAndPersist,
}: {
  config: ImmersiveQueue['config']
  cardCount: number
  currentCardId: string | null
  roundComplete: boolean
  loading: boolean
  error: ImmersiveQueue['error']
  setConfigAndPersist: ImmersiveQueue['setConfigAndPersist']
}) {
  /** Challenge–skill channel rating log for this session. See ChannelLog for the keying. */
  const [channelLog, setChannelLog] = useState<ChannelLog>(EMPTY_CHANNEL_LOG)
  /**
   * Suppression is a timer-cleared flag rather than a stored timestamp compared during
   * render: a render-time `Date.now()` never re-evaluates on its own, so the hint would
   * stay hidden past its cooldown until some unrelated re-render happened to occur.
   */
  const [channelHintSuppressed, setChannelHintSuppressed] = useState(false)
  const channelHintCooldownRef = useRef<number | null>(null)
  const [channelAdjusting, setChannelAdjusting] = useState(false)
  const [channelAppliedHint, setChannelAppliedHint] = useState('')

  const recordChannelSample = useCallback((cardId: string, rating: UnitRating) => {
    setChannelLog((current) => recordChannelRating(current, cardId, rating))
  }, [])

  const channelReading = useMemo(
    () => readChallengeChannel(channelLogSamples(channelLog)),
    [channelLog],
  )

  const activeChannelAdjustment = useMemo(
    () => channelAdjustment(channelReading, config),
    [channelReading, config],
  )

  /**
   * The hint appears only at the two exits from the channel, only when there is an
   * actual correction to offer, and not again within the cooldown after a dismissal —
   * a suggestion the learner already declined becomes an interruption if it returns.
   */
  const channelHintVisible = Boolean(
    shouldSurfaceChannelHint(channelReading)
    && activeChannelAdjustment
    && cardCount > 0
    && !roundComplete
    && !loading
    && !error
    && !channelHintSuppressed,
  )

  /**
   * Apply the correction without leaving the feed. Silent + preferCardId so the round
   * keeps its finished work and the learner stays on the card under the viewport: the
   * correction has to cost less attention than the drift it fixes.
   */
  const suppressChannelHint = useCallback(() => {
    setChannelHintSuppressed(true)
    if (channelHintCooldownRef.current != null) {
      window.clearTimeout(channelHintCooldownRef.current)
    }
    channelHintCooldownRef.current = window.setTimeout(() => {
      channelHintCooldownRef.current = null
      setChannelHintSuppressed(false)
    }, CHANNEL_HINT_COOLDOWN_MS)
  }, [])

  useEffect(() => {
    return () => {
      if (channelHintCooldownRef.current != null) {
        window.clearTimeout(channelHintCooldownRef.current)
      }
    }
  }, [])

  const handleApplyChannelAdjustment = useCallback(() => {
    if (!activeChannelAdjustment) return
    setChannelAdjusting(true)
    suppressChannelHint()
    // The reading described the round before this change; keeping it would have the
    // hint immediately re-offer the same correction.
    setChannelLog(EMPTY_CHANNEL_LOG)
    setConfigAndPersist(activeChannelAdjustment.apply, {
      silent: true,
      preferCardId: currentCardId,
    })
    setChannelAppliedHint('未做部分已按更易/更难重排，已完成保留')
    setChannelAdjusting(false)
  }, [activeChannelAdjustment, currentCardId, setConfigAndPersist, suppressChannelHint])

  return {
    recordChannelSample,
    channelReading,
    activeChannelAdjustment,
    channelHintVisible,
    channelAdjusting,
    channelAppliedHint,
    setChannelAppliedHint,
    suppressChannelHint,
    handleApplyChannelAdjustment,
  }
}
