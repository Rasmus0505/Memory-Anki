import { Component, type ErrorInfo, type PropsWithChildren, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { logAppError } from '@/shared/logs/model/appLogs'

interface WidgetErrorBoundaryProps {
  /** Widget name shown in logs and fallback copy, for example "思维导图" or "图表". */
  label: string
  fallback?: ReactNode
  className?: string
}

interface WidgetErrorBoundaryState {
  error: Error | null
}

export class WidgetErrorBoundary extends Component<
  PropsWithChildren<WidgetErrorBoundaryProps>,
  WidgetErrorBoundaryState
> {
  state: WidgetErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): WidgetErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logAppError({
      feature: `Widget:${this.props.label}`,
      stage: 'widget_error_boundary',
      error,
      responseSummary: info.componentStack ?? '',
      meta: { componentStack: info.componentStack ?? '' },
    })
  }

  handleRetry = () => {
    this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    if (this.props.fallback) return this.props.fallback
    return (
      <div
        className={
          this.props.className ??
          'flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-muted-foreground'
        }
        role="alert"
      >
        <AlertTriangle className="size-5 text-destructive" />
        <span>{this.props.label}渲染失败，页面其他部分不受影响。</span>
        <Button type="button" size="sm" variant="outline" onClick={this.handleRetry}>
          重试渲染
        </Button>
      </div>
    )
  }
}
