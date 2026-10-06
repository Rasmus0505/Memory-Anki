import { useCallback, useEffect, useRef } from 'react'
import { buildAttachmentUrl, uploadAttachmentApi } from '@/modules/content/domain/palace-entity/api/catalogApi'
import type { ArticleReadingOwnerId } from '@/shared/api/contracts/articleReading'

export function useArticleImageUpload(ownerId: ArticleReadingOwnerId | null) {
  const currentOwner = useRef(ownerId)
  currentOwner.current = ownerId
  const mounted = useRef(true)
  const operation = useRef(0)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current += 1 } }, [])
  const upload = useCallback(async (file: File) => {
    const match = /^palace:(\d+)$/.exec(ownerId ?? '')
    if (!match) throw new Error('请在已保存的宫殿中上传图片。')
    const capturedOwner = ownerId
    const operationId = ++operation.current
    const attachment = await uploadAttachmentApi(Number(match[1]), file)
    if (!mounted.current || currentOwner.current !== capturedOwner || operationId !== operation.current) throw new Error('文档已切换，图片未插入；上传的附件仍保留在原宫殿。')
    return { src: buildAttachmentUrl(attachment.id), alt: file.name }
  }, [ownerId])
  return ownerId?.startsWith('palace:') ? upload : undefined
}
