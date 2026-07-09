import { useCallback, useEffect, useMemo, useState } from 'react'
import { getFreestyleFeedApi } from '@/features/freestyle/api'
import {
  enabledContentTypes,
  type FreestyleConfig,
} from '@/features/freestyle/model/freestyle'
import {
  EMPTY_TODAY_TRAINING_SOURCES,
  todayFeedContentTypes,
  type FreestyleMode,
  type TodayTrainingConfig,
} from '@/features/freestyle/model/today-training'
import {
  buildFreestyleLoadDiagnosticText,
  flattenPalaceOptions,
  isQuizCard,
  uniquePalaceContexts,
} from '@/features/freestyle/model/freestyle-cards'
import { getPalacesGroupedApi } from '@/entities/palace/api'
import type {
  FreestyleCard,
  FreestyleQuizCard,
  PalaceGroupedListResponse,
} from '@/shared/api/contracts'
import { toast } from '@/shared/feedback/toast'

export function useFreestyleFeed({
  mode,
  config,
  todayConfig,
}: {
  mode: FreestyleMode
  config: FreestyleConfig
  todayConfig: TodayTrainingConfig
}) {
  const [feedCards, setFeedCards] = useState<FreestyleCard[]>([])
  const [todaySources, setTodaySources] = useState(EMPTY_TODAY_TRAINING_SOURCES)
  const [feedLoading, setFeedLoading] = useState(true)
  const [feedError, setFeedError] = useState('')
  const [palaceOptionsData, setPalaceOptionsData] = useState<PalaceGroupedListResponse | null>(null)

  const palaceOptions = useMemo(() => {
    const fromCatalog = flattenPalaceOptions(palaceOptionsData)
    if (fromCatalog.length > 0) return fromCatalog
    return uniquePalaceContexts(feedCards)
  }, [feedCards, palaceOptionsData])

  const feedDiagnosticText = useMemo(
    () =>
      feedError
        ? buildFreestyleLoadDiagnosticText({
            error: feedError,
            mode,
          })
        : '',
    [feedError, mode],
  )

  const loadFeed = useCallback(async (nextConfig: FreestyleConfig) => {
    setFeedLoading(true)
    setFeedError('')
    try {
      const response = await getFreestyleFeedApi({
        range: nextConfig.range,
        palaceIds: nextConfig.specificPalaceIds,
        contentTypes: enabledContentTypes(nextConfig),
      })
      setFeedCards(response.cards || [])
    } catch (error) {
      setFeedError(error instanceof Error ? error.message : '加载随心队列失败。')
    } finally {
      setFeedLoading(false)
    }
  }, [])

  const loadTodayFeed = useCallback(async (nextConfig: TodayTrainingConfig) => {
    setFeedLoading(true)
    setFeedError('')
    try {
      const contentTypes = todayFeedContentTypes(nextConfig)
      const [dueResponse, practiceResponse, fillResponse] = await Promise.all([
        getFreestyleFeedApi({
          range: 'due',
          contentTypes: contentTypes.due,
        }),
        getFreestyleFeedApi({
          range: 'needs_practice',
          contentTypes: contentTypes.practice,
        }),
        getFreestyleFeedApi({
          range: 'all',
          contentTypes: contentTypes.fill,
        }),
      ])
      setTodaySources({
        dueCards: dueResponse.cards || [],
        practiceCards: practiceResponse.cards || [],
        fillCards: fillResponse.cards || [],
      })
      setFeedCards([
        ...(dueResponse.cards || []),
        ...(practiceResponse.cards || []),
        ...(fillResponse.cards || []),
      ])
    } catch (error) {
      setFeedError(error instanceof Error ? error.message : '加载今日训练失败。')
    } finally {
      setFeedLoading(false)
    }
  }, [])

  const handleCopyFeedDiagnostics = useCallback(async () => {
    if (!feedDiagnosticText) return
    try {
      await navigator.clipboard.writeText(feedDiagnosticText)
      toast.success('诊断信息已复制')
    } catch {
      toast.error('复制失败，请截图当前错误信息')
    }
  }, [feedDiagnosticText])

  useEffect(() => {
    if (mode !== 'free') return
    void loadFeed(config)
  }, [mode, config, loadFeed])

  useEffect(() => {
    if (mode !== 'today') return
    void loadTodayFeed(todayConfig)
  }, [mode, todayConfig, loadTodayFeed])

  useEffect(() => {
    let active = true
    void getPalacesGroupedApi()
      .then((data) => {
        if (active) setPalaceOptionsData(data)
      })
      .catch(() => {
        if (active) setPalaceOptionsData(null)
      })
    return () => {
      active = false
    }
  }, [])

  const updateFeedQuestion = useCallback((question: FreestyleQuizCard['question']) => {
    setFeedCards((current) =>
      current.map((card) =>
        isQuizCard(card) && card.question.id === question.id
          ? { ...card, question }
          : card,
      ),
    )
  }, [])

  return {
    feedCards,
    todaySources,
    feedLoading,
    feedError,
    palaceOptions,
    feedDiagnosticText,
    loadFeed,
    loadTodayFeed,
    handleCopyFeedDiagnostics,
    updateFeedQuestion,
    setFeedError,
    setFeedLoading,
  }
}
