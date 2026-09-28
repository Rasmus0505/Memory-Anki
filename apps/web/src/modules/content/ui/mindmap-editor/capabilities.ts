import { Brain, FolderTree } from 'lucide-react'
import type { MindMapHostSegmentRangeDraft, MindMapHostSegmentSummary } from '@/shared/api/contracts'
import type { MindMapCountBadge } from '@/shared/ui/mindmap-canvas/adapter'
import type { ContextMenuAction } from '@/shared/ui/mindmap-canvas/NodeContextMenu'
import type { EditorDocGraphOptions } from './documentGraphProjection'
import type { MindMapSelection } from '@/modules/content/domain/mindmap-document-entity'

export interface MindMapCapabilityContext {
  nodeId: string
  selection: MindMapSelection[]
  isRoot: boolean
  readonly: boolean
  practiceModeActive: boolean
}

export interface MindMapCapability {
  key: string
  graphOptions?: EditorDocGraphOptions
  locksEditing?: boolean
  getNodeActions?(context: MindMapCapabilityContext): ContextMenuAction[]
  handleFocusToggle?(): boolean
}

interface CapabilityFactoryOptions {
  segments: MindMapHostSegmentSummary[]
  activeSegmentId: number | null
  segmentColorMode: 'all' | 'active-only' | 'all-with-active-emphasis'
  segmentRangeDraft: MindMapHostSegmentRangeDraft
  highlightedNodeUids: string[]
  outlinedNodeUids?: string[]
  mutedNodeUids?: string[]
  masteryByNodeUid: Record<string, { status: string; manualLabel?: string | null; masteryScore?: number | null }>
  statusChipsByNodeUid?: Record<
    string,
    Array<{ text: string; tone: 'danger' | 'success' | 'warning' | 'info' | 'neutral'; style: 'filled' | 'outline' }>
  >
  countBadgeByNodeUid?: Record<string, MindMapCountBadge[]>
  practiceModeActive: boolean
  revealMap?: Record<string, 'hidden' | 'placeholder' | 'revealed'>
  onCreateSegmentFromSelection?: () => void
  onSegmentRangeDraftChange?: (payload: {
    selectedNodeUids: string[]
    overriddenConflictNodeUids: string[]
  }) => void
  onNodeClick?: (nodes: MindMapSelection[]) => void
  onNodeContextMenu?: (nodes: MindMapSelection[]) => void
}

export function createMindMapCapabilities(options: CapabilityFactoryOptions): MindMapCapability[] {
  const capabilities: MindMapCapability[] = [
    { key: 'search-decoration', graphOptions: { highlightedNodeUids: options.highlightedNodeUids } },
    { key: 'mastery-decoration', graphOptions: { masteryByNodeUid: options.masteryByNodeUid } },
  ]

  if (options.outlinedNodeUids && options.outlinedNodeUids.length > 0) {
    capabilities.push({
      key: 'outlined-nodes',
      graphOptions: { outlinedNodeUids: options.outlinedNodeUids },
    })
  }

  if (options.mutedNodeUids && options.mutedNodeUids.length > 0) {
    capabilities.push({
      key: 'muted-nodes',
      graphOptions: { mutedNodeUids: options.mutedNodeUids },
    })
  }

  if (options.statusChipsByNodeUid && Object.keys(options.statusChipsByNodeUid).length > 0) {
    capabilities.push({
      key: 'status-chips',
      graphOptions: { statusChipsByNodeUid: options.statusChipsByNodeUid },
    })
  }

  if (options.countBadgeByNodeUid && Object.keys(options.countBadgeByNodeUid).length > 0) {
    capabilities.push({
      key: 'count-badges',
      graphOptions: { countBadgeByNodeUid: options.countBadgeByNodeUid },
    })
  }

  if (options.revealMap) capabilities.push({ key: 'review-reveal', graphOptions: { revealMap: options.revealMap } })

  if (options.segments.length || options.segmentRangeDraft.active || options.onCreateSegmentFromSelection) {
    capabilities.push(createSegmentCapability(options))
  }
  if (options.practiceModeActive) capabilities.push(createPracticeCapability(options))

  return capabilities
}

function createSegmentCapability(options: CapabilityFactoryOptions): MindMapCapability {
  return {
    key: 'segments',
    graphOptions: {
      segments: options.segments,
      activeSegmentId: options.activeSegmentId,
      segmentColorMode: options.segmentColorMode,
      segmentRangeDraft: options.segmentRangeDraft,
    },
    getNodeActions: ({ nodeId, readonly }) => {
      const actions: ContextMenuAction[] = []
      if (options.segmentRangeDraft.active) {
        actions.push({
          label: '加入/移出当前学习组',
          icon: FolderTree,
          onClick: () => {
            const selectedNodeUids = new Set(options.segmentRangeDraft.selectedNodeUids)
            if (selectedNodeUids.has(nodeId)) selectedNodeUids.delete(nodeId)
            else selectedNodeUids.add(nodeId)
            options.onSegmentRangeDraftChange?.({
              selectedNodeUids: [...selectedNodeUids],
              overriddenConflictNodeUids: options.segmentRangeDraft.overriddenConflictNodeUids,
            })
          },
        })
      }
      if (options.onCreateSegmentFromSelection && !readonly) {
        actions.push({
          label: '将选中内容组成学习组',
          icon: FolderTree,
          onClick: options.onCreateSegmentFromSelection,
        })
      }
      return actions
    },
  }
}

function createPracticeCapability(options: CapabilityFactoryOptions): MindMapCapability {
  return {
    key: 'practice',
    getNodeActions: ({ selection }) => [{
      label: '隐藏这个分支',
      icon: Brain,
      onClick: () => options.onNodeContextMenu?.(selection),
    }],
  }
}

export function mergeMindMapGraphOptions(capabilities: readonly MindMapCapability[]) {
  return capabilities.reduce<EditorDocGraphOptions>(
    (merged, capability) => ({ ...merged, ...(capability.graphOptions ?? {}) }),
    {},
  )
}
