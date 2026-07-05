import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { toast } from '@/shared/feedback/toast'
import { appConfirm } from '@/shared/components/ui/native-dialog'
import {
  createStudySessionRecord,
  getDailyTrend,
  getSessionKindBreakdown,
  getTimeRecordSummary,
  getTrendByRange,
  listStudySessionRecords,
  bulkDeleteStudySessionRecords,
  deleteStudySessionRecord,
  type SessionKind,
  type TimeRecordChartRange,
  type TimeSessionRecord,
  updateStudySessionRecord,
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
  pendingRecoveryRecords: []
  hasSelectableRecords: boolean
  allSelectableChecked: boolean
  hasSelectedRecords: boolean
  refreshRecords: () => Promise<void>
  applyThreshold: () => Promise<void>
  openCreateDialog: () => void
  openEditDialog: (record: TimeSessionRecord) => void
  handleDeleteRecord: (record: TimeSessionRecord) => Promise<void>
  handleReplayPendingRecovery: (recordId: string) => Promise<void>
  handleDismissPendingRecovery: (recordId: string) => void
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
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)

  const refreshRecords = async () => {
    const nextRecords = await listStudySessionRecords()
    setRecords(nextRecords)
  }

  useEffect(() => {
    const load = async () => {
      const nextRecords = await listStudySessionRecords()
      setThresholdSeconds(0)
      setThresholdInput('0')
      setRecords(nextRecords)
    }

    void load()
  }, [])

  const applyThreshold = async () => {
    setThresholdSeconds(0)
    setThresholdInput('0')
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
      if (kindFilter !== 'all' && record.kind !== kindFilter) return false
      if (
        keyword.trim() &&
        !record.title.toLowerCase().includes(keyword.trim().toLowerCase())
      ) {
        return false
      }
      return true
    })
  }, [kindFilter, keyword, records])

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
        const created = await createStudySessionRecord({
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
        const updated = await updateStudySessionRecord(editingRecord.id, parsed.value)
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

    const confirmed = await appConfirm(
      `确定永久删除“${record.title}”吗？此操作不可恢复。`,
      { title: '删除时间记录', tone: 'danger' },
    )
    if (!confirmed) return

    setDeletingRecordId(record.id)
    try {
      await deleteStudySessionRecord(record.id)
      setRecords((current) => current.filter((item) => item.id !== record.id))
      setSelectedRecordIds((current) =>
        current.filter((id) => id !== record.id),
      )
      toast.success('时间记录已删除')
      await refreshRecords()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败，请重试')
    } finally {
      setDeletingRecordId(null)
    }
  }

  const handleReplayPendingRecovery = async (recordId: string) => {
    void recordId
  }

  const handleDismissPendingRecovery = (recordId: string) => {
    void recordId
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

    const confirmed = await appConfirm(
      `确定永久删除所选的 ${targets.length} 条记录吗？此操作不可恢复。`,
      { title: '批量删除时间记录', tone: 'danger' },
    )
    if (!confirmed) return

    setIsBulkDeleting(true)
    try {
      await bulkDeleteStudySessionRecords(targets.map((record) => record.id))
      setRecords((current) => current.filter((record) => !selectedRecordIds.includes(record.id)))
      setSelectedRecordIds([])
      toast.success(`已删除：${targets.length} 条记录`)
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
    pendingRecoveryRecords: [],
    hasSelectableRecords,
    allSelectableChecked,
    hasSelectedRecords: selectedRecordIds.length > 0,
    refreshRecords,
    applyThreshold,
    openCreateDialog,
    openEditDialog,
    handleDeleteRecord,
    handleReplayPendingRecovery,
    handleDismissPendingRecovery,
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
