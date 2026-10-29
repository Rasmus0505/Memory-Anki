import {
  countMindMapTextMetrics,
  type MindMapTextMetrics,
} from '@/modules/content/domain/mindmap-document-entity'

export interface MindMapEditingStatsSnapshot {
  nodeUid: string
  metrics: MindMapTextMetrics
}

/**
 * 正在编辑的那张卡的实时字数。
 *
 * 编辑按键刻意只写 `interactionRef`、不走 React state（见
 * `useMindMapNodeEditing` 的说明：逐键 setState 会重建编辑面和整份文档指纹）。
 * 因此这里用外部 store + `useSyncExternalStore`：按键只重渲染右下角统计这一行，
 * 画布、卡片和宿主都不参与。
 *
 * 每个编辑面持有自己的实例，避免随心流里多张卡同时挂载时串数。
 */
export class MindMapEditingStatsStore {
  private snapshot: MindMapEditingStatsSnapshot | null = null
  private readonly listeners = new Set<() => void>()

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): MindMapEditingStatsSnapshot | null => this.snapshot

  /** 只敲空格、改标点等不改变统计的按键直接吞掉，不触发重渲染。 */
  publish(nodeUid: string, draftText: string) {
    const metrics = countMindMapTextMetrics(draftText)
    const current = this.snapshot
    if (
      current
      && current.nodeUid === nodeUid
      && current.metrics.words === metrics.words
      && current.metrics.chars === metrics.chars
    ) {
      return
    }
    this.snapshot = { nodeUid, metrics }
    this.emit()
  }

  clear() {
    if (!this.snapshot) return
    this.snapshot = null
    this.emit()
  }

  private emit() {
    for (const listener of this.listeners) listener()
  }
}
