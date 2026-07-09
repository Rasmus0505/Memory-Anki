import { Component, type ErrorInfo, type PropsWithChildren } from 'react'
import { ErrorState } from '@/shared/components/state-placeholders'
import { Button } from '@/shared/components/ui/button'
import { isChunkLoadError } from '@/shared/lib/lazyWithRetry'
import { logAppError } from '@/shared/logs/model/appLogs'

interface RouteErrorBoundaryState {
  error: Error | null
}

interface RouteErrorBoundaryProps {
  /** Clears the captured error when the active route changes. */
  resetKey: string
}

export class RouteErrorBoundary extends Component<
  PropsWithChildren<RouteErrorBoundaryProps>,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logAppError({
      feature: 'React 渲染',
      stage: 'route_error_boundary',
      error,
      responseSummary: info.componentStack ?? '',
      meta: { componentStack: info.componentStack ?? '' },
    })
  }

  componentDidUpdate(previousProps: RouteErrorBoundaryProps) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  handleRetry = () => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const chunkError = isChunkLoadError(error)
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
            <div className="flex flex-wrap justify-center gap-2">
              {chunkError ? (
                <Button type="button" onClick={() => window.location.reload()}>
                  刷新页面
                </Button>
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
            </div>
          }
        />
      </div>
    )
  }
}
