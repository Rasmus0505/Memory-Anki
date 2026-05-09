import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import {
  createTimeRecord,
  getDailyTrend,
  getSessionKindBreakdown,
  getTimeRecordSummary,
  getTimeRecordingThresholdSeconds,
  listTimeRecords,
  restoreTimeRecord,
  setTimeRecordingThresholdSeconds,
  softDeleteTimeRecord,
  type SessionKind,
  type TimeSessionRecord,
  updateTimeRecord,
} from '@/entities/session/model'
import {
  buildTimeRecordFormState,
  isTimeRecordAboveThreshold,
  parseTimeRecordFormState,
  type TimeRecordFormState,
} from '@/features/profile/model/time-record-form'

export interface UseTimeRecordsDashboardResult {
  thresholdSeconds: number
  thresholdInput: string
  setThresholdInput: (value: string) => void
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
  summary: ReturnType<typeof getTimeRecordSummary>
  trend: ReturnType<typeof getDailyTrend>
  breakdown: ReturnType<typeof getSessionKindBreakdown>
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

export function useTimeRecordsDashboard(): UseTimeRecordsDashboardResult {
  const [records, setRecords] = useState<TimeSessionRecord[]>([])
  const [thresholdSeconds, setThresholdSeconds] = useState(0)
  const [thresholdInput, setThresholdInput] = useState('0')
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

  const refreshRecords = async () => {
    const nextRecords = await listTimeRecords({
      includeDeleted: true,
      includeBelowThreshold: true,
    })
    setRecords(nextRecords)
  }

  useEffect(() => {
    const load = async () => {
      const [threshold, nextRecords] = await Promise.all([
        getTimeRecordingThresholdSeconds(),
        listTimeRecords({
          includeDeleted: true,
          includeBelowThreshold: true,
        }),
      ])
      setThresholdSeconds(threshold)
      setThresholdInput(String(threshold))
      setRecords(nextRecords)
    }

    void load()
  }, [])

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
      toast.success('时间记录已新增')
    } else if (editingRecord) {
      await updateTimeRecord(editingRecord.id, parsed.value)
      toast.success('时间记录已更新')
    }

    setDialogOpen(false)
    await refreshRecords()
  }

  const handleDeleteRecord = async (record: TimeSessionRecord) => {
    const confirmed = window.confirm(
      `确定删除“${record.title}”吗？你之后仍可以在“显示已删除”中恢复。`,
    )
    if (!confirmed) return

    await softDeleteTimeRecord(record.id)
    setSelectedRecordIds((current) =>
      current.filter((id) => id !== record.id),
    )
    toast.success('时间记录已移入已删除')
    await refreshRecords()
  }

  const handleRestoreRecord = async (record: TimeSessionRecord) => {
    await restoreTimeRecord(record.id)
    toast.success('时间记录已恢复')
    await refreshRecords()
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
    const targets = records.filter(
      (record) =>
        selectedRecordIds.includes(record.id) && !record.deletedAt,
    )
    if (targets.length === 0) return

    const confirmed = window.confirm(
      `确定批量删除所选的 ${targets.length} 条记录吗？你之后仍可以在“显示已删除”中恢复。`,
    )
    if (!confirmed) return

    await Promise.all(
      targets.map((record) => softDeleteTimeRecord(record.id)),
    )
    setSelectedRecordIds([])
    toast.success(`已移入已删除：${targets.length} 条记录`)
    await refreshRecords()
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
    summary,
    trend,
    breakdown,
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
      setFormState((current) => ({ ...current, ...patch })),
    handleSubmitRecord,
  }
}
