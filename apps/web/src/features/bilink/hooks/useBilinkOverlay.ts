import { useCallback, useState } from 'react'
import type {
  BilinkItem,
  BilinkNodeContext,
  BilinkSearchResult,
  MindMapEditorState,
} from '@/shared/api/contracts'
import {
  createBilinkApi,
  deleteBilinkApi,
  getBilinkNodeContextApi,
} from '@/features/bilink/api/bilink'
import { getPalaceEditorApi } from '@/shared/api/modules/palaces'
import { useBilinkSearch } from '@/features/bilink/hooks/useBilinkSearch'
import {
  normalizePreviewConfig,
  normalizePreviewEditorDoc,
} from '@/features/palace-edit/model/palace-edit-format'
import { toast } from 'sonner'

type BilinkSearchMode = 'inline' | 'toolbar'

interface UseBilinkOverlayOptions {
  currentPalaceId: number | null
  defaultSourceNodeUid?: string | null
  allowCreate?: boolean
  onBilinkCreated?: () => void
  onBilinkDeleted?: () => void
  onJumpToContext?: (context: BilinkNodeContext) => void
}

export function useBilinkOverlay({
  currentPalaceId,
  defaultSourceNodeUid = null,
  allowCreate = true,
  onBilinkCreated,
  onBilinkDeleted,
  onJumpToContext,
}: UseBilinkOverlayOptions) {
  const [bilinkSearchOpen, setBilinkSearchOpen] = useState(false)
  const [bilinkSearchMode, setBilinkSearchMode] = useState<BilinkSearchMode>('inline')
  const [bilinkSearchQuery, setBilinkSearchQuery] = useState('')
  const [bilinkTriggerNodeUid, setBilinkTriggerNodeUid] = useState<string | null>(null)
  const [bilinkSearchPosition, setBilinkSearchPosition] = useState<{ left: number; top: number } | null>(null)
  const [bilinkPreviewOpen, setBilinkPreviewOpen] = useState(false)
  const [bilinkPreviewLoading, setBilinkPreviewLoading] = useState(false)
  const [bilinkPreviewError, setBilinkPreviewError] = useState('')
  const [bilinkPreviewContext, setBilinkPreviewContext] = useState<BilinkNodeContext | null>(null)
  const [bilinkPreviewEditorState, setBilinkPreviewEditorState] = useState<MindMapEditorState | null>(null)
  const [bilinkInsertionText, setBilinkInsertionText] = useState<string | null>(null)
  const [bilinkInsertionNonce, setBilinkInsertionNonce] = useState(0)
  const bilinkSearch = useBilinkSearch(bilinkSearchQuery, bilinkSearchOpen)

  const openBilinkSearch = useCallback((payload?: {
    mode?: BilinkSearchMode
    nodeUid?: string | null
    query?: string
    position?: { left: number; top: number } | null
  }) => {
    setBilinkSearchMode(payload?.mode ?? 'inline')
    setBilinkTriggerNodeUid(payload?.nodeUid ?? defaultSourceNodeUid ?? null)
    setBilinkSearchQuery(payload?.query ?? '')
    setBilinkSearchPosition(payload?.position ?? null)
    setBilinkSearchOpen(true)
  }, [defaultSourceNodeUid])

  const closeBilinkSearch = useCallback(() => {
    setBilinkSearchOpen(false)
    setBilinkSearchQuery('')
    setBilinkTriggerNodeUid(null)
    setBilinkSearchPosition(null)
  }, [])

  const loadBilinkPreview = useCallback(async (palaceIdForPreview: number, nodeUid?: string | null) => {
    setBilinkPreviewOpen(true)
    setBilinkPreviewLoading(true)
    setBilinkPreviewError('')
    try {
      const [contextResponse, palaceEditorResponse] = await Promise.all([
        getBilinkNodeContextApi(palaceIdForPreview, nodeUid),
        getPalaceEditorApi(palaceIdForPreview),
      ])
      if ('error' in contextResponse) {
        throw new Error(contextResponse.error)
      }
      setBilinkPreviewContext(contextResponse)
      setBilinkPreviewEditorState({
        editor_doc: normalizePreviewEditorDoc(palaceEditorResponse.editor_doc),
        editor_config: normalizePreviewConfig(
          palaceEditorResponse.editor_config as Record<string, unknown> | string | null,
        ),
        editor_local_config: normalizePreviewConfig(
          palaceEditorResponse.editor_local_config as Record<string, unknown> | string | null,
        ),
        lang: palaceEditorResponse.lang || 'zh',
      })
    } catch (error) {
      setBilinkPreviewContext(null)
      setBilinkPreviewEditorState(null)
      setBilinkPreviewError(error instanceof Error ? error.message : '加载节点上下文失败。')
    } finally {
      setBilinkPreviewLoading(false)
    }
  }, [])

  const handleBilinkTrigger = useCallback((payload: {
    nodeUid: string | null
    left: number
    top: number
    query: string
  }) => {
    openBilinkSearch({
      mode: 'inline',
      nodeUid: payload.nodeUid,
      query: payload.query,
      position: {
        left: payload.left,
        top: payload.top,
      },
    })
  }, [openBilinkSearch])

  const handleBilinkNodeClick = useCallback((payload: {
    palaceId: number | null
    nodeUid: string | null
    trigger: 'badge' | 'mark'
  }) => {
    const targetPalaceId = payload.palaceId ?? currentPalaceId
    if (!targetPalaceId) return
    void loadBilinkPreview(targetPalaceId, payload.nodeUid)
  }, [currentPalaceId, loadBilinkPreview])

  const handleBilinkSearchSelect = useCallback(async (result: BilinkSearchResult) => {
    if (!currentPalaceId) return
    if (bilinkSearchMode === 'toolbar' || !allowCreate) {
      await loadBilinkPreview(result.palace_id, result.node_uid)
      closeBilinkSearch()
      return
    }
    if (!bilinkTriggerNodeUid) {
      toast.error('先选中或编辑一个来源节点，再插入双向链接。')
      return
    }

    try {
      const displayText =
        result.type === 'node' ? result.node_text || result.palace_title : result.palace_title
      await createBilinkApi({
        source_palace_id: currentPalaceId,
        target_palace_id: result.palace_id,
        src_uid: bilinkTriggerNodeUid,
        tgt_uid: result.node_uid,
        text: displayText,
      })
      setBilinkInsertionText(`[[${displayText}]]`)
      setBilinkInsertionNonce((value) => value + 1)
      onBilinkCreated?.()
      closeBilinkSearch()
      toast.success('双向链接已创建。')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建双向链接失败。')
    }
  }, [
    allowCreate,
    bilinkSearchMode,
    bilinkTriggerNodeUid,
    closeBilinkSearch,
    currentPalaceId,
    loadBilinkPreview,
    onBilinkCreated,
  ])

  const handleBilinkResultPreview = useCallback((result: BilinkSearchResult) => {
    void loadBilinkPreview(result.palace_id, result.node_uid)
  }, [loadBilinkPreview])

  const handleBilinkDelete = useCallback(async (item: BilinkItem) => {
    const confirmed = window.confirm('删除这条双向链接不会影响脑图节点内容，只会取消两端关联。确定继续吗？')
    if (!confirmed) return
    try {
      await deleteBilinkApi(item.id)
      onBilinkDeleted?.()
      toast.success('双向链接已删除。')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除双向链接失败。')
    }
  }, [onBilinkDeleted])

  const handleBilinkPanelPreview = useCallback((item: BilinkItem) => {
    if (item.direction === 'incoming') {
      void loadBilinkPreview(item.source_palace_id, item.src_uid)
      return
    }
    void loadBilinkPreview(item.target_palace_id, item.tgt_uid)
  }, [loadBilinkPreview])

  const jumpToBilinkContext = useCallback((context: BilinkNodeContext) => {
    setBilinkPreviewOpen(false)
    onJumpToContext?.(context)
  }, [onJumpToContext])

  return {
    bilinkSearchOpen,
    bilinkSearchMode,
    bilinkSearchQuery,
    setBilinkSearchQuery,
    bilinkSearchPosition,
    bilinkSearchResults: bilinkSearch.results,
    bilinkSearchLoading: bilinkSearch.loading,
    bilinkSearchError: bilinkSearch.error,
    bilinkPreviewOpen,
    setBilinkPreviewOpen,
    bilinkPreviewLoading,
    bilinkPreviewError,
    bilinkPreviewContext,
    bilinkPreviewEditorState,
    bilinkInsertionText,
    bilinkInsertionNonce,
    openBilinkSearch,
    closeBilinkSearch,
    handleBilinkTrigger,
    handleBilinkNodeClick,
    handleBilinkSearchSelect,
    handleBilinkResultPreview,
    handleBilinkDelete,
    handleBilinkPanelPreview,
    jumpToBilinkContext,
  }
}
