import { useCallback, useState } from 'react'
import { getPalaceEditorApi } from '@/modules/content/public'
import { toast } from '@/shared/feedback/toast'
import { buildMindMapOutlineText } from '@/shared/lib/mindMapOutlineText'

/**
 * Copy one palace's mind map as a plain-text outline for an AI chat.
 *
 * The question dialogs already show the answered question; this gives the
 * learner the palace background behind it (text hierarchy only — no JSON) so
 * an AI can answer with the same study context the learner has.
 */
export function useCopyPalaceMindMapOutline() {
  const [copying, setCopying] = useState(false)
  const copyOutline = useCallback(async (palaceId: number | null | undefined) => {
    if (palaceId == null) return
    setCopying(true)
    try {
      const response = await getPalaceEditorApi(palaceId)
      const text = buildMindMapOutlineText(response.editor_doc, {
        title: response.palace?.title ?? '',
      })
      if (!text) throw new Error('这个宫殿还没有可复制的导图内容。')
      if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
        throw new Error('当前环境不支持写入剪贴板。')
      }
      await navigator.clipboard.writeText(text)
      toast.success('已复制导图，可粘贴给 AI 作为作答背景。')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '复制导图失败。')
    } finally {
      setCopying(false)
    }
  }, [])
  return { copying, copyOutline }
}
