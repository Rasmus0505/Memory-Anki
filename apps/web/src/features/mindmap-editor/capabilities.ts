import { Brain, FolderTree, Sparkles, Target } from 'lucide-react'
import type { MindMapHostSegmentRangeDraft, MindMapHostSegmentSummary } from '@/shared/api/contracts'
import type { ContextMenuAction } from '@/shared/ui/mindmap-canvas/NodeContextMenu'
import type { MindMapAiSplitRequestPayload } from '@/shared/ui/mindmap-canvas/capabilities'
import type { EditorDocGraphOptions } from './documentGraphProjection'
import type { MindMapSelection } from '@/entities/mindmap-document'

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
  masteryByNodeUid: Record<string, { status: string; manualLabel?: string | null }>
  miniPalaceDraft: { active: boolean; selectedNodeUids: string[] }
  practiceModeActive: boolean
  revealMap?: Record<string, 'hidden' | 'placeholder' | 'revealed'>
  aiSplitBusy: boolean
  onAiSplitRequest?: (payload: MindMapAiSplitRequestPayload) => void
  onCreateSegmentFromSelection?: () => void
  onSegmentRangeDraftChange?: (payload: {
    selectedNodeUids: string[]
    overriddenConflictNodeUids: string[]
  }) => void
  onNodeClick?: (nodes: MindMapSelection[]) => void
  onNodeContextMenu?: (nodes: MindMapSelection[]) => void
  onMiniPalacePour?: () => void
}

export function createMindMapCapabilities(options: CapabilityFactoryOptions): MindMapCapability[] {
  const capabilities: MindMapCapability[] = [
    { key: 'search-decoration', graphOptions: { highlightedNodeUids: options.highlightedNodeUids } },
    { key: 'mastery-decoration', graphOptions: { masteryByNodeUid: options.masteryByNodeUid } },
  ]

  if (options.revealMap) capabilities.push({ key: 'review-reveal', graphOptions: { revealMap: options.revealMap } })

  if (options.segments.length || options.segmentRangeDraft.active || options.onCreateSegmentFromSelection) {
    capabilities.push(createSegmentCapability(options))
  }
  if (options.onAiSplitRequest) capabilities.push(createAiSplitCapability(options))
  if (options.miniPalaceDraft.active) capabilities.push(createMiniPalaceCapability(options))
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

function createAiSplitCapability(options: CapabilityFactoryOptions): MindMapCapability {
  return {
    key: 'ai-split',
    getNodeActions: ({ nodeId, selection, isRoot, readonly, practiceModeActive }) => {
      if (readonly || practiceModeActive || !options.onAiSplitRequest) return []
      const selected = selection[0]
      return [{
        label: options.aiSplitBusy ? '正在整理知识点...' : 'AI 拆分知识点',
        icon: Sparkles,
        disabled: options.aiSplitBusy,
        onClick: () => options.onAiSplitRequest?.({
          target_node_uid: selected?.uid ?? nodeId,
          target_node_text: selected?.text ?? '',
          target_node_note: selected?.note ?? '',
          target_node_type: selected?.memoryAnkiNodeType ?? null,
          is_root: isRoot,
        }),
      }]
    },
  }
}

function createMiniPalaceCapability(options: CapabilityFactoryOptions): MindMapCapability {
  return {
    key: 'mini-palace',
    graphOptions: { miniPalaceDraft: options.miniPalaceDraft },
    locksEditing: true,
    getNodeActions: ({ selection }) => [{
      label: '选为迷你宫殿训练知识点',
      icon: Target,
      onClick: () => options.onNodeClick?.(selection),
    }],
    handleFocusToggle: () => {
      if (!options.onMiniPalacePour) return false
      options.onMiniPalacePour()
      return true
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
