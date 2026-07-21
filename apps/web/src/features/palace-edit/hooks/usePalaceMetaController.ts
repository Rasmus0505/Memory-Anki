import { useEffect, useState, type ChangeEvent } from 'react'
import {
  deleteAttachmentApi,
  updatePalaceApi,
  uploadAttachmentApi,
} from '@/entities/palace/api'
import { formatDateTimeInputValue, toLocalDateTimePayload } from '@/features/palace-edit/model/palace-edit-format'
import type { PalaceMeta } from '@/features/palace-edit/model/palace-edit-types'

interface PalaceMetaControllerOptions {
  palace: PalaceMeta | null
  reload: () => Promise<void>
  timer: { registerActivity: (kind: string, meta?: Record<string, unknown>) => void }
}

export function usePalaceMetaController({ palace, reload, timer }: PalaceMetaControllerOptions) {
  const [title, setTitle] = useState('')
  const [createdAt, setCreatedAt] = useState('')

  useEffect(() => {
    if (!palace) return
    setTitle(palace.title)
    setCreatedAt(formatDateTimeInputValue(palace.created_at))
  }, [palace])

  const handleTitleChange = (value: string) => {
    timer.registerActivity('edit_operation', { source: 'title_input' })
    setTitle(value)
  }
  const handleCreatedAtChange = (value: string) => {
    timer.registerActivity('edit_operation', { source: 'created_at_input' })
    setCreatedAt(value)
  }
  const handleSaveMeta = async () => {
    if (!palace) return
    timer.registerActivity('edit_operation', { source: 'save_meta' })
    const nextTitle = title.trim() || '未命名宫殿'
    await updatePalaceApi(palace.id, {
      ...(nextTitle !== palace.title ? { title: nextTitle } : {}),
      created_at: createdAt ? toLocalDateTimePayload(createdAt) : null,
    })
    await reload()
  }
  const handleEstablishCreatedAt = async () => {
    if (!palace) return
    timer.registerActivity('edit_operation', { source: 'establish_created_at' })
    await updatePalaceApi(palace.id, { created_at: new Date().toISOString() })
    await reload()
  }
  const handleAttachmentUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !palace) return
    timer.registerActivity('edit_operation', { source: 'attachment_upload' })
    await uploadAttachmentApi(palace.id, file)
    await reload()
    event.target.value = ''
  }
  const handleAttachmentDelete = async (attachmentId: number) => {
    timer.registerActivity('edit_operation', { source: 'attachment_delete' })
    await deleteAttachmentApi(attachmentId)
    await reload()
  }

  return {
    title, setTitle: handleTitleChange, createdAt, setCreatedAt: handleCreatedAtChange,
    handleSaveMeta, handleEstablishCreatedAt, handleAttachmentUpload, handleAttachmentDelete,
  }
}
