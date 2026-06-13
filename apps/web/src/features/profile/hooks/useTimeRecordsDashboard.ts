import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { toast } from 'sonner'
import {
  createTimeRecord,
  getDailyTrend,
  getSessionKindBreakdown,
  getTimeRecordSummary,
  getTrendByRange,
  getTimeRecordingThresholdSeconds,
  listTimeRecords,
  restoreTimeRecord,
  setTimeRecordingThresholdSeconds,
  softDeleteTimeRecord,
  type SessionKind,
  type TimeRecordChartRange,
  type TimeSessionRecord,
  updateTimeRecord,
} from '@/entities/session/model'
import {
  applyTimeRecordFormPatch,
  buildTimeRecordFormState,
  isTimeRecordAboveThreshold,
  parseTimeRecordFormState,
  type TimeRecordFormState,
} from '@/features/profile/model/time-record-form'

export interface UseTimeRecordsDashboardResult {
  thresholdSeconds: number
  thresholdInput: string
  setThresholdInput: (value: string) => void
  showBelowThreshold: boolean
  setShowBelowThreshold: (value: boolean) => void
  showDeleted: boolean
  setShowDeleted: (value: boolean) => void
  kindFilter: 'all' | SessionKind
  setKindFilter: (value: 'all' | SessionKind) => void
  keyword: string
  setKeyword: (value: string) => void
  selectedRecordIds: string[]
  dialogMode: 'create' | 'edit'
  dialogOpen: boolean
  formState: TimeRecordFormState
  formError: string | null
  isSubmittingRecord: boolean
  deletingRecordId: string | null
  restoringRecordId: string | null
  isBulkDeleting: boolean
  summary: ReturnType<typeof getTimeRecordSummary>
  trend: ReturnType<typeof getDailyTrend>
  breakdown: ReturnType<typeof getSessionKindBreakdown>
  getTrendForRange: (
    range: TimeRecordChartRange,
  ) => ReturnType<typeof getDailyTrend>
  getBreakdownForRange: (
    range: TimeRecordChartRange,
  ) => ReturnType<typeof getSessionKindBreakdown>
  visibleRecords: TimeSessionRecord[]
  hasSelectableRecords: boolean
  allSelectableChecked: boolean
  hasSelectedRecords: boolean
  refreshRecords: () => Promise<void>
  applyThreshold: () => Promise<void>
  openCreateDialog: () => void
  openEditDialog: (record: TimeSessionRecord) => void
  handleDeleteRecord: (record: TimeSessionRecord) => Promise<void>
  handleRestoreRecord: (record: TimeSessionRecord) => Promise<void>
  toggleRecordSelection: (recordId: string, checked: boolean) => void
  toggleSelectAllVisible: (checked: boolean) => void
  handleBulkDelete: () => Promise<void>
  onDialogOpenChange: (open: boolean) => void
  onFormChange: (patch: Partial<TimeRecordFormState>) => void
  handleSubmitRecord: (event: FormEvent<HTMLFormElement>) => Promise<void>
}

interface UseTimeRecordsDashboardOptions {
  onRecordsChanged?: () => void | Promise<void>
}

