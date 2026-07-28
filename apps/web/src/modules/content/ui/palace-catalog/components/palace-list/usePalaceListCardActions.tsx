import { toast } from '@/shared/feedback/toast'
import { appConfirm } from '@/shared/components/ui/native-dialog'
import type {
  PalaceGroupedItem,
  PalaceGroupedListResponse,
} from '@/shared/api/contracts'
import { deletePalaceApi } from '@/modules/content/domain/palace-entity/api'
import { buildReviewSessionPath } from '@/modules/memory/public'
import { startUnitReviewSessionApi } from '@/modules/practice/public'

interface UsePalaceListCardActionsOptions {
  fetchData: () => Promise<PalaceGroupedListResponse>
  navigate: (to: string) => void
}

export function usePalaceListCardActions({
  fetchData,
  navigate,
}: UsePalaceListCardActionsOptions) {
  const handleDelete = async (id: number, title: string) => {
    const confirmed = await appConfirm(
      `确定删除宫殿“${title}”吗？此操作不可撤销，宫殿内容、分组和练习记录都会被删除。`,
      {
        title: '删除宫殿',
        confirmText: '删除宫殿',
        tone: 'danger',
      },
    )
    if (!confirmed) return
    try {
      await deletePalaceApi(id)
      toast.success(`宫殿“${title}”已删除，列表已刷新。`)
      await fetchData()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除宫殿失败，请刷新列表后再试。')
    }
  }

  const handlePalaceReview = async (palace: PalaceGroupedItem) => {
    if (palace.review_status === 'marking_required') {
      navigate(`/palaces/${palace.id}/edit?mode=permanent-mark`)
      return
    }
    if (palace.review_status !== 'due') return
    try {
      const session = await startUnitReviewSessionApi(palace.id)
      navigate(buildReviewSessionPath(session.id))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建单元复习会话失败')
    }
  }

  return {
    onPalaceReview: (palace: PalaceGroupedItem) => void handlePalaceReview(palace),
    onDelete: (id: number, title: string) => void handleDelete(id, title),
  }
}
