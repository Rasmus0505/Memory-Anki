import { useEffect, useMemo, useState } from 'react'
import {
  createPalaceSegmentApi,
  deletePalaceSegmentApi,
  getPalaceSegmentsApi,
  updatePalaceSegmentApi,
} from '@/entities/palace-segment/api'
import { appAlert, appConfirm } from '@/shared/components/ui/native-dialog'
import type { PalaceSegmentSummary } from '@/shared/api/contracts'
import type { MindMapSelection } from '@/shared/components/mindmap-host'
import {
  buildSubtreeUidMap,
  getEarlierDateTime,
  type RangeTarget,
  uniqueStrings,
} from '@/features/palace-edit/model/mindmap-editor'
import { formatDateTimeInputValue, toLocalDateTimePayload } from '@/features/palace-edit/model/palace-edit-format'
import type { MindMapDoc } from '@/shared/api/contracts'
import type { PalaceMeta } from '@/features/palace-edit/model/palace-edit-types'

interface PalaceSegmentsControllerOptions {
  palaceId: number | null
  palace: PalaceMeta | null
  parsedEditorDoc: MindMapDoc | null
  selectedNodes: MindMapSelection[]
  timer: {
    registerActivity: (kind: string, meta?: Record<string, unknown>) => void
  }
}

