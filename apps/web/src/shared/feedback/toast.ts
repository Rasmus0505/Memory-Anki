import { toast as sonnerToast, type ExternalToast } from 'sonner'
import { showToast } from './feedbackCenter'

type ToastFn = ((message: string, options?: ExternalToast) => string | number) & {
  success: (message: string, options?: ExternalToast) => string | number
  error: (message: string, options?: ExternalToast) => string | number
  info: (message: string, options?: ExternalToast) => string | number
  warning: (message: string, options?: ExternalToast) => string | number
  message: (message: string, options?: ExternalToast) => string | number
  loading: typeof sonnerToast.loading
  dismiss: typeof sonnerToast.dismiss
  custom: typeof sonnerToast.custom
  promise: typeof sonnerToast.promise
}

const toastBase = ((message: string, options?: ExternalToast) =>
  showToast('message', message, options)) as ToastFn

toastBase.success = (message, options) => showToast('success', message, options)
toastBase.error = (message, options) => showToast('error', message, options)
toastBase.info = (message, options) => showToast('info', message, options)
toastBase.warning = (message, options) => showToast('warning', message, options)
toastBase.message = (message, options) => showToast('message', message, options)
toastBase.loading = sonnerToast.loading
toastBase.dismiss = sonnerToast.dismiss
toastBase.custom = sonnerToast.custom
toastBase.promise = sonnerToast.promise

export const toast = toastBase
export type { ExternalToast }
