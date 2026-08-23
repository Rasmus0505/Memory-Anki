import { Component, type ErrorInfo, type PropsWithChildren } from 'react'
import { resetPwaRuntime } from '@/pwa/resetPwa'
import { ErrorState } from '@/shared/components/state-placeholders'
import { Button } from '@/shared/components/ui/button'
import { isChunkLoadError } from '@/shared/lib/lazyWithRetry'
import { logAppError } from '@/shared/logs/model/appLogs'
import { buildRuntimeDiagnostics, copyRuntimeDiagnostics } from './runtimeDiagnostics'

interface RouteErrorBoundaryState {
  error: Error | null
  repairing: boolean
  componentStack: string
  copyStatus: 'idle' | 'copied' | 'unavailable'
}

interface RouteErrorBoundaryProps {
  /** Clears the captured error when the active route changes. */
  resetKey: string
}

export class RouteErrorBoundary extends Component<
  PropsWithChildren<RouteErrorBoundaryProps>,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = {
    error: null,
    repairing: false,
    componentStack: '',
    copyStatus: 'idle',
  }

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { error, repairing: false, componentStack: '', copyStatus: 'idle' }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logAppError({
      feature: 'React 渲染',
      stage: 'route_error_boundary',
      error,
      responseSummary: info.componentStack ?? '',
      meta: { componentStack: info.componentStack ?? '' },
    })
    this.setState({ componentStack: info.componentStack ?? '' })
  }

  componentDidUpdate(previousProps: RouteErrorBoundaryProps) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null, repairing: false, componentStack: '', copyStatus: 'idle' })
    }
  }

  handleRetry = () => {
    this.setState({ error: null, repairing: false, componentStack: '', copyStatus: 'idle' })
  }

  copyDiagnostics = async () => {
    const error = this.state.error
    const copied = await copyRuntimeDiagnostics(buildRuntimeDiagnostics({
      area: error && isChunkLoadError(error) ? 'route chunk error' : 'route error',
      error,
      componentStack: this.state.componentStack,
    }))
    this.setState({ copyStatus: copied ? 'copied' : 'unavailable' })
  }

  handleChunkRecovery = async () => {
    this.setState({ repairing: true })
    try {
      await resetPwaRuntime()
    } finally {
      window.location.reload()
    }
  }

  render() {
    const { error, repairing, componentStack, copyStatus } = this.state
    if (!error) return this.props.children

    const chunkError = isChunkLoadError(error)
    const diagnostics = buildRuntimeDiagnostics({
      area: chunkError ? 'route chunk error' : 'route error',
      error,
      componentStack,
    })
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-6">
        <ErrorState
          className="max-w-xl"
          title={chunkError ? '页面资源加载失败' : '这个页面出了点问题'}
          description={
            <span className="space-y-2">
              <span className="block">
                {chunkError
                  ? '应用可能刚发布了新版本，旧的页面资源已不存在。刷新页面即可加载最新版本。'
                  : '页面渲染遇到异常，导航仍然可用。你可以重试渲染，或刷新整页。'}
              </span>
              {error.message ? (
                <span className="block text-xs text-muted-foreground">错误信息：{error.message}</span>
              ) : null}
            </span>
          }
          action={
            <div className="w-full space-y-3">
              <details className="rounded-lg bg-muted p-3 text-left text-xs" open>
                <summary className="cursor-pointer font-medium">完整诊断信息</summary>
                <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap">{diagnostics}</pre>
              </details>
              <div className="flex flex-wrap justify-center gap-2">
                {chunkError ? (
                  <>
                    <Button type="button" disabled={repairing} onClick={() => void this.handleChunkRecovery()}>
                      {repairing ? '正在修复…' : '修复并刷新'}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => window.location.reload()}>
                      直接刷新
                    </Button>
                  </>
                ) : (
                  <>
                    <Button type="button" onClick={this.handleRetry}>
                      重试
                    </Button>
                    <Button type="button" variant="outline" onClick={() => window.location.reload()}>
                      刷新页面
                    </Button>
                  </>
                )}
                <Button type="button" variant="outline" onClick={() => void this.copyDiagnostics()}>
                  {copyStatus === 'copied' ? '已复制诊断' : copyStatus === 'unavailable' ? '请手动复制诊断' : '复制诊断'}
                </Button>
              </div>
            </div>
          }
        />
      </div>
    )
  }
}
