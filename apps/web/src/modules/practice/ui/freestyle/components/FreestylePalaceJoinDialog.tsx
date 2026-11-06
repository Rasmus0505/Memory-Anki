import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import type { FreestylePalaceJoinState } from '@/modules/practice/ui/freestyle/model/freestyle-palace-directory'

export type { FreestylePalaceJoinState }

function formatReviewDate(value: string | null): string {
  if (!value) return '还没有安排'
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return value
  return `${Number(match[2])}月${Number(match[3])}日`
}

export function FreestylePalaceJoinDialog({
  state,
  busy,
  onCancel,
  onJoin,
}: {
  state: FreestylePalaceJoinState
  busy: boolean
  onCancel: () => void
  onJoin: () => void
}) {
  const joinable = state.kind === 'join' || state.kind === 'unmarked'
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onCancel() }}>
      <DialogContent data-testid="freestyle-palace-join-dialog" className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {state.kind === 'join'
              ? '加入本轮'
              : state.kind === 'unmarked'
                ? '还没标记'
                : state.kind === 'not_due'
                  ? '今天不用复习'
                  : '没有复习单元'}
          </DialogTitle>
          <DialogDescription>
            {state.kind === 'join' ? (
              <>「{state.title}」不在本轮。加入后，今天到期的单元排进队列，以后每轮都包含它。</>
            ) : state.kind === 'unmarked' ? (
              <>标记会把整座宫殿作为一个复习单元，并加入本轮。</>
            ) : state.kind === 'not_due' ? (
              <>「{state.title}」下次复习 {formatReviewDate(state.nextReviewDate)}。</>
            ) : (
              <>「{state.title}」没有可用的复习单元。</>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {joinable ? (
            <>
              <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
                取消
              </Button>
              <Button type="button" onClick={onJoin} disabled={busy}>
                {state.kind === 'unmarked' ? '标记并加入' : '加入本轮'}
              </Button>
            </>
          ) : (
            <Button type="button" onClick={onCancel}>知道了</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
