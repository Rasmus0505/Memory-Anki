import { Component, type ErrorInfo, type PropsWithChildren } from 'react'
import { resetPwaRuntime } from '@/pwa/resetPwa'
import { Button } from '@/shared/components/ui/button'
import { isChunkLoadError } from '@/shared/lib/lazyWithRetry'
import { logAppError } from '@/shared/logs/model/appLogs'

interface AppErrorBoundaryState { error: Error | null; repairing: boolean }

export class AppErrorBoundary extends Component<PropsWithChildren, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null, repairing: false }

  static getDerivedStateFromError(error: Error) { return { error, repairing: false } }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logAppError({
      feature: 'React 渲染', stage: 'app_error_boundary', error,
      responseSummary: info.componentStack ?? '',
      meta: { componentStack: info.componentStack ?? '', releaseId: __MEMORY_ANKI_RELEASE_ID__ },
    })
  }

  repairPwa = async () => {
    this.setState({ repairing: true })
    try { await resetPwaRuntime() } finally { window.location.reload() }
  }

  copyDiagnostics = async () => {
    const error = this.state.error
    await navigator.clipboard?.writeText([
      `release=${__MEMORY_ANKI_RELEASE_ID__}`, `url=${window.location.href}`,
      `error=${error?.name ?? 'Error'}: ${error?.message ?? 'unknown'}`, error?.stack ?? '',
    ].join('\n'))
  }

  render() {
    const { error, repairing } = this.state
    if (!error) return this.props.children
    const versionError = isChunkLoadError(error) || /module|chunk|stylesheet|release|asset/i.test(error.message)
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <section className="w-full max-w-xl rounded-xl border bg-card p-6 shadow-xl">
          <h1 className="text-xl font-semibold">{versionError ? '应用版本加载失败' : '应用发生异常'}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {versionError ? '当前设备可能混用了不同发布版本的资源，可以安全修复 PWA 缓存后重新加载。' : '学习数据没有被清除。你可以重试，或复制诊断信息后再处理。'}
          </p>
          <pre className="mt-4 max-h-48 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap">{error.name}: {error.message}</pre>
          <div className="mt-4 text-xs text-muted-foreground">当前版本：{__MEMORY_ANKI_RELEASE_ID__}</div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button type="button" onClick={() => window.location.reload()}>重新加载</Button>
            <Button type="button" variant="secondary" disabled={repairing} onClick={() => void this.repairPwa()}>{repairing ? '正在修复…' : '修复 PWA 版本'}</Button>
            <Button type="button" variant="outline" onClick={() => void this.copyDiagnostics()}>复制诊断</Button>
          </div>
        </section>
      </main>
    )
  }
}
