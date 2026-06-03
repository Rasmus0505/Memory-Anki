import { useMemo, useState } from 'react'
import {
  getPalaceVersionDetailApi,
  getPalaceVersionsApi,
  restorePalaceVersionApi,
} from '@/shared/api/modules/palaces'
import type { PalaceVersionDetail, PalaceVersionSummary } from '@/shared/api/contracts'
import type { PalaceMeta, StatusBadgeState } from '@/features/palace-edit/model/palace-edit-types'

interface PalaceVersionsControllerOptions {
  palaceId: number | null
  palace: PalaceMeta | null
  editorStateLoaded: boolean
  saveError: string | null
  isSaving: boolean
  reload: () => Promise<void>
  onAfterRestore: () => void
}

export function usePalaceVersionsController({
  palaceId,
  palace,
  editorStateLoaded,
  saveError,
  isSaving,
  reload,
  onAfterRestore,
}: PalaceVersionsControllerOptions) {
  const [versionOpen, setVersionOpen] = useState(false)
  const [versions, setVersions] = useState<PalaceVersionSummary[]>([])
  const [removedDuplicateCount, setRemovedDuplicateCount] = useState(0)
  const [previewingVersionId, setPreviewingVersionId] = useState<number | null>(null)
  const [previewVersionDetail, setPreviewVersionDetail] = useState<PalaceVersionDetail | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')

  const handleOpenVersions = async () => {
    if (!palace) return
    const result = await getPalaceVersionsApi(palace.id)
    setVersions(result.versions)
    setRemovedDuplicateCount(result.removed_duplicates ?? 0)
    setPreviewingVersionId(null)
    setPreviewVersionDetail(null)
    setPreviewError('')
    setPreviewLoading(false)
    setVersionOpen(true)
  }

  const handlePreviewVersion = async (versionId: number) => {
    if (!palace) return
    setPreviewingVersionId(versionId)
    setPreviewLoading(true)
    setPreviewError('')
    try {
      const detail = await getPalaceVersionDetailApi(palace.id, versionId)
      setPreviewVersionDetail(detail)
    } catch (err) {
      setPreviewVersionDetail(null)
      setPreviewError(err instanceof Error ? err.message : '加载版本预览失败。')
    } finally {
      setPreviewLoading(false)
    }
  }

  const resetVersionPreview = () => {
    setPreviewingVersionId(null)
    setPreviewVersionDetail(null)
    setPreviewError('')
    setPreviewLoading(false)
  }

  const handleCloseVersions = () => {
    setVersionOpen(false)
    resetVersionPreview()
    setRemovedDuplicateCount(0)
  }

  const handleRestoreVersion = async (versionId: number) => {
    if (!palace) return
    const confirmed = window.confirm(
      '恢复历史版本只会回滚当前宫殿内容，不会影响其他宫殿和复习记录。确定继续吗？',
    )
    if (!confirmed) return
    await restorePalaceVersionApi(palace.id, versionId)
    await reload()
    onAfterRestore()
    handleCloseVersions()
  }

  const statusBadge = useMemo<StatusBadgeState>(() => {
    if (!palaceId) {
      return { variant: 'secondary', label: '正在创建草稿' }
    }
    if (saveError) {
      return { variant: 'destructive', label: '保存异常' }
    }
    if (!editorStateLoaded) {
      return { variant: 'secondary', label: '加载中' }
    }
    if (isSaving) {
      return { variant: 'secondary', label: '自动保存脑图中' }
    }
    return { variant: 'secondary', label: '宿主桥已连接' }
  }, [editorStateLoaded, isSaving, palaceId, saveError])

  return {
    versionOpen,
    setVersionOpen,
    versions,
    removedDuplicateCount,
    previewingVersionId,
    previewVersionDetail,
    previewLoading,
    previewError,
    statusBadge,
    handleOpenVersions,
    handlePreviewVersion,
    handleCloseVersions,
    handleRestoreVersion,
    resetVersionPreview,
  }
}
