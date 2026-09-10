import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Textarea } from '@/shared/components/ui/textarea'
import { formatSessionRecorderClock } from './sessionRecorderFormat'
import {
  closeSessionRecorderDialog,
  deleteSelectedSessionRecorderHistory,
  getSelectedSessionRecorder,
  getSessionRecorderCopyText,
  openSessionRecorderDialog,
  recordSessionRecorderRoute,
  selectSessionRecorderHistory,
  startSessionRecording,
  stopSessionRecording,
  updateSelectedSessionRecorderNotes,
  updateSelectedSessionRecorderReport,
} from './sessionRecorderStore'
import { useSessionRecorderState } from './useSessionRecorderState'

async function copyText(value: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return true
  }
  return false
}

function SessionRecorderDialog() {
  const state = useSessionRecorderState()
  const selected = getSelectedSessionRecorder()
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)

  useEffect(() => {
    setCopied(false)
    setCopyFailed(false)
  }, [state.selectedId, state.dialogOpen])

  const handleCopy = async () => {
    const text = getSessionRecorderCopyText(selected)
    const ok = await copyText(text)
    setCopied(ok)
    setCopyFailed(!ok)
  }

  return (
    <Dialog
      open={state.dialogOpen}
      onOpenChange={(open) => {
        if (open) openSessionRecorderDialog()
        else closeSessionRecorderDialog()
      }}
    >
      <DialogContent className="max-w-2xl" floating={false} showCloseButton data-session-recorder="true">
        <DialogHeader>
          <DialogTitle>操作记录</DialogTitle>
          <DialogDescription>上方是这次的文本操作记录，下方可补充你碰到的问题。复制会带上两段。</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 px-6 py-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">历史记录</span>
            <select
              aria-label="历史记录"
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={state.selectedId ?? ''}
              onChange={(event) => selectSessionRecorderHistory(event.target.value)}
            >
              {state.history.length === 0 ? <option value="">还没有历史记录</option> : null}
              {state.history.map((session) => (
                <option key={session.id} value={session.id}>
                  {new Date(session.startedAt).toLocaleString('zh-CN')}
                  {session.notes.trim() ? ` · ${session.notes.trim().slice(0, 16)}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">文本操作记录</span>
            <Textarea
              aria-label="文本操作记录"
              className="min-h-40 font-mono text-xs"
              value={selected?.reportText ?? ''}
              placeholder="还没有记录。点下方「开始录制」。"
              onChange={(event) => updateSelectedSessionRecorderReport(event.target.value)}
              disabled={!selected}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">额外补充</span>
            <Textarea
              aria-label="刚才碰到什么问题？（可选）"
              className="min-h-24"
              value={selected?.notes ?? ''}
              placeholder="刚才碰到什么问题？（可选）"
              onChange={(event) => updateSelectedSessionRecorderNotes(event.target.value)}
              disabled={!selected}
            />
          </label>
        </div>
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={!selected}
            onClick={() => deleteSelectedSessionRecorderHistory()}
          >
            删除
          </Button>
          <Button type="button" variant="outline" disabled={!selected} onClick={() => void handleCopy()}>
            {copied ? '已复制' : copyFailed ? '请手动复制' : '复制'}
          </Button>
          <Button type="button" onClick={() => startSessionRecording()}>
            开始录制
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SessionRecorderFloatingControl() {
  const state = useSessionRecorderState()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!state.recording) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [state.recording])

  if (!state.recording || !state.current) return null

  const elapsed = formatSessionRecorderClock(now - Date.parse(state.current.startedAt))

  return (
    <div
      className="pointer-events-none fixed right-[max(env(safe-area-inset-right),0.75rem)] top-[max(env(safe-area-inset-top),0.75rem)] z-[120]"
      data-session-recorder="true"
    >
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border bg-background/95 px-3 py-1.5 shadow-soft">
        <span className="size-2.5 shrink-0 rounded-full bg-destructive" aria-hidden />
        <span className="text-xs tabular-nums text-muted-foreground">录制中 {elapsed}</span>
        <Button type="button" size="sm" variant="destructive" onClick={() => stopSessionRecording()}>
          停止
        </Button>
      </div>
    </div>
  )
}

export function SessionRecorderHost() {
  const location = useLocation()
  const state = useSessionRecorderState()

  useEffect(() => {
    if (!state.recording) return
    recordSessionRecorderRoute(`${location.pathname}${location.search}${location.hash}`)
  }, [location.hash, location.pathname, location.search, state.recording])

  return (
    <>
      <SessionRecorderFloatingControl />
      <SessionRecorderDialog />
    </>
  )
}
