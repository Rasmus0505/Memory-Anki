import { AlertCircle, CheckCircle2, LoaderCircle, PencilLine } from 'lucide-react'
import { Badge } from '@/shared/components/ui/badge'

/** Autosave state next to the palace title; one badge, four states. */
export function SaveStatusBadge({
  status,
  error,
}: {
  status: 'saved' | 'saving' | 'unsaved' | 'error'
  error?: string | null
}) {
  if (status === 'saving') {
    return (
      <Badge variant="info" title="正在保存编辑内容">
        <LoaderCircle className="size-3 animate-spin" />
        保存中
      </Badge>
    )
  }

  if (status === 'unsaved') {
    return (
      <Badge variant="warning" title="内容已修改，系统会自动保存">
        <PencilLine className="size-3" />
        未保存
      </Badge>
    )
  }

  if (status === 'error') {
    return (
      <Badge variant="destructive" title={error || '自动保存失败，请稍后重试。'}>
        <AlertCircle className="size-3" />
        保存失败
      </Badge>
    )
  }

  return (
    <Badge variant="success" title="最近的编辑内容已保存">
      <CheckCircle2 className="size-3" />
      已保存
    </Badge>
  )
}
