import { useCallback, useMemo, useState } from 'react'
import type { FreestyleMindMapBranchCard, MindMapEditorState, MindMapRecallRating } from '@/shared/api/contracts'
import {
  collectAnkiCards,
  parseMindMapDocument,
  type AnkiTreeNode,
  type MindMapNode,
} from '@/modules/content/public'
import { EnglishInteractiveText } from '@/modules/english/public'
import { stripMindMapHtml } from '@/shared/lib/mindmapRichText'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/button'

const RATING_OPTIONS: Array<{ rating: MindMapRecallRating; label: string; className: string }> = [
  { rating: 1, label: '忘记', className: 'bg-rose-600 hover:bg-rose-500 text-white' },
  { rating: 2, label: '困难', className: 'bg-amber-600 hover:bg-amber-500 text-white' },
  { rating: 3, label: '记得', className: 'bg-emerald-600 hover:bg-emerald-500 text-white' },
  { rating: 4, label: '轻松', className: 'bg-sky-600 hover:bg-sky-500 text-white' },
]

function walkAnkiTree(
  node: MindMapNode,
  parentUid: string | null,
  fallback: string,
  out: Record<string, AnkiTreeNode>,
) {
  const data = (node.data ?? {}) as Record<string, unknown>
  const uid = String(data.uid ?? data.memoryAnkiId ?? fallback)
  const childrenRaw = Array.isArray(node.children) ? node.children : []
  const childUids: string[] = []
  childrenRaw.forEach((child, index) => {
    if (!child || typeof child !== 'object') return
    const childUid = walkAnkiTree(child as MindMapNode, uid, `${fallback}-${index}`, out)
    childUids.push(childUid)
  })
  const role = data.ankiRole
  out[uid] = {
    uid,
    parentUid,
    children: childUids,
    explicitRole: role === 'front' || role === 'back' || role === 'none' ? role : null,
    ankiFrontUid: typeof data.ankiFrontUid === 'string' ? data.ankiFrontUid : null,
    text: stripMindMapHtml(String(data.text || '')),
  }
  return uid
}

function nodeTextMap(editorState: MindMapEditorState | null): Record<string, string> {
  if (!editorState?.editor_doc) return {}
  const doc = parseMindMapDocument(editorState.editor_doc)
  const out: Record<string, AnkiTreeNode> = {}
  walkAnkiTree(doc.root, null, 'root', out)
  return Object.fromEntries(Object.values(out).map((n) => [n.uid, n.text || n.uid]))
}

function resolveAnkiBinding(
  card: FreestyleMindMapBranchCard,
  editorState: MindMapEditorState | null,
) {
  const frontUid = card.anki_front_uid || card.branch_uid
  let backUids = card.anki_back_uids || []
  if ((!backUids.length || !frontUid) && editorState?.editor_doc) {
    const doc = parseMindMapDocument(editorState.editor_doc)
    const tree: Record<string, AnkiTreeNode> = {}
    walkAnkiTree(doc.root, null, 'root', tree)
    const cards = collectAnkiCards(tree)
    const match = cards.find((item) => item.frontUid === frontUid)
    if (match) backUids = match.backUids
  }
  return { frontUid, backUids }
}

/**
 * Anki-style freestyle surface: front → flip → multi-back placeholders → ratings.
 * Ratings are applied to front + all backs by default, or a single selected face.
 */
