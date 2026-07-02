import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'

type NativeDialogRequest =
  | {
      id: number
      type: 'alert'
      title: string
      message: string
      resolve: () => void
    }
  | {
      id: number
      type: 'confirm'
      title: string
      message: string
      confirmText: string
      cancelText: string
      tone: 'default' | 'danger'
      resolve: (confirmed: boolean) => void
    }
  | {
      id: number
      type: 'prompt'
      title: string
      message: string
      defaultValue: string
      confirmText: string
      cancelText: string
      resolve: (value: string | null) => void
    }

let nextDialogId = 1
const listeners = new Set<(request: NativeDialogRequest | null) => void>()
const queue: NativeDialogRequest[] = []
let activeRequest: NativeDialogRequest | null = null

function emitCurrentRequest() {
  listeners.forEach((listener) => listener(activeRequest))
}

function enqueueRequest(request: NativeDialogRequest) {
  queue.push(request)
  if (!activeRequest) {
    activeRequest = queue.shift() ?? null
    emitCurrentRequest()
  }
}

function completeCurrentRequest() {
  activeRequest = queue.shift() ?? null
  emitCurrentRequest()
}

function normalizeMessage(message: string) {
  return message.trim() || '请确认此操作。'
}

export function appAlert(message: string, options?: { title?: string }) {
  if (listeners.size === 0 && typeof window !== 'undefined') {
    window.alert(normalizeMessage(message))
    return Promise.resolve()
  }
  return new Promise<void>((resolve) => {
    enqueueRequest({
      id: nextDialogId++,
      type: 'alert',
      title: options?.title ?? '提示',
      message: normalizeMessage(message),
      resolve,
    })
  })
}

export function appConfirm(
  message: string,
  options?: {
    title?: string
    confirmText?: string
    cancelText?: string
    tone?: 'default' | 'danger'
  },
) {
  if (listeners.size === 0 && typeof window !== 'undefined') {
    return Promise.resolve(window.confirm(normalizeMessage(message)))
  }
  return new Promise<boolean>((resolve) => {
    enqueueRequest({
      id: nextDialogId++,
      type: 'confirm',
      title: options?.title ?? '确认操作',
      message: normalizeMessage(message),
      confirmText: options?.confirmText ?? '确认',
      cancelText: options?.cancelText ?? '取消',
      tone: options?.tone ?? 'default',
      resolve,
    })
  })
}

export function appPrompt(
  message: string,
  options?: {
    title?: string
    defaultValue?: string
    confirmText?: string
    cancelText?: string
  },
) {
  if (listeners.size === 0 && typeof window !== 'undefined') {
    return Promise.resolve(window.prompt(normalizeMessage(message), options?.defaultValue ?? ''))
  }
  return new Promise<string | null>((resolve) => {
    enqueueRequest({
      id: nextDialogId++,
      type: 'prompt',
      title: options?.title ?? '输入内容',
      message: normalizeMessage(message),
      defaultValue: options?.defaultValue ?? '',
      confirmText: options?.confirmText ?? '确认',
      cancelText: options?.cancelText ?? '取消',
      resolve,
    })
  })
}

export function NativeDialogProvider() {
  const [request, setRequest] = useState<NativeDialogRequest | null>(activeRequest)
  const [promptValue, setPromptValue] = useState('')

  useEffect(() => {
    listeners.add(setRequest)
    return () => {
      listeners.delete(setRequest)
    }
  }, [])

  useEffect(() => {
    if (request?.type === 'prompt') setPromptValue(request.defaultValue)
  }, [request])

  if (!request) return null

  const close = () => {
    if (request.type === 'alert') request.resolve()
    if (request.type === 'confirm') request.resolve(false)
    if (request.type === 'prompt') request.resolve(null)
    completeCurrentRequest()
  }

  const confirm = () => {
    if (request.type === 'alert') request.resolve()
    if (request.type === 'confirm') request.resolve(true)
    if (request.type === 'prompt') request.resolve(promptValue)
    completeCurrentRequest()
  }

  return (
    <Dialog open={Boolean(request)} onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="max-w-md"
        floatingId={`native-${request.type}`}
        capsuleLabel={request.title}
      >
        <DialogHeader>
          <div className="flex items-start gap-3">
            {request.type === 'confirm' && request.tone === 'danger' ? (
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
            ) : null}
            <div>
              <DialogTitle>{request.title}</DialogTitle>
              <DialogDescription className="mt-1 whitespace-pre-wrap">
                {request.message}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        {request.type === 'prompt' ? (
          <div className="px-6 py-4">
            <Input
              autoFocus
              value={promptValue}
              onChange={(event) => setPromptValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') confirm()
              }}
            />
          </div>
        ) : null}
        <DialogFooter>
          {request.type === 'alert' ? null : (
            <Button type="button" variant="outline" onClick={close}>
              {request.cancelText}
            </Button>
          )}
          <Button
            type="button"
            variant={request.type === 'confirm' && request.tone === 'danger' ? 'destructive' : 'default'}
            onClick={confirm}
          >
            {request.type === 'alert' ? '知道了' : request.confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
