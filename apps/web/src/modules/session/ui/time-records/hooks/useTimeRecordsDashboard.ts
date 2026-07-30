import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { toast } from '@/shared/feedback/toast'
import { appConfirm } from '@/shared/components/ui/native-dialog'
import { detectClientSource } from '@/shared/lib/clientSource'
import {
  bulkDeleteStudySessionRecords,
  createStudySessionRecord,
  deleteStudySessionRecord,
  readUnifiedTimeRecords,
  updateStudySessionRecord,
  type DailyTrendPoint,
  type SessionKindBreakdownItem,
  type TimeRecordSourceSummary,
  type TimeSessionRecord,
} from '@/modules/session/domain/session-entity/model'
import type {
  TimeRecordKind,
  TimeRecordRangeMode,
} from '@/modules/session/domain/study-session-entity/api'
import {
  applyTimeRecordFormPatch,
  applyTimeRecordQuickAddPatch,
  buildTimeRecordFormState,
  buildTimeRecordQuickAddFormState,
  parseTimeRecordFormState,
  parseTimeRecordQuickAddFormState,
  type TimeRecordFormState,
  type TimeRecordQuickAddFormState,
} from '@/modules/session/ui/time-records/model/time-record-form'
import {
  normalizeCustomTimeRecordTags,
  resolveTagName,
  type CustomTimeRecordTag,
} from '@/modules/session/ui/time-records/model/time-record-tags'
import {
  createDefaultTimeRecordFilter,
  isTimeRecordCustomRangeValid,
  isTimeRecordFilterPersistenceState,
  normalizeTimeRecordFilter,
  TIME_RECORD_FILTER_STORAGE_KEY,
  type TimeRecordFilterPersistenceState,
  type TimeRecordFilterState,
} from '@/modules/session/ui/time-records/model/time-record-filter'
import {
  CLIENT_PREFERENCES_UPDATED_EVENT,
  getCachedClientPreference,
  saveClientPreference,
} from '@/shared/preferences/clientPreferences'
import { onAppEvent } from '@/shared/events/appEvents'
import { useLocalStorageState } from '@/shared/lib/localStorage'

const EMPTY_SOURCE_SUMMARY: TimeRecordSourceSummary = {
  totalEffectiveSeconds: 0,
  desktopEffectiveSeconds: 0,
  pwaEffectiveSeconds: 0,
  unknownEffectiveSeconds: 0,
}

export interface UseTimeRecordsDashboardResult {
  filter: TimeRecordFilterState
  setRangeMode: (value: TimeRecordRangeMode) => void
  setMonth: (value: string) => void
  setRollingDays: (value: 7 | 30 | 90) => void
  setStartDate: (value: string) => void
  setEndDate: (value: string) => void
  kindFilter: 'all' | TimeRecordKind
  setKindFilter: (value: 'all' | TimeRecordKind) => void
  keyword: string
  setKeyword: (value: string) => void
  sortBy: TimeRecordFilterState['sortBy']
  setSortBy: (value: TimeRecordFilterState['sortBy']) => void
  sortOrder: TimeRecordFilterState['sortOrder']
  setSortOrder: (value: TimeRecordFilterState['sortOrder']) => void
  sourceSummary: TimeRecordSourceSummary
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
  customTags: CustomTimeRecordTag[]
  quickAddOpen: boolean
  quickAddForm: TimeRecordQuickAddFormState
  quickAddError: string | null
  isSubmittingQuickAdd: boolean
  refreshRecords: () => Promise<void>
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
  onQuickAddOpenChange: (open: boolean) => void
  onQuickAddFormChange: (patch: Partial<TimeRecordQuickAddFormState>) => void
  onCustomTagsChange: (tags: CustomTimeRecordTag[]) => void
  handleSubmitQuickAdd: (event: FormEvent<HTMLFormElement>) => Promise<void>
}

interface UseTimeRecordsDashboardOptions {
  onRecordsChanged?: () => void | Promise<void>
}

