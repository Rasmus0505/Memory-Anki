import { useEffect, useRef, useState } from 'react'
import type {
  BatchImportImageItem,
  BatchImportStatus,
} from '@/features/palace-edit/model/mindmap-import-types'

function createBatchImageItem(file: File): BatchImportImageItem {
  return {
    id: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    file,
    previewUrl: URL.createObjectURL(file),
    name: file.name,
  }
}

export function useImportBatchState(setError: (value: string) => void) {
  const [batchImages, setBatchImages] = useState<BatchImportImageItem[]>([])
  const [structureImageId, setStructureImageId] = useState<string | null>(null)
  const [batchStatus, setBatchStatus] = useState<BatchImportStatus>('idle')
  const [lastBatchMeta, setLastBatchMeta] = useState<{
    structureImageIndex: number
    imageCount: number
  } | null>(null)
  const batchImagesRef = useRef<BatchImportImageItem[]>([])

  const syncBatchImagesRef = (nextImages: BatchImportImageItem[]) => {
    batchImagesRef.current = nextImages
    return nextImages
  }

  useEffect(() => {
    return () => {
      batchImagesRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl))
    }
  }, [])

  const appendBatchFiles = (files: File[]) => {
    if (!files.length) return
    setError('')
    setLastBatchMeta(null)
    setBatchImages((current) => {
      const next = syncBatchImagesRef([...current, ...files.map(createBatchImageItem)])
      const currentStructureId = structureImageId || current[0]?.id || null
      setStructureImageId(
        currentStructureId && next.some((item) => item.id === currentStructureId)
          ? currentStructureId
          : (next[0]?.id ?? null),
      )
      setBatchStatus(next.length > 0 ? 'ready' : 'idle')
      return next
    })
  }

  const clearBatchQueue = () => {
    setBatchImages((current) => {
      current.forEach((item) => URL.revokeObjectURL(item.previewUrl))
      return syncBatchImagesRef([])
    })
    setStructureImageId(null)
    setBatchStatus('idle')
  }

  const handleDeleteBatchImage = (id: string) => {
    setBatchImages((current) => {
      const target = current.find((item) => item.id === id)
      if (target) {
        URL.revokeObjectURL(target.previewUrl)
      }
      const next = syncBatchImagesRef(current.filter((item) => item.id !== id))
      const nextStructureId = structureImageId === id ? next[0]?.id ?? null : structureImageId
      setStructureImageId(nextStructureId)
      setBatchStatus(next.length > 0 ? 'ready' : 'idle')
      return next
    })
    setError('')
    setLastBatchMeta(null)
  }

  const handleMoveBatchImage = (id: string, direction: 'up' | 'down') => {
    setBatchImages((current) => {
      const index = current.findIndex((item) => item.id === id)
      if (index === -1) return current
      const targetIndex = direction === 'up' ? index - 1 : index + 1
      if (targetIndex < 0 || targetIndex >= current.length) return current
      const next = [...current]
      const [item] = next.splice(index, 1)
      next.splice(targetIndex, 0, item)
      return syncBatchImagesRef(next)
    })
    setError('')
    setLastBatchMeta(null)
    setBatchStatus('ready')
  }

  const handleSetStructureImage = (id: string) => {
    setStructureImageId(id)
    setError('')
    setLastBatchMeta(null)
    setBatchStatus(batchImagesRef.current.length > 0 ? 'ready' : 'idle')
  }

  return {
    batchImages,
    batchImagesRef,
    structureImageId,
    setStructureImageId,
    batchStatus,
    setBatchStatus,
    lastBatchMeta,
    setLastBatchMeta,
    appendBatchFiles,
    clearBatchQueue,
    handleDeleteBatchImage,
    handleMoveBatchImage,
    handleSetStructureImage,
  }
}
