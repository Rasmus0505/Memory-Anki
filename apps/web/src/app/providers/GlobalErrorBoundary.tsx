import { Component, type ErrorInfo, type PropsWithChildren, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { Button } from '@/shared/components/ui/button'
import { ErrorState } from '@/shared/components/state-placeholders'
import { logAppError } from '@/shared/logs/model/appLogs'

interface ErrorBoundaryFallbackProps {
  error: Error | null
}

function GlobalErrorFallback({ error }: ErrorBoundaryFallbackProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <ErrorState
        className="max-w-xl"
        title="页面出了点问题"
        description={
          <span className="space-y-2">
            <span className="block">前端渲染遇到异常。你可以刷新页面，或返回上一个页面继续操作。</span>
            {error?.message ? (
              <span className="block text-xs text-muted-foreground">错误信息：{error.message}</span>
            ) : null}
          </span>
        }
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" onClick={() => window.location.reload()}>
              刷新页面
            </Button>
            <Button type="button" variant="outline" onClick={() => window.history.back()}>
              返回上一页
            </Button>
          </div>
        }
      />
    </main>
  )
}

interface GlobalErrorBoundaryState {
  error: Error | null
}

class GlobalErrorBoundaryImpl extends Component<
  PropsWithChildren<{ resetKey: string; fallback?: ReactNode }>,
  GlobalErrorBoundaryState
> {
  state: GlobalErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): GlobalErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logAppError({
      feature: 'React 渲染',
      stage: 'error_boundary',
      error,
      responseSummary: info.componentStack ?? '',
      meta: {
        componentStack: info.componentStack ?? '',
      },
    })
  }

  componentDidUpdate(previousProps: PropsWithChildren<{ resetKey: string }>) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  render() {
    if (this.state.error) {
      return this.props.fallback ?? <GlobalErrorFallback error={this.state.error} />
    }
    return this.props.children
  }
}

export function GlobalErrorBoundary({ children }: PropsWithChildren) {
  const location = useLocation()
  return (
    <GlobalErrorBoundaryImpl resetKey={location.pathname}>
      {children}
    </GlobalErrorBoundaryImpl>
  )
}
