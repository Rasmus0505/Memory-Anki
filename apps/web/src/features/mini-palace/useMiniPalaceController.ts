import * as React from 'react'
import { toast } from '@/shared/feedback/toast'
import type { RevealState } from '@/entities/session/model'
import type { MindMapDoc, MindMapEditorState, MiniPalaceSummary } from '@/shared/api/contracts'
import type { MindMapSelection } from '@/shared/components/mindmap-host'
import {
  createMiniPalaceApi,
  deleteMiniPalaceApi,
  getMiniPalacesApi,
  updateMiniPalaceApi,
} from '@/shared/api/modules/palaces'
import { buildSubtreeUidMap } from '@/features/palace-edit/model/mindmap-editor'
import {
  advanceRevealStateForNodeClick,
  buildReviewTree,
  buildSelectionNodeId,
  flattenNodes,
  hideRevealStateBranch,
  parseEditorDoc,
} from '@/entities/review/model/review-flow-tree'
import {
  buildMiniPalaceRevealState,
  buildMiniPalaceVisibleEditorState,
  isMiniPalaceRevealComplete,
  pourMiniPalaceRevealState,
  sanitizeMiniPalaceCheckpointIds,
} from '@/features/mini-palace/model/mini-palace-flow'

type MiniPalaceMode = 'idle' | 'selecting' | 'practicing'

interface TimerLike {
  registerActivity: (
    kind: string,
    meta?: Record<string, boolean | number | string | null>,
  ) => void
  logEvent?: (
    type: string,
    meta?: Record<string, boolean | number | string | null>,
  ) => void
}

interface MiniPalaceControllerOptions {
  palaceId: number | null
  title: string
  editorState: MindMapEditorState | null
  selectedNodeUid: string | null
  selectedNodeText: string
  timer: TimerLike
}

export interface MiniPalaceDraftState {
  active: boolean
  selectedNodeUids: string[]
}

