import { useEffect, useState, type ChangeEvent } from 'react'
import {
  deleteAttachmentApi,
  updatePalaceApi,
  uploadAttachmentApi,
} from '@/modules/content/domain/palace-entity/api'
import { formatDateTimeInputValue, toLocalDateTimePayload } from '@/modules/content/ui/palace-edit/model/palace-edit-format'
import type { PalaceMeta } from '@/modules/content/ui/palace-edit/model/palace-edit-types'

interface PalaceMetaControllerOptions {
  palace: PalaceMeta | null
  reload: () => Promise<void>
}

export function usePalaceMetaController({ palace, reload }: PalaceMetaControllerOptions) {
  const [title, setTitle] = useState('')
  const [createdAt, setCreatedAt] = useState('')

  useEffect(() => {
    if (!palace) return
    setTitle(palace.title)
    setCreatedAt(formatDateTimeInputValue(palace.created_at))
  }, [palace])

  const handleTitleChange = (value: string) => {
    setTitle(value)
  }
  const handleCreatedAtChange = (value: string) => {
    setCreatedAt(value)
  }
  const handleSaveMeta = async () => {
    if (!palace) return
    const nextTitle = title.trim() || '未命名宫殿'
    await updatePalaceApi(palace.id, {
      ...(nextTitle !== palace.title ? { title: nextTitle } : {}),
      created_at: createdAt ? toLocalDateTimePayload(createdAt) : null,
    })
    await reload()
  }
  const handleEstablishCreatedAt = async () => {
    if (!palace) return
    await updatePalaceApi(palace.id, { created_at: new Date().toISOString() })
    await reload()
  }
  const handleAttachmentUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !palace) return
    await uploadAttachmentApi(palace.id, file)
    await reload()
    event.target.value = ''
  }
  const handleAttachmentDelete = async (attachmentId: number) => {
    await deleteAttachmentApi(attachmentId)
    await reload()
  }

  return {
    title, setTitle: handleTitleChange, createdAt, setCreatedAt: handleCreatedAtChange,
    handleSaveMeta, handleEstablishCreatedAt, handleAttachmentUpload, handleAttachmentDelete,
  }
}
