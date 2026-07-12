import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useCallback, useRef } from 'react'
import { toast } from '@/shared/feedback/toast'
import { appConfirm } from '@/shared/components/ui/native-dialog'
import { detectClientSource } from '@/shared/lib/clientSource'
import {
  createStudySessionRecord,
  getStudySessionRecordAnalytics,
  listStudySessionRecords,
  bulkDeleteStudySessionRecords,
  deleteStudySessionRecord,
  type SessionKind,
  type SessionKindBreakdownItem,
  type DailyTrendPoint,
  type TimeRecordChartRange,
  type TimeRecordSortBy,
  type TimeRecordSortOrder,
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
  sortBy: TimeRecordSortBy
  setSortBy: (value: TimeRecordSortBy) => void
  sortOrder: TimeRecordSortOrder
  setSortOrder: (value: TimeRecordSortOrder) => void
  page: number
  pageSize: number
  totalRecords: number
  totalPages: number
  setPage: (value: number) => void
  setPageSize: (value: number) => void
  isLoadingRecords: boolean
  recordsError: string | null
  selectedRecordIds: string[]
  dialogMode: 'create' | 'edit'
  dialogOpen: boolean
  formState: TimeRecordFormState
  formError: string | null
  isSubmittingRecord: boolean
  deletingRecordId: string | null
  isBulkDeleting: boolean
  trend: DailyTrendPoint[]
  breakdown: SessionKindBreakdownItem[]
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
  trendRange?: TimeRecordChartRange
  breakdownRange?: TimeRecordChartRange
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
  const [debouncedKeyword, setDebouncedKeyword] = useState('')
  const [sortBy, setSortBy] = useState<TimeRecordSortBy>('started_at')
  const [sortOrder, setSortOrder] = useState<TimeRecordSortOrder>('desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [totalRecords, setTotalRecords] = useState(0)
  const [isLoadingRecords, setIsLoadingRecords] = useState(false)
  const [recordsError, setRecordsError] = useState<string | null>(null)
  const [trend, setTrend] = useState<DailyTrendPoint[]>([])
  const [breakdown, setBreakdown] = useState<SessionKindBreakdownItem[]>([])
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
  const recordsRequestIdRef = useRef(0)
  const analyticsRequestIdRef = useRef(0)
  const trendRange = options.trendRange ?? 7
  const breakdownRange = options.breakdownRange ?? 'all'
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize))

  const loadRecords = useCallback(async (targetPage: number) => {
    const requestId = ++recordsRequestIdRef.current
    setIsLoadingRecords(true)
    setRecordsError(null)
    try {
      const result = await listStudySessionRecords({
        limit: pageSize,
        offset: (targetPage - 1) * pageSize,
        keyword: debouncedKeyword,
        kind: kindFilter === 'all' ? undefined : kindFilter,
        sortBy,
        sortOrder,
      })
      if (requestId !== recordsRequestIdRef.current) return
      const nextTotalPages = Math.max(1, Math.ceil(result.total / pageSize))
      if (targetPage > nextTotalPages) {
        setPage(nextTotalPages)
        return
      }
      setRecords(result.items)
      setTotalRecords(result.total)
    } catch (error) {
      if (requestId !== recordsRequestIdRef.current) return
      setRecordsError(error instanceof Error ? error.message : '加载时间记录失败。')
    } finally {
      if (requestId === recordsRequestIdRef.current) {
        setIsLoadingRecords(false)
      }
    }
  }, [debouncedKeyword, kindFilter, pageSize, sortBy, sortOrder])

  const refreshRecords = useCallback(async () => {
    await loadRecords(page)
  }, [loadRecords, page])

  const refreshAnalytics = useCallback(async () => {
    const requestId = ++analyticsRequestIdRef.current
    const result = await getStudySessionRecordAnalytics({
      trendRange,
      breakdownRange,
    })
    if (requestId !== analyticsRequestIdRef.current) return
    setTrend(result.trend)
    setBreakdown(result.breakdown)
  }, [breakdownRange, trendRange])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedKeyword(keyword.trim())
    }, 300)
    return () => window.clearTimeout(timer)
  }, [keyword])

  useEffect(() => {
    void loadRecords(page)
  }, [loadRecords, page])

  useEffect(() => {
    void refreshAnalytics().catch(() => undefined)
  }, [refreshAnalytics])

  const applyThreshold = async () => {
    setThresholdSeconds(0)
    setThresholdInput('0')
  }

  const visibleRecords = records

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
          clientSource: detectClientSource(),
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
        toast.success(`已新增学习记录“${created.title}”。`)
      } else if (editingRecord) {
        const updated = await updateStudySessionRecord(editingRecord.id, {
          ...parsed.value,
          clientSource: editingRecord.clientSource ?? null,
          sceneSegments: editingRecord.sceneSegments,
        })
        if (updated) {
          setRecords((current) =>
            current.map((record) =>
              record.id === updated.id ? updated : record,
            ),
          )
        }
        toast.success(`学习记录“${parsed.value.title}”已更新。`)
      }

      setDialogOpen(false)
      const targetPage = dialogMode === 'create' ? 1 : page
      if (targetPage !== page) setPage(targetPage)
      await loadRecords(targetPage)
      await Promise.all([
        refreshAnalytics(),
        Promise.resolve(options.onRecordsChanged?.()),
      ])
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '保存学习记录失败，请检查时间和标题后重试。')
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
      toast.success(`学习记录“${record.title}”已删除。`)
      const targetPage = records.length === 1 && page > 1 ? page - 1 : page
      if (targetPage !== page) setPage(targetPage)
      await loadRecords(targetPage)
      await Promise.all([
        refreshAnalytics(),
        Promise.resolve(options.onRecordsChanged?.()),
      ])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除学习记录失败，请刷新列表后重试。')
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
      toast.success(`已删除 ${targets.length} 条学习记录。`)
      const targetPage = targets.length === records.length && page > 1 ? page - 1 : page
      if (targetPage !== page) setPage(targetPage)
      await loadRecords(targetPage)
      await Promise.all([
        refreshAnalytics(),
        Promise.resolve(options.onRecordsChanged?.()),
      ])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '批量删除学习记录失败，请重新选择后重试。')
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

  useEffect(() => {
    setSelectedRecordIds([])
  }, [debouncedKeyword, kindFilter, page, pageSize, sortBy, sortOrder])

  return {
    thresholdSeconds,
    thresholdInput,
    setThresholdInput,
    showBelowThreshold,
    setShowBelowThreshold,
    showDeleted,
    setShowDeleted,
    kindFilter,
    setKindFilter: (value) => {
      setKindFilter(value)
      setPage(1)
    },
    keyword,
    setKeyword: (value) => {
      setKeyword(value)
      setPage(1)
    },
    sortBy,
    setSortBy: (value) => {
      setSortBy(value)
      setPage(1)
    },
    sortOrder,
    setSortOrder: (value) => {
      setSortOrder(value)
      setPage(1)
    },
    page,
    pageSize,
    totalRecords,
    totalPages,
    setPage: (value) => setPage(Math.max(1, value)),
    setPageSize: (value) => {
      setPageSize(value)
      setPage(1)
    },
    isLoadingRecords,
    recordsError,
    selectedRecordIds,
    dialogMode,
    dialogOpen,
    formState,
    formError,
    isSubmittingRecord,
    deletingRecordId,
    isBulkDeleting,
    trend,
    breakdown,
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