export function FreestyleAnkiFlipPanel({
  card,
  editorState,
  busy,
  onRateGroup,
  onRateSingle,
}: {
  card: FreestyleMindMapBranchCard
  editorState: MindMapEditorState | null
  busy?: boolean
  /** Default: rate front + all backs with the same rating, then settle. */
  onRateGroup: (rating: MindMapRecallRating) => void | Promise<void>
  /** Optional single-node score (front or one back). */
  onRateSingle: (rating: MindMapRecallRating, nodeUid: string) => void | Promise<void>
}) {
  const texts = useMemo(() => nodeTextMap(editorState), [editorState])
  const { frontUid, backUids } = useMemo(
    () => resolveAnkiBinding(card, editorState),
    [card, editorState],
  )
  const [flipped, setFlipped] = useState(false)
  const [revealedBacks, setRevealedBacks] = useState<Set<string>>(() => new Set())
  const [focusUid, setFocusUid] = useState<string | null>(null)

  const frontText = texts[frontUid] || frontUid

  const handleFlip = useCallback(() => {
    setFlipped(true)
    if (backUids.length <= 1) {
      setRevealedBacks(new Set(backUids))
    }
  }, [backUids])

  const revealBack = useCallback((uid: string) => {
    setRevealedBacks((current) => {
      const next = new Set(current)
      next.add(uid)
      return next
    })
    setFocusUid(uid)
  }, [])

  const handleGroupRate = useCallback(
    (rating: MindMapRecallRating) => {
      void onRateGroup(rating)
    },
    [onRateGroup],
  )

  const handleSingleRate = useCallback(
    (rating: MindMapRecallRating) => {
      const target = focusUid || frontUid
      if (!target) return
      void onRateSingle(rating, target)
    },
    [focusUid, frontUid, onRateSingle],
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4 sm:p-5">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">正反面卡片</div>

      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (!flipped) handleFlip()
          else setFocusUid(frontUid)
        }}
        className={cn(
          'min-h-[7rem] w-full rounded-2xl border px-4 py-5 text-left transition',
          focusUid === frontUid || !flipped
            ? 'border-sky-400/60 bg-sky-500/10 ring-1 ring-sky-400/30'
            : 'border-white/12 bg-zinc-900/80 hover:border-white/25',
        )}
      >
        <div className="mb-2 text-[11px] font-semibold text-sky-300">正面</div>
        <div className="text-base leading-7 text-zinc-50 sm:text-lg">
          <EnglishInteractiveText text={frontText} />
        </div>
        {!flipped ? (
          <div className="mt-4 text-sm text-zinc-400">点击卡片查看反面</div>
        ) : null}
      </button>

      {flipped ? (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          <div className="text-[11px] font-semibold text-amber-300">反面</div>
          {backUids.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/15 px-3 py-4 text-sm text-zinc-500">
              这张卡还没有反面节点（可在编辑器里给正面加子节点，或标为反面）。
            </div>
          ) : (
            backUids.map((uid, index) => {
              const revealed = revealedBacks.has(uid)
              const focused = focusUid === uid
              return (
                <button
                  key={uid}
                  type="button"
                  disabled={busy}
                  onClick={() => (revealed ? setFocusUid(uid) : revealBack(uid))}
                  className={cn(
                    'w-full rounded-xl border px-3 py-3 text-left transition',
                    focused
                      ? 'border-amber-400/60 bg-amber-500/10 ring-1 ring-amber-400/30'
                      : 'border-white/12 bg-zinc-900/70 hover:border-white/25',
                  )}
                >
                  {revealed ? (
                    <div className="text-sm leading-6 text-zinc-100">
                      <EnglishInteractiveText text={texts[uid] || uid} />
                    </div>
                  ) : (
                    <div className="text-sm text-zinc-400">
                      反面片段 {index + 1} · 点击揭开
                    </div>
                  )}
                </button>
              )
            })
          )}
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {flipped ? (
        <div className="shrink-0 space-y-2 border-t border-white/10 pt-3">
          <div className="text-xs text-zinc-400">
            {focusUid && focusUid !== frontUid
              ? '已选中单个反面：单独评分'
              : '默认给正面 + 全部反面同一档评分'}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {RATING_OPTIONS.map((option) => (
              <Button
                key={option.rating}
                type="button"
                disabled={busy}
                className={cn('min-h-11', option.className)}
                onClick={() =>
                  focusUid && focusUid !== frontUid
                    ? handleSingleRate(option.rating)
                    : handleGroupRate(option.rating)
                }
              >
                {option.label}
              </Button>
            ))}
          </div>
          {focusUid && focusUid !== frontUid ? (
            <button
              type="button"
              className="text-xs text-zinc-400 underline-offset-2 hover:text-zinc-200 hover:underline"
              onClick={() => setFocusUid(frontUid)}
            >
              改回整卡评分（正面+全部反面）
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