export function useTimeRecordsDashboard(
  options: UseTimeRecordsDashboardOptions = {},
): UseTimeRecordsDashboardResult {
  const [records, setRecords] = useState<TimeSessionRecord[]>([])
  const [thresholdSeconds, setThresholdSeconds] = useState(0)
  const [thresholdInput, setThresholdInput] = useState('0')
  const [showBelowThreshold, setShowBelowThreshold] = useState(false)
  const [showDeleted, setShowDeleted] = useState(false)
  const [kindFilter, setKindFilter] = useState<'all' | SessionKind>('all')
  const [keyword, setKeyword] = useState('')
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([])
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<TimeSessionRecord | null>(
    null,
  )
  const [formState, setFormState] = useState<TimeRecordFormState>(() =>
    buildTimeRecordFormState(),
  )
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmittingRecord, setIsSubmittingRecord] = useState(false)
  const [deletingRecordId, setDeletingRecordId] = useState<string | null>(null)
  const [restoringRecordId, setRestoringRecordId] = useState<string | null>(
    null,
  )
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)

  const refreshRecords = async () => {
    const nextRecords = await listTimeRecords({
      includeDeleted: true,
      includeBelowThreshold: showBelowThreshold,
    })
    setRecords(nextRecords)
  }

  useEffect(() => {
    const load = async () => {
      const [threshold, nextRecords] = await Promise.all([
        getTimeRecordingThresholdSeconds(),
        listTimeRecords({
          includeDeleted: true,
          includeBelowThreshold: showBelowThreshold,
        }),
      ])
      setThresholdSeconds(threshold)
      setThresholdInput(String(threshold))
      setRecords(nextRecords)
    }

    void load()
  }, [showBelowThreshold])

  const applyThreshold = async () => {
    const parsed = Number(thresholdInput)
    const safeThreshold = await setTimeRecordingThresholdSeconds(
      Number.isNaN(parsed) || parsed < 0 ? 0 : parsed,
    )
    setThresholdSeconds(safeThreshold)
    setThresholdInput(String(safeThreshold))
    toast.success(`记录阈值已更新为 ${safeThreshold} 秒`)
    await refreshRecords()
  }

  const summary = useMemo(() => getTimeRecordSummary(records), [records])
  const trend = useMemo(() => getDailyTrend(records, 7), [records])
  const breakdown = useMemo(() => getSessionKindBreakdown(records), [records])
  const trend30 = useMemo(() => getTrendByRange(records, 30), [records])
  const trend90 = useMemo(() => getTrendByRange(records, 90), [records])
  const trendAll = useMemo(() => getTrendByRange(records, 'all'), [records])
  const breakdown7 = useMemo(() => getSessionKindBreakdown(records, 7), [records])
  const breakdown30 = useMemo(() => getSessionKindBreakdown(records, 30), [records])
  const breakdown90 = useMemo(() => getSessionKindBreakdown(records, 90), [records])
  const breakdownAll = useMemo(
    () => getSessionKindBreakdown(records, 'all'),
    [records],
  )

  const visibleRecords = useMemo(() => {
    return records.filter((record) => {
      if (!showDeleted && record.deletedAt) return false
      if (kindFilter !== 'all' && record.kind !== kindFilter) return false
      if (
        keyword.trim() &&
        !record.title.toLowerCase().includes(keyword.trim().toLowerCase())
      ) {
        return false
      }
      return true
    })
  }, [kindFilter, keyword, records, showDeleted])

  const selectableRecords = useMemo(
    () => visibleRecords.filter((record) => !record.deletedAt),
    [visibleRecords],
  )
  const selectableRecordIds = useMemo(
    () => selectableRecords.map((record) => record.id),
    [selectableRecords],
  )
  const hasSelectableRecords = selectableRecordIds.length > 0
  const selectedVisibleCount = selectableRecordIds.filter((id) =>
    selectedRecordIds.includes(id),
  ).length
  const allSelectableChecked =
    hasSelectableRecords &&
    selectedVisibleCount === selectableRecordIds.length

  const openCreateDialog = () => {
    setDialogMode('create')
    setEditingRecord(null)
    setFormState(buildTimeRecordFormState())
    setFormError(null)
    setDialogOpen(true)
  }

  const openEditDialog = (record: TimeSessionRecord) => {
    setDialogMode('edit')
    setEditingRecord(record)
    setFormState(buildTimeRecordFormState(record))
    setFormError(null)
    setDialogOpen(true)
  }

  const handleSubmitRecord = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSubmittingRecord) return

    setFormError(null)
    const parsed = parseTimeRecordFormState(formState, editingRecord)
    if ('error' in parsed) {
      setFormError(parsed.error)
      return
    }
    if (
      !isTimeRecordAboveThreshold(
        parsed.value.effectiveSeconds,
        thresholdSeconds,
      )
    ) {
      setFormError(
        `有效时长必须大于 ${thresholdSeconds} 秒，才会进入时间记录。`,
      )
      return
    }

    setIsSubmittingRecord(true)
    try {
      if (dialogMode === 'create') {
        const created = await createTimeRecord({
          ...parsed.value,
          deletedAt: null,
          deletedReason: null,
          events: [],
        })
        if (!created) {
          setFormError(
            `有效时长必须大于 ${thresholdSeconds} 秒，才会进入时间记录。`,
          )
          return
        }
        setRecords((current) => [created, ...current])
        toast.success('时间记录已新增')
      } else if (editingRecord) {
        const updated = await updateTimeRecord(editingRecord.id, parsed.value)
        if (updated) {
          setRecords((current) =>
            current.map((record) =>
              record.id === updated.id ? updated : record,
            ),
          )
        }
        toast.success('时间记录已更新')
      }

      setDialogOpen(false)
      await refreshRecords()
      await options.onRecordsChanged?.()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '保存失败，请重试。')
      return
    } finally {
      setIsSubmittingRecord(false)
    }
  }

  const handleDeleteRecord = async (record: TimeSessionRecord) => {
    if (deletingRecordId || isBulkDeleting) return

    const confirmed = window.confirm(
      `确定删除“${record.title}”吗？你之后仍可以在“显示已删除”中恢复。`,
    )
    if (!confirmed) return

    setDeletingRecordId(record.id)
    try {
      await softDeleteTimeRecord(record.id)
      setSelectedRecordIds((current) =>
        current.filter((id) => id !== record.id),
      )
      toast.success('时间记录已移入已删除')
      await refreshRecords()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败，请重试')
    } finally {
      setDeletingRecordId(null)
    }
  }

  const handleRestoreRecord = async (record: TimeSessionRecord) => {
    if (restoringRecordId || isBulkDeleting) return

    setRestoringRecordId(record.id)
    try {
      await restoreTimeRecord(record.id)
      toast.success('时间记录已恢复')
      await refreshRecords()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '恢复失败，请重试')
    } finally {
      setRestoringRecordId(null)
    }
  }

  const toggleRecordSelection = (recordId: string, checked: boolean) => {
    setSelectedRecordIds((current) => {
      if (checked) {
        return current.includes(recordId) ? current : [...current, recordId]
      }
      return current.filter((id) => id !== recordId)
    })
  }

  const toggleSelectAllVisible = (checked: boolean) => {
    setSelectedRecordIds((current) => {
      if (!checked) {
        return current.filter((id) => !selectableRecordIds.includes(id))
      }
      return Array.from(new Set([...current, ...selectableRecordIds]))
    })
  }

  const handleBulkDelete = async () => {
    if (isBulkDeleting || deletingRecordId) return

    const targets = records.filter(
      (record) =>
        selectedRecordIds.includes(record.id) && !record.deletedAt,
    )
    if (targets.length === 0) return

    const confirmed = window.confirm(
      `确定批量删除所选的 ${targets.length} 条记录吗？你之后仍可以在“显示已删除”中恢复。`,
    )
    if (!confirmed) return

    setIsBulkDeleting(true)
    try {
      await Promise.all(
        targets.map((record) => softDeleteTimeRecord(record.id)),
      )
      setSelectedRecordIds([])
      toast.success(`已移入已删除：${targets.length} 条记录`)
      await refreshRecords()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '批量删除失败，请重试')
    } finally {
      setIsBulkDeleting(false)
    }
  }

  useEffect(() => {
    setSelectedRecordIds((current) =>
      current.filter((id) =>
        records.some((record) => record.id === id && !record.deletedAt),
      ),
    )
  }, [records])

  useEffect(() => {
    setSelectedRecordIds((current) =>
      current.filter((id) =>
        visibleRecords.some(
          (record) => record.id === id && !record.deletedAt,
        ),
      ),
    )
  }, [visibleRecords])

  return {
    thresholdSeconds,
    thresholdInput,
    setThresholdInput,
    showBelowThreshold,
    setShowBelowThreshold,
    showDeleted,
    setShowDeleted,
    kindFilter,
    setKindFilter,
    keyword,
    setKeyword,
    selectedRecordIds,
    dialogMode,
    dialogOpen,
    formState,
    formError,
    isSubmittingRecord,
    deletingRecordId,
    restoringRecordId,
    isBulkDeleting,
    summary,
    trend,
    breakdown,
    getTrendForRange: (range) => {
      if (range === 30) return trend30
      if (range === 90) return trend90
      if (range === 'all') return trendAll
      return trend
    },
    getBreakdownForRange: (range) => {
      if (range === 30) return breakdown30
      if (range === 90) return breakdown90
      if (range === 'all') return breakdownAll
      return breakdown7
    },
    visibleRecords,
    hasSelectableRecords,
    allSelectableChecked,
    hasSelectedRecords: selectedRecordIds.length > 0,
    refreshRecords,
    applyThreshold,
    openCreateDialog,
    openEditDialog,
    handleDeleteRecord,
    handleRestoreRecord,
    toggleRecordSelection,
    toggleSelectAllVisible,
    handleBulkDelete,
    onDialogOpenChange: (open) => {
      setDialogOpen(open)
      if (!open) setFormError(null)
    },
    onFormChange: (patch) =>
      setFormState((current) => applyTimeRecordFormPatch(current, patch)),
    handleSubmitRecord,
  }
}
