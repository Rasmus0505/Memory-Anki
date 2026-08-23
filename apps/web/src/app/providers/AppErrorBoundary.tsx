import { Component, type ErrorInfo, type PropsWithChildren } from 'react'
import { resetPwaRuntime } from '@/pwa/resetPwa'
import { Button } from '@/shared/components/ui/button'
import { isChunkLoadError } from '@/shared/lib/lazyWithRetry'
import { logAppError } from '@/shared/logs/model/appLogs'
import { buildRuntimeDiagnostics, copyRuntimeDiagnostics, runtimeReleaseId } from './runtimeDiagnostics'

interface AppErrorBoundaryState {
  error: Error | null
  repairing: boolean
  componentStack: string
  copyStatus: 'idle' | 'copied' | 'unavailable'
}

export class AppErrorBoundary extends Component<PropsWithChildren, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    error: null,
    repairing: false,
    componentStack: '',
    copyStatus: 'idle',
  }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error, repairing: false, componentStack: '', copyStatus: 'idle' }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logAppError({
      feature: 'React 渲染', stage: 'app_error_boundary', error,
      responseSummary: info.componentStack ?? '',
      meta: { componentStack: info.componentStack ?? '', releaseId: runtimeReleaseId() },
    })
    this.setState({ componentStack: info.componentStack ?? '' })
  }

  repairPwa = async () => {
    this.setState({ repairing: true })
    try { await resetPwaRuntime() } finally { window.location.reload() }
  }

  copyDiagnostics = async () => {
    const copied = await copyRuntimeDiagnostics(buildRuntimeDiagnostics({
      area: 'application error',
      error: this.state.error,
      componentStack: this.state.componentStack,
    }))
    this.setState({ copyStatus: copied ? 'copied' : 'unavailable' })
  }

  render() {
    const { error, repairing, componentStack, copyStatus } = this.state
    if (!error) return this.props.children
    const versionError = isChunkLoadError(error) || /module|chunk|stylesheet|release|asset/i.test(error.message)
    const diagnostics = buildRuntimeDiagnostics({
      area: 'application error',
      error,
      componentStack,
    })
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <section className="w-full max-w-xl rounded-xl border bg-card p-6 shadow-xl">
          <h1 className="text-xl font-semibold">{versionError ? '应用版本加载失败' : '应用发生异常'}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {versionError ? '当前设备可能混用了不同发布版本的资源，可以安全修复 PWA 缓存后重新加载。' : '学习数据没有被清除。你可以重试，或复制诊断信息后再处理。'}
          </p>
          <details className="mt-4 rounded-lg bg-muted p-3 text-xs" open>
            <summary className="cursor-pointer font-medium">完整诊断信息</summary>
            <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap">{diagnostics}</pre>
          </details>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button type="button" onClick={() => window.location.reload()}>重新加载</Button>
            <Button type="button" variant="secondary" disabled={repairing} onClick={() => void this.repairPwa()}>{repairing ? '正在修复…' : '修复 PWA 版本'}</Button>
            <Button type="button" variant="outline" onClick={() => void this.copyDiagnostics()}>
              {copyStatus === 'copied' ? '已复制诊断' : copyStatus === 'unavailable' ? '请手动复制诊断' : '复制诊断'}
            </Button>
          </div>
        </section>
      </main>
    )
  }
}