export function useMiniPalaceController({
  palaceId,
  title,
  editorState,
  selectedNodeUid,
  selectedNodeText,
  timer,
}: MiniPalaceControllerOptions) {
  const [items, setItems] = React.useState<MiniPalaceSummary[]>([])
  const [panelOpen, setPanelOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState('')
  const [mode, setMode] = React.useState<MiniPalaceMode>('idle')
  const [draftName, setDraftName] = React.useState('')
  const [draftNodeUids, setDraftNodeUids] = React.useState<string[]>([])
  const [activeMiniPalace, setActiveMiniPalace] = React.useState<MiniPalaceSummary | null>(null)
  const [revealMap, setRevealMap] = React.useState<Record<string, RevealState>>({})
  const [hoveredNodeId, setHoveredNodeId] = React.useState<string | null>(null)
  const hoveredNodeIdRef = React.useRef<string | null>(null)

  const parsedDoc = React.useMemo(
    () => parseEditorDoc(editorState?.editor_doc ?? null),
    [editorState?.editor_doc],
  )
  const root = React.useMemo(() => buildReviewTree(parsedDoc, title), [parsedDoc, title])
  const nodeMap = React.useMemo(() => flattenNodes(root), [root])
  const subtreeUidMap = React.useMemo(() => buildSubtreeUidMap(parsedDoc as MindMapDoc | null), [parsedDoc])
  const docFingerprint = React.useMemo(() => JSON.stringify(parsedDoc ?? {}), [parsedDoc])
  const validNodeIds = React.useMemo(() => new Set(nodeMap.keys()), [nodeMap])
  const validCheckpointIds = React.useMemo(() => {
    const next = new Set(validNodeIds)
    next.delete(root.id)
    return next
  }, [root.id, validNodeIds])

  const completed = React.useMemo(() => {
    if (mode !== 'practicing' || !activeMiniPalace) return false
    return isMiniPalaceRevealComplete(root, activeMiniPalace.node_uids, revealMap)
  }, [activeMiniPalace, mode, revealMap, root])

  React.useEffect(() => {
    setDraftNodeUids((current) => current.filter((uid) => validCheckpointIds.has(uid)))
    if (mode !== 'practicing' || !activeMiniPalace) return
    setRevealMap((current): Record<string, RevealState> =>
      buildMiniPalaceRevealState(root, activeMiniPalace.node_uids, current),
    )
  }, [activeMiniPalace, docFingerprint, mode, root, validCheckpointIds])

  const refresh = React.useCallback(async () => {
    if (!palaceId) {
      setItems([])
      return []
    }
    setLoading(true)
    setError('')
    try {
      const response = await getMiniPalacesApi(palaceId)
      setItems(response.items)
      return response.items
    } catch (err) {
      const message = err instanceof Error ? err.message : '加载小宫殿失败。'
      setError(message)
      return []
    } finally {
      setLoading(false)
    }
  }, [palaceId])

  React.useEffect(() => {
    setPanelOpen(false)
    setItems([])
    setMode('idle')
    setDraftName('')
    setDraftNodeUids([])
    setActiveMiniPalace(null)
    setRevealMap({})
    setHoveredNodeId(null)
  }, [palaceId])

  const openPanel = React.useCallback(() => {
    if (!palaceId) return
    timer.registerActivity('practice_interaction', { source: 'mini_palace_open' })
    setPanelOpen(true)
    void refresh()
  }, [palaceId, refresh, timer])

  const closePanel = React.useCallback(() => {
    setPanelOpen(false)
  }, [])

  const startCreate = React.useCallback(() => {
    if (!editorState) return
    timer.registerActivity('practice_interaction', { source: 'mini_palace_create_start' })
    const selectedNodeName =
      selectedNodeUid && selectedNodeUid !== root.id ? selectedNodeText.trim() : ''
    setPanelOpen(false)
    setMode('selecting')
    setDraftName(selectedNodeName)
    setDraftNodeUids([])
    setActiveMiniPalace(null)
  }, [editorState, root.id, selectedNodeText, selectedNodeUid, timer])

  const cancelCreate = React.useCallback(() => {
    timer.registerActivity('practice_interaction', { source: 'mini_palace_create_cancel' })
    setMode('idle')
    setDraftName('')
    setDraftNodeUids([])
  }, [timer])

  const startPractice = React.useCallback((item: MiniPalaceSummary) => {
    if (!editorState) return
    const checkpoints = sanitizeMiniPalaceCheckpointIds(root, item.node_uids)
    if (checkpoints.length === 0) {
      toast.info('这个小宫殿没有可练习的卡片。')
      return
    }
    timer.registerActivity('practice_interaction', { source: 'mini_palace_practice_start' })
    timer.logEvent?.('enter_edit_mode', { source: 'mini_palace_practice' })
    setPanelOpen(false)
    setMode('practicing')
    setActiveMiniPalace({ ...item, node_uids: checkpoints, node_count: checkpoints.length })
    setRevealMap(buildMiniPalaceRevealState(root, checkpoints))
    setHoveredNodeId(null)
  }, [editorState, root, timer])

  const startEdit = React.useCallback((item: MiniPalaceSummary) => {
    if (!editorState) return
    timer.registerActivity('practice_interaction', { source: 'mini_palace_edit_start' })
    setPanelOpen(false)
    setMode('selecting')
    setActiveMiniPalace(item)
    setDraftName(item.name)
    setDraftNodeUids([...item.node_uids])
  }, [editorState, timer])

  const confirmCreate = React.useCallback(async () => {
    if (!palaceId) return
    const checkpoints = draftNodeUids.filter((uid) => validCheckpointIds.has(uid))
    if (checkpoints.length === 0) {
      toast.info('先在脑图里选中至少一张卡片。')
      return
    }
    setSaving(true)
    setError('')
    timer.registerActivity('practice_interaction', { source: 'mini_palace_create_confirm' })
    try {
      if (activeMiniPalace) {
        const response = await updateMiniPalaceApi(activeMiniPalace.id, { name: draftName, node_uids: checkpoints })
        await refresh()
        setDraftName('')
        setDraftNodeUids([])
        setMode('idle')
        setActiveMiniPalace(null)
        toast.success('小宫殿已更新')
      } else {
        const response = await createMiniPalaceApi(palaceId, {
          name: draftName,
          node_uids: checkpoints,
        })
        const nextItems = await refresh()
        const created =
          nextItems.find((item) => item.id === response.item.id) ?? response.item
        setDraftName('')
        setDraftNodeUids([])
        startPractice(created)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '保存小宫殿失败。'
      setError(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }, [activeMiniPalace, draftName, draftNodeUids, palaceId, refresh, startPractice, timer, validCheckpointIds])

  const renameMiniPalace = React.useCallback(async (item: MiniPalaceSummary, name: string) => {
    setSaving(true)
    setError('')
    timer.registerActivity('edit_operation', { source: 'mini_palace_rename' })
    try {
      const response = await updateMiniPalaceApi(item.id, { name })
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === item.id ? response.item : candidate,
        ),
      )
      if (activeMiniPalace?.id === item.id) {
        setActiveMiniPalace(response.item)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '重命名小宫殿失败。'
      setError(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }, [activeMiniPalace?.id, timer])

  const deleteMiniPalace = React.useCallback(async (item: MiniPalaceSummary) => {
    const confirmed = window.confirm('删除这个小宫殿只会删除这组练习入口，不会删除脑图卡片。确定继续吗？')
    if (!confirmed) return
    setSaving(true)
    setError('')
    timer.registerActivity('edit_operation', { source: 'mini_palace_delete' })
    try {
      await deleteMiniPalaceApi(item.id)
      setItems((current) => current.filter((candidate) => candidate.id !== item.id))
      if (activeMiniPalace?.id === item.id) {
        setMode('idle')
        setActiveMiniPalace(null)
        setRevealMap({})
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '删除小宫殿失败。'
      setError(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }, [activeMiniPalace?.id, timer])

  const exitPractice = React.useCallback(() => {
    timer.registerActivity('practice_interaction', { source: 'mini_palace_exit' })
    timer.logEvent?.('exit_edit_mode', { source: 'mini_palace_practice' })
    setMode('idle')
    setActiveMiniPalace(null)
    setRevealMap({})
    setHoveredNodeId(null)
  }, [timer])

  const toggleSingleDraftNode = React.useCallback((nodeUid: string) => {
    if (!validCheckpointIds.has(nodeUid)) return
    setDraftNodeUids((current) =>
      current.includes(nodeUid)
        ? current.filter((uid) => uid !== nodeUid)
        : [...current, nodeUid],
    )
  }, [validCheckpointIds])

  const toggleSubtreeDraftNodes = React.useCallback((nodeUid: string) => {
    const subtreeUids = (subtreeUidMap.get(nodeUid) ?? [nodeUid]).filter((uid) =>
      validCheckpointIds.has(uid),
    )
    if (subtreeUids.length === 0) return
    setDraftNodeUids((current) => {
      const currentSet = new Set(current)
      const allSelected = subtreeUids.every((uid) => currentSet.has(uid))
      if (allSelected) {
        subtreeUids.forEach((uid) => currentSet.delete(uid))
      } else {
        subtreeUids.forEach((uid) => {
          if (validCheckpointIds.has(uid)) {
            currentSet.add(uid)
          }
        })
      }
      return Array.from(currentSet)
    })
  }, [subtreeUidMap, validCheckpointIds])

  const handleNodeHover = React.useCallback((nodes: MindMapSelection[]) => {
    const nodeId = buildSelectionNodeId(nodes[0] ?? null)
    hoveredNodeIdRef.current = nodeId
    setHoveredNodeId(nodeId)
  }, [])

  const handleSpacePour = React.useCallback(() => {
    if (mode !== 'practicing' || !activeMiniPalace) return
    const targetId = hoveredNodeIdRef.current
    if (!targetId) return
    timer.registerActivity('practice_interaction', { source: 'mini_palace_space_pour' })
    setRevealMap((current) => {
      const currentNode = nodeMap.get(targetId)
      if (!currentNode) return current
      return pourMiniPalaceRevealState(targetId, root, nodeMap, activeMiniPalace.node_uids, current)
    })
  }, [activeMiniPalace, mode, nodeMap, root, timer])

  const handleNodeClick = React.useCallback((nodes: MindMapSelection[]) => {
    const nodeId = buildSelectionNodeId(nodes[0] ?? null)
    if (!nodeId) return
    if (mode === 'selecting') {
      timer.registerActivity('practice_interaction', { source: 'mini_palace_select_click' })
      toggleSingleDraftNode(nodeId)
      return
    }
    if (mode !== 'practicing' || !activeMiniPalace) return
    timer.registerActivity('practice_interaction', { source: 'mini_palace_flip_click' })
    setRevealMap((current) => advanceRevealStateForNodeClick(nodeId, nodeMap, current))
  }, [activeMiniPalace, mode, nodeMap, timer, toggleSingleDraftNode])

  const handleNodeContextMenu = React.useCallback((nodes: MindMapSelection[]) => {
    const nodeId = buildSelectionNodeId(nodes[0] ?? null)
    if (!nodeId) return
    if (mode === 'selecting') {
      timer.registerActivity('practice_interaction', { source: 'mini_palace_select_contextmenu' })
      toggleSubtreeDraftNodes(nodeId)
      return
    }
    if (mode === 'practicing') {
      timer.registerActivity('practice_interaction', { source: 'mini_palace_hide_contextmenu' })
      setRevealMap((current) => hideRevealStateBranch(nodeId, nodeMap, current))
    }
  }, [mode, timer, toggleSubtreeDraftNodes, nodeMap])

  const visibleEditorState = React.useMemo(() => {
    if (!editorState || mode !== 'practicing') return null
    return buildMiniPalaceVisibleEditorState(
      editorState,
      parsedDoc,
      revealMap,
      nodeMap,
      activeMiniPalace ? `${title} / ${activeMiniPalace.name}` : title,
    )
  }, [activeMiniPalace, editorState, mode, nodeMap, parsedDoc, revealMap, title])

  const visibleSyncKey = React.useMemo(
    () =>
      JSON.stringify({
        mode,
        activeMiniPalaceId: activeMiniPalace?.id ?? null,
        draftNodeUids: [...draftNodeUids].sort(),
        revealMap,
        completed,
      }),
    [activeMiniPalace?.id, completed, draftNodeUids, mode, revealMap],
  )

  return {
    activeMiniPalace,
    cancelCreate,
    closePanel,
    completed,
    confirmCreate,
    deleteMiniPalace,
    draftName,
    draftNodeUids,
    error,
    exitPractice,
    handleNodeClick,
    handleNodeContextMenu,
    handleNodeHover,
    handleSpacePour,
    hoveredNodeId,
    hostDraft: {
      active: mode === 'selecting',
      selectedNodeUids: draftNodeUids,
    } satisfies MiniPalaceDraftState,
    isActive: mode !== 'idle',
    isPracticing: mode === 'practicing',
    isSelecting: mode === 'selecting',
    items,
    loading,
    mode,
    openPanel,
    panelOpen,
    refresh,
    renameMiniPalace,
    saving,
    setDraftName,
    setPanelOpen,
    startCreate,
    startEdit,
    startPractice,
    visibleEditorState,
    visibleSyncKey,
  }
}

export type MiniPalaceController = ReturnType<typeof useMiniPalaceController>