export function useTimeRecordsDashboard(
  options: UseTimeRecordsDashboardOptions = {},
): UseTimeRecordsDashboardResult {
  const defaultFilter = useMemo(() => createDefaultTimeRecordFilter(), [])
  const [persistedFilter, setPersistedFilter] =
    useLocalStorageState<TimeRecordFilterPersistenceState>(
      TIME_RECORD_FILTER_STORAGE_KEY,
      defaultFilter,
      isTimeRecordFilterPersistenceState,
      'dashboard_duration_filter',
    )
  const filter = useMemo(
    () => normalizeTimeRecordFilter(persistedFilter),
    [persistedFilter],
  )
  const [records, setRecords] = useState<TimeSessionRecord[]>([])
  const [debouncedKeyword, setDebouncedKeyword] = useState(filter.keyword.trim())
  const [sourceSummary, setSourceSummary] =
    useState<TimeRecordSourceSummary>(EMPTY_SOURCE_SUMMARY)
  const [page, setPage] = useState(1)
  const [totalRecords, setTotalRecords] = useState(0)
  const [isLoadingRecords, setIsLoadingRecords] = useState(false)
  const [recordsError, setRecordsError] = useState<string | null>(null)
  const [trend, setTrend] = useState<DailyTrendPoint[]>([])
  const [breakdown, setBreakdown] = useState<SessionKindBreakdownItem[]>([])
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([])
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<TimeSessionRecord | null>(null)
  const [formState, setFormState] = useState<TimeRecordFormState>(() =>
    buildTimeRecordFormState(),
  )
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmittingRecord, setIsSubmittingRecord] = useState(false)
  const [customTags, setCustomTags] = useState<CustomTimeRecordTag[]>(() =>
    normalizeCustomTimeRecordTags(
      getCachedClientPreference('time_record_tags', [], Array.isArray),
    ),
  )
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  const [quickAddForm, setQuickAddForm] = useState<TimeRecordQuickAddFormState>(
    () => buildTimeRecordQuickAddFormState(),
  )
  const [quickAddError, setQuickAddError] = useState<string | null>(null)
  const [isSubmittingQuickAdd, setIsSubmittingQuickAdd] = useState(false)
  const [deletingRecordId, setDeletingRecordId] = useState<string | null>(null)
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)
  const requestIdRef = useRef(0)
  const totalPages = Math.max(1, Math.ceil(totalRecords / filter.pageSize))

  useEffect(() => {
    if (JSON.stringify(persistedFilter) !== JSON.stringify(filter)) {
      setPersistedFilter(filter)
    }
  }, [filter, persistedFilter, setPersistedFilter])

  const updateFilter = useCallback(
    (patch: Partial<TimeRecordFilterState>) => {
      setPersistedFilter((current) => ({
        ...normalizeTimeRecordFilter(current),
        ...patch,
        version: 2,
      }))
      setPage(1)
    },
    [setPersistedFilter],
  )

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedKeyword(filter.keyword.trim())
    }, 300)
    return () => window.clearTimeout(timer)
  }, [filter.keyword])

  const loadRecords = useCallback(
    async (targetPage: number) => {
      if (!isTimeRecordCustomRangeValid(filter)) {
        requestIdRef.current += 1
        setRecords([])
        setTotalRecords(0)
        setSourceSummary(EMPTY_SOURCE_SUMMARY)
        setTrend([])
        setBreakdown([])
        setRecordsError(null)
        setIsLoadingRecords(false)
        return
      }

      const requestId = ++requestIdRef.current
      setIsLoadingRecords(true)
      setRecordsError(null)
      try {
        const result = await readUnifiedTimeRecords({
          rangeMode: filter.rangeMode,
          month: filter.rangeMode === 'month' ? filter.month : undefined,
          rollingDays:
            filter.rangeMode === 'rolling' ? filter.rollingDays : undefined,
          startDate:
            filter.rangeMode === 'custom' ? filter.startDate : undefined,
          endDate: filter.rangeMode === 'custom' ? filter.endDate : undefined,
          keyword: debouncedKeyword,
          kind: filter.kind === 'all' ? undefined : filter.kind,
          sortBy: filter.sortBy,
          sortOrder: filter.sortOrder,
          limit: filter.pageSize,
          offset: (targetPage - 1) * filter.pageSize,
        })
        if (requestId !== requestIdRef.current) return
        const nextTotalPages = Math.max(
          1,
          Math.ceil(result.total / filter.pageSize),
        )
        if (targetPage > nextTotalPages) {
          setPage(nextTotalPages)
          return
        }
        setRecords(result.items)
        setTotalRecords(result.total)
        setSourceSummary(result.sourceSummary)
        setTrend(result.trend)
        setBreakdown(result.breakdown)
      } catch (error) {
        if (requestId !== requestIdRef.current) return
        setRecordsError(
          error instanceof Error ? error.message : '加载时间记录失败。',
        )
      } finally {
        if (requestId === requestIdRef.current) {
          setIsLoadingRecords(false)
        }
      }
    },
    [debouncedKeyword, filter],
  )

  const refreshRecords = useCallback(async () => {
    await loadRecords(page)
  }, [loadRecords, page])

  useEffect(() => {
    void loadRecords(page)
  }, [loadRecords, page])

  useEffect(() => {
    const syncTags = () => {
      setCustomTags(
        normalizeCustomTimeRecordTags(
          getCachedClientPreference('time_record_tags', [], Array.isArray),
        ),
      )
    }
    syncTags()
    return onAppEvent(CLIENT_PREFERENCES_UPDATED_EVENT, syncTags)
  }, [])

  const persistCustomTags = useCallback(async (tags: CustomTimeRecordTag[]) => {
    setCustomTags(tags)
    await saveClientPreference('time_record_tags', tags)
  }, [])

  const selectableRecordIds = useMemo(
    () => records.filter((record) => !record.deletedAt).map((record) => record.id),
    [records],
  )
  const hasSelectableRecords = selectableRecordIds.length > 0
  const allSelectableChecked =
    hasSelectableRecords &&
    selectableRecordIds.every((id) => selectedRecordIds.includes(id))

  const openCreateDialog = () => {
    setQuickAddError(null)
    setQuickAddForm(
      applyTimeRecordQuickAddPatch(
        buildTimeRecordQuickAddFormState(),
        {},
        customTags,
      ),
    )
    setQuickAddOpen(true)
  }

  const openEditDialog = (record: TimeSessionRecord) => {
    setDialogMode('edit')
    setEditingRecord(record)
    setFormState(buildTimeRecordFormState(record))
    setFormError(null)
    setDialogOpen(true)
  }

  const handleSubmitQuickAdd = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSubmittingQuickAdd) return
    setQuickAddError(null)
    const parsed = parseTimeRecordQuickAddFormState(quickAddForm, customTags)
    if ('error' in parsed) {
      setQuickAddError(parsed.error)
      return
    }

    setIsSubmittingQuickAdd(true)
    try {
      const created = await createStudySessionRecord({
        ...parsed.value,
        clientSource: detectClientSource(),
        deletedAt: null,
        deletedReason: null,
        events: [],
      })
      if (!created) {
        setQuickAddError('保存学习记录失败，请重试。')
        return
      }
      const minutes = Math.round(parsed.value.effectiveSeconds / 60)
      const tagLabel =
        parsed.value.activityTagLabel ||
        resolveTagName(parsed.value.activityTag || 'review', customTags)
      toast.success(`已记录「${tagLabel}」${minutes} 分钟`)
      setQuickAddOpen(false)
      setPage(1)
      await loadRecords(1)
      await Promise.resolve(options.onRecordsChanged?.())
    } catch (error) {
      setQuickAddError(
        error instanceof Error
          ? error.message
          : '保存学习记录失败，请检查标签和时长后重试。',
      )
    } finally {
      setIsSubmittingQuickAdd(false)
    }
  }

  const handleSubmitRecord = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSubmittingRecord) return
    setFormError(null)
    const parsed = parseTimeRecordFormState(formState, editingRecord, customTags)
    if ('error' in parsed) {
      setFormError(parsed.error)
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
          setFormError('保存学习记录失败，请重试。')
          return
        }
        toast.success(`已新增学习记录“${created.title}”。`)
      } else if (editingRecord) {
        await updateStudySessionRecord(editingRecord.id, {
          ...parsed.value,
          clientSource: editingRecord.clientSource ?? null,
          sceneSegments: editingRecord.sceneSegments,
        })
        toast.success(`学习记录“${parsed.value.title}”已更新。`)
      }

      setDialogOpen(false)
      const targetPage = dialogMode === 'create' ? 1 : page
      setPage(targetPage)
      await loadRecords(targetPage)
      await Promise.resolve(options.onRecordsChanged?.())
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : '保存学习记录失败，请检查时间和标题后重试。',
      )
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
      setSelectedRecordIds((current) => current.filter((id) => id !== record.id))
      toast.success(`学习记录“${record.title}”已删除。`)
      const targetPage = records.length === 1 && page > 1 ? page - 1 : page
      setPage(targetPage)
      await loadRecords(targetPage)
      await Promise.resolve(options.onRecordsChanged?.())
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : '删除学习记录失败，请刷新列表后重试。',
      )
    } finally {
      setDeletingRecordId(null)
    }
  }

  const toggleRecordSelection = (recordId: string, checked: boolean) => {
    setSelectedRecordIds((current) =>
      checked
        ? current.includes(recordId)
          ? current
          : [...current, recordId]
        : current.filter((id) => id !== recordId),
    )
  }

  const toggleSelectAllVisible = (checked: boolean) => {
    setSelectedRecordIds((current) =>
      checked
        ? Array.from(new Set([...current, ...selectableRecordIds]))
        : current.filter((id) => !selectableRecordIds.includes(id)),
    )
  }

  const handleBulkDelete = async () => {
    if (isBulkDeleting || deletingRecordId) return
    const targets = records.filter((record) =>
      selectedRecordIds.includes(record.id),
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
      setSelectedRecordIds([])
      toast.success(`已删除 ${targets.length} 条学习记录。`)
      const targetPage = targets.length === records.length && page > 1 ? page - 1 : page
      setPage(targetPage)
      await loadRecords(targetPage)
      await Promise.resolve(options.onRecordsChanged?.())
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : '批量删除学习记录失败，请重新选择后重试。',
      )
    } finally {
      setIsBulkDeleting(false)
    }
  }

  useEffect(() => {
    setSelectedRecordIds((current) =>
      current.filter((id) => selectableRecordIds.includes(id)),
    )
  }, [selectableRecordIds])

  useEffect(() => {
    setSelectedRecordIds([])
  }, [filter, page])

  return {
    filter,
    setRangeMode: (value) => updateFilter({ rangeMode: value }),
    setMonth: (value) => updateFilter({ month: value }),
    setRollingDays: (value) => updateFilter({ rollingDays: value }),
    setStartDate: (value) => updateFilter({ startDate: value }),
    setEndDate: (value) => updateFilter({ endDate: value }),
    kindFilter: filter.kind,
    setKindFilter: (value) => updateFilter({ kind: value }),
    keyword: filter.keyword,
    setKeyword: (value) => updateFilter({ keyword: value }),
    sortBy: filter.sortBy,
    setSortBy: (value) => updateFilter({ sortBy: value }),
    sortOrder: filter.sortOrder,
    setSortOrder: (value) => updateFilter({ sortOrder: value }),
    sourceSummary,
    page,
    pageSize: filter.pageSize,
    totalRecords,
    totalPages,
    setPage: (value) => setPage(Math.max(1, value)),
    setPageSize: (value) => updateFilter({ pageSize: value }),
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
    visibleRecords: records,
    pendingRecoveryRecords: [],
    hasSelectableRecords,
    allSelectableChecked,
    hasSelectedRecords: selectedRecordIds.length > 0,
    customTags,
    quickAddOpen,
    quickAddForm,
    quickAddError,
    isSubmittingQuickAdd,
    refreshRecords,
    openCreateDialog,
    openEditDialog,
    handleDeleteRecord,
    handleReplayPendingRecovery: async () => undefined,
    handleDismissPendingRecovery: () => undefined,
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
    onQuickAddOpenChange: (open) => {
      setQuickAddOpen(open)
      if (!open) setQuickAddError(null)
    },
    onQuickAddFormChange: (patch) =>
      setQuickAddForm((current) =>
        applyTimeRecordQuickAddPatch(current, patch, customTags),
      ),
    onCustomTagsChange: (tags) => {
      void persistCustomTags(tags)
    },
    handleSubmitQuickAdd,
  }
}
