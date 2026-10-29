import { useMemo, useRef, useSyncExternalStore } from 'react'
import {
  collectMindMapTextMetrics,
  type MindMapNode,
  type MindMapTextMetricsCache,
  type MindMapTextMetricsSnapshot,
} from '@/modules/content/domain/mindmap-document-entity'
import type { MindMapEditingStatsStore } from './mindMapEditingStatsStore'

const countFormatter = new Intl.NumberFormat('zh-CN')

/**
 * 整图正文统计。缓存按节点 uid 复用：提交一次编辑只重算改动过的卡，
 * 大图（数百张卡）不会因为一次提交整份重扫。
 */
export function useMindMapTextStats(
  document: { root?: MindMapNode } | null | undefined,
): MindMapTextMetricsSnapshot {
  const cacheRef = useRef<MindMapTextMetricsCache | null>(null)
  if (!cacheRef.current) cacheRef.current = new Map()
  return useMemo(
    () => collectMindMapTextMetrics(document, cacheRef.current ?? undefined),
    [document],
  )
}

export interface MindMapTextStatsProps {
  stats: MindMapTextMetricsSnapshot
  /** 编辑会话的实时字数；为空时只显示整图读数。 */
  editingStore: MindMapEditingStatsStore
}

/**
 * 画布右下角的正文统计，口径对齐 Obsidian 状态栏（字数 · 字符数）。
 * 编辑某张卡时在前面追加「本卡 N 字」，整图数字同步扣掉这张卡已提交的旧值。
 */
export function MindMapTextStats({ stats, editingStore }: MindMapTextStatsProps) {
  const editing = useSyncExternalStore(
    editingStore.subscribe,
    editingStore.getSnapshot,
    editingStore.getSnapshot,
  )
  const totals = useMemo(() => {
    if (!editing) return stats
    const committed = stats.byUid.get(editing.nodeUid)
    return {
      ...stats,
      words: stats.words - (committed?.words ?? 0) + editing.metrics.words,
      chars: stats.chars - (committed?.chars ?? 0) + editing.metrics.chars,
    }
  }, [editing, stats])

  const editingLabel = editing ? `本卡 ${countFormatter.format(editing.metrics.words)} 字` : null
  const statsHint = `全图 ${countFormatter.format(stats.cards)} 张卡 · 汉字逐字、英文按词计；字符不含空白`
  const title = editingLabel ? `${editingLabel}；${statsHint}` : statsHint

  return (
    <div
      className="memory-anki-mindmap-text-stats"
      data-testid="mindmap-text-stats"
      data-editing-node={editing?.nodeUid ?? undefined}
      title={title}
    >
      {editingLabel ? (
        <>
          <span data-testid="mindmap-text-stats-card">{editingLabel}</span>
          <span className="memory-anki-mindmap-text-stats-sep" aria-hidden="true">·</span>
          <span>全图 {countFormatter.format(totals.words)} 字</span>
        </>
      ) : (
        <span>{countFormatter.format(totals.words)} 字</span>
      )}
      <span className="memory-anki-mindmap-text-stats-sep" aria-hidden="true">·</span>
      <span>{countFormatter.format(totals.chars)} 字符</span>
    </div>
  )
}
