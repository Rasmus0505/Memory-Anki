import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  FreestyleAnkiCard,
  MindMapEditorState,
} from '@/shared/api/contracts'
import { FreestyleAnkiFlipPanel, type FreestyleAnkiRating } from './FreestyleAnkiFlipPanel'
import {
  loadPalaceEditor,
  palaceEditorCache,
  plainContextLabel,
} from './freestyleBranchCardSupport'
import { stripMindMapHtml } from '@/shared/lib/mindmapRichText'
import { cn } from '@/shared/lib/utils'

const RATING_LABELS: Record<FreestyleAnkiRating, string> = {
  1: '忘记',
  2: '困难',
  3: '记得',
  4: '轻松',
}

export function FreestyleMindMapBranchCardView({
  card,
  active,
  onBranchComplete,
  reducedMotion,
}: {
  card: FreestyleAnkiCard
  active: boolean
  onBranchComplete: (cardId: string, options?: { restudy?: boolean }) => void
  reducedMotion: boolean
}) {
  const [editorState, setEditorState] = useState<MindMapEditorState | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ rating: FreestyleAnkiRating; restudy: boolean } | null>(null)
  const settledRef = useRef(false)
  const clearResultTimerRef = useRef<number | null>(null)

  const contextLabel = useMemo(
    () => plainContextLabel(card.context_path, card.palace_title, card.palace_id),
    [card.context_path, card.palace_id, card.palace_title],
  )
  const palaceTitleLabel = useMemo(
    () => stripMindMapHtml(card.palace_title) || card.palace_title || `宫殿 ${card.palace_id}`,
    [card.palace_id, card.palace_title],
  )

  const load = useCallback(() => {
    setLoading(true)
    setLoadError('')
    void loadPalaceEditor(card.palace_id)
      .then(setEditorState)
      .catch((error) => {
        setLoadError(error instanceof Error ? error.message : '加载独立 Anki 卡失败。')
      })
      .finally(() => setLoading(false))
  }, [card.palace_id])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (active) return
    settledRef.current = false
    setBusy(false)
    setResult(null)
  }, [active])

  useEffect(() => () => {
    if (clearResultTimerRef.current != null) {
      window.clearTimeout(clearResultTimerRef.current)
    }
  }, [])

  const settle = useCallback((rating: FreestyleAnkiRating) => {
    if (settledRef.current || busy) return
    settledRef.current = true
    setBusy(true)
    const restudy = rating <= 2
    setResult({ rating, restudy })
    onBranchComplete(card.id, { restudy })
    clearResultTimerRef.current = window.setTimeout(() => {
      setResult(null)
    }, reducedMotion ? 1200 : 2400)
  }, [busy, card.id, onBranchComplete, reducedMotion])

  const showContextLine = Boolean(contextLabel.trim() && contextLabel.trim() !== palaceTitleLabel.trim())

  return (
    <section
      className={cn(
        'relative flex h-full w-full min-h-0 flex-col overflow-hidden rounded-2xl border border-white/12 bg-zinc-950/90 shadow-[0_12px_40px_rgba(0,0,0,0.35)]',
        active ? 'ring-1 ring-emerald-400/25' : 'opacity-95',
      )}
    >
      <header className="flex min-h-10 shrink-0 items-center gap-3 border-b border-white/10 bg-zinc-950/80 px-3 py-2 sm:px-3.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium leading-tight text-zinc-50">
            {palaceTitleLabel}
          </div>
          {showContextLine ? (
            <div className="mt-0.5 truncate text-xs leading-tight text-zinc-500">{contextLabel}</div>
          ) : null}
        </div>
        <span className="shrink-0 text-[11px] text-zinc-400">独立 Anki 卡</span>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col bg-card">
        {loading ? (
          <div className="flex h-full items-center justify-center bg-zinc-950 text-sm text-zinc-400">
            加载卡片…
          </div>
        ) : loadError ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 bg-zinc-950 px-6 text-center">
            <div className="text-sm text-rose-300">{loadError}</div>
            <button
              type="button"
              className="min-h-10 rounded-full border border-white/15 px-4 py-2 text-sm text-zinc-200"
              onClick={() => {
                palaceEditorCache.delete(card.palace_id)
                load()
              }}
            >
              重试
            </button>
          </div>
        ) : editorState ? (
          <FreestyleAnkiFlipPanel
            card={card}
            editorState={editorState}
            busy={busy}
            onRateGroup={settle}
            onRateSingle={settle}
          />
        ) : null}

        {result ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3">
            <div role="status" className="w-full max-w-sm rounded-xl border border-white/12 bg-zinc-950/95 px-4 py-3 text-zinc-50 shadow-lg">
              <div className="text-sm font-semibold">已选{RATING_LABELS[result.rating]}</div>
              <div className="mt-1 text-xs text-zinc-400">
                {result.restudy ? '本轮稍后重新出现，不改变宫殿复习计划' : '本轮完成，不改变宫殿复习计划'}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