export function usePalaceSegmentsController({
  palaceId,
  palace,
  parsedEditorDoc,
  selectedNodes,
  timer,
}: PalaceSegmentsControllerOptions) {
  const [segments, setSegments] = useState<PalaceSegmentSummary[]>([])
  const [segmentDialogOpen, setSegmentDialogOpen] = useState(false)
  const [segmentName, setSegmentName] = useState('')
  const [segmentColor, setSegmentColor] = useState('#14b8a6')
  const [segmentCreatedAt, setSegmentCreatedAt] = useState('')
  const [editingSegmentId, setEditingSegmentId] = useState<number | null>(null)
  const [activeSegmentId, setActiveSegmentId] = useState<number | null>(null)
  const [segmentSaving, setSegmentSaving] = useState(false)
  const [segmentMergingId, setSegmentMergingId] = useState<number | null>(null)
  const [segmentError, setSegmentError] = useState('')
  const [isSegmentRangeMode, setIsSegmentRangeMode] = useState(false)
  const [rangeTargetSegmentId, setRangeTargetSegmentId] = useState<RangeTarget>(null)
  const [selectedRangeNodeUids, setSelectedRangeNodeUids] = useState<string[]>([])
  const [overriddenConflictNodeUids, setOverriddenConflictNodeUids] = useState<string[]>([])

  useEffect(() => {
    if (!palace) return
    const nextSegments = palace.segments ?? []
    setSegments(nextSegments)
    setActiveSegmentId((current) =>
      current != null && nextSegments.some((segment) => segment.id === current)
        ? current
        : nextSegments[0]?.id ?? null,
    )
    setRangeTargetSegmentId((current) => {
      if (current === 'new') return current
      return current != null && nextSegments.some((segment) => segment.id === current)
        ? current
        : null
    })
  }, [palace])

  const subtreeUidMap = useMemo(() => buildSubtreeUidMap(parsedEditorDoc), [parsedEditorDoc])
  const segmentById = useMemo(
    () => new Map(segments.map((segment) => [segment.id, segment] as const)),
    [segments],
  )
  const currentRangeTargetSegment =
    typeof rangeTargetSegmentId === 'number' ? segmentById.get(rangeTargetSegmentId) ?? null : null
  const selectedRangeNodeCount = selectedRangeNodeUids.length
  const activeSegment = segments.find((segment) => segment.id === activeSegmentId) ?? null

  const refreshSegments = async () => {
    if (!palaceId) return
    const result = await getPalaceSegmentsApi(palaceId)
    setSegments(result.items)
    setActiveSegmentId((current) =>
      current != null && result.items.some((segment) => segment.id === current)
        ? current
        : result.items[0]?.id ?? null,
    )
    setRangeTargetSegmentId((current) => {
      if (current === 'new') return current
      return current != null && result.items.some((segment) => segment.id === current) ? current : null
    })
  }

  const handleOpenCreateSegment = () => {
    setSegmentError('')
    setEditingSegmentId(null)
    setSegmentName('')
    setSegmentColor('#14b8a6')
    setSegmentCreatedAt(
      formatDateTimeInputValue(
        segments.length === 0 ? palace?.created_at ?? new Date().toISOString() : new Date().toISOString(),
      ),
    )
    setSegmentDialogOpen(true)
  }

  const handleOpenEditSegment = (segment: PalaceSegmentSummary) => {
    if (segment.is_virtual_default) {
      setSegmentError('默认第 1 部分不单独保存为实体分块，时间沿用宫殿本身。')
      return
    }
    setSegmentError('')
    setEditingSegmentId(segment.id)
    setSegmentName(segment.name)
    setSegmentColor(segment.color)
    setSegmentCreatedAt(formatDateTimeInputValue(segment.created_at))
    setActiveSegmentId(segment.id)
    setSegmentDialogOpen(true)
  }

  const enterSegmentRangeMode = (target: RangeTarget) => {
    const sourceSegment =
      target === 'new'
        ? null
        : typeof target === 'number'
          ? segments.find((segment) => segment.id === target) ?? null
          : null
    setIsSegmentRangeMode(true)
    setRangeTargetSegmentId(target)
    setSelectedRangeNodeUids(sourceSegment ? [...sourceSegment.node_uids] : [])
    setOverriddenConflictNodeUids([])
    if (typeof target === 'number') {
      setActiveSegmentId(target)
    }
  }

  const exitSegmentRangeMode = () => {
    setIsSegmentRangeMode(false)
    setRangeTargetSegmentId(null)
    setSelectedRangeNodeUids([])
    setOverriddenConflictNodeUids([])
  }

  const handleSegmentRangeModeToggle = (payload: {
    active: boolean
    targetSegmentId: RangeTarget
  }) => {
    if (!payload.active) {
      exitSegmentRangeMode()
      return
    }
    enterSegmentRangeMode(payload.targetSegmentId ?? 'new')
  }

  const handleSegmentRangeDraftChange = (payload: {
    selectedNodeUids: string[]
    overriddenConflictNodeUids: string[]
  }) => {
    setSelectedRangeNodeUids(uniqueStrings(payload.selectedNodeUids))
    setOverriddenConflictNodeUids(uniqueStrings(payload.overriddenConflictNodeUids))
  }

  const handleAdjustSegmentRange = (segment: PalaceSegmentSummary) => {
    enterSegmentRangeMode(segment.id)
  }

  const handleConfirmSegmentRange = () => {
    if (!selectedRangeNodeUids.length) {
      void appAlert('先在脑图里选中至少一个节点，再确认分块范围。', { title: '无法确认分块范围' })
      return
    }
    timer.registerActivity('edit_operation', { source: 'segment_range_confirm' })
    if (typeof rangeTargetSegmentId === 'number') {
      const segment = segments.find((item) => item.id === rangeTargetSegmentId)
      if (!segment) return
      handleOpenEditSegment(segment)
      return
    }
    handleOpenCreateSegment()
  }

  const handleSaveSegment = async () => {
    if (!palaceId) return
    timer.registerActivity('edit_operation', { source: 'segment_save' })
    setSegmentSaving(true)
    setSegmentError('')
    const selectedNodeUids = uniqueStrings(
      isSegmentRangeMode
        ? selectedRangeNodeUids
        : selectedNodes
            .map((node) => node.uid)
            .filter((value): value is string => Boolean(value)),
    )
    try {
      const isEditingVirtualDefault =
        editingSegmentId != null && segments.find((segment) => segment.id === editingSegmentId)?.is_virtual_default
      if (editingSegmentId && !isEditingVirtualDefault) {
        await updatePalaceSegmentApi(editingSegmentId, {
          name: segmentName,
          color: segmentColor,
          created_at: toLocalDateTimePayload(segmentCreatedAt),
          ...(selectedNodeUids.length > 0 ? { node_uids: selectedNodeUids } : {}),
        })
      } else {
        await createPalaceSegmentApi(palaceId, {
          name: segmentName,
          color: segmentColor,
          created_at: toLocalDateTimePayload(segmentCreatedAt),
          node_uids: selectedNodeUids,
        })
      }
      await refreshSegments()
      setSegmentDialogOpen(false)
      exitSegmentRangeMode()
    } catch (error) {
      setSegmentError(error instanceof Error ? error.message : '保存分块失败，请稍后重试。')
    } finally {
      setSegmentSaving(false)
    }
  }

  const handleDeleteSegment = async (segmentId: number) => {
    const confirmed = await appConfirm('删除这个分块只会取消这组节点的分块划分，不会删除任何脑图内容。确定继续吗？', {
      title: '删除复习分块',
      tone: 'danger',
    })
    if (!confirmed) return
    timer.registerActivity('edit_operation', { source: 'segment_delete' })
    await deletePalaceSegmentApi(segmentId)
    await refreshSegments()
  }

  const handleMergeSegment = async (sourceSegmentId: number, targetSegmentId: number) => {
    if (sourceSegmentId === targetSegmentId) return
    const sourceSegment = segments.find((segment) => segment.id === sourceSegmentId)
    const targetSegment = segments.find((segment) => segment.id === targetSegmentId)
    if (!sourceSegment || !targetSegment) return

    timer.registerActivity('edit_operation', { source: 'segment_merge' })
    setSegmentMergingId(sourceSegmentId)
    try {
      await updatePalaceSegmentApi(targetSegmentId, {
        created_at: getEarlierDateTime(targetSegment.created_at, sourceSegment.created_at),
        node_uids: uniqueStrings([...targetSegment.node_uids, ...sourceSegment.node_uids]),
      })
      await deletePalaceSegmentApi(sourceSegmentId)
      await refreshSegments()
      setActiveSegmentId(targetSegmentId)
    } finally {
      setSegmentMergingId(null)
    }
  }

  return {
    segments,
    activeSegment,
    activeSegmentId,
    setActiveSegmentId,
    segmentDialogOpen,
    setSegmentDialogOpen,
    segmentName,
    setSegmentName,
    segmentColor,
    setSegmentColor,
    segmentCreatedAt,
    setSegmentCreatedAt,
    editingSegmentId,
    segmentSaving,
    segmentMergingId,
    segmentError,
    isSegmentRangeMode,
    rangeTargetSegmentId,
    selectedRangeNodeUids,
    overriddenConflictNodeUids,
    selectedRangeNodeCount,
    currentRangeTargetSegment,
    subtreeUidMap,
    refreshSegments,
    handleOpenCreateSegment,
    handleOpenEditSegment,
    handleAdjustSegmentRange,
    handleSegmentRangeModeToggle,
    handleSegmentRangeDraftChange,
    handleConfirmSegmentRange,
    handleSaveSegment,
    handleDeleteSegment,
    handleMergeSegment,
  }
}
