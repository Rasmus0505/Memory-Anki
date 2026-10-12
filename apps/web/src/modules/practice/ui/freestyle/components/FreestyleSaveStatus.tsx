import type { FreestyleSaveOutcome } from '../model/freestyleSettlementModel'

const COPY: Record<FreestyleSaveOutcome, { text: string; tone: string }> = {
  saved: { text: '数据已保存成功', tone: 'text-rate-easy' },
  conflict: { text: '另一处已更新这一轮，请刷新后再结算', tone: 'text-rate-hard' },
  failed: { text: '保存失败，数据未改动', tone: 'text-rate-hard' },
  unconfirmed: { text: '正在确认保存结果…', tone: 'text-stage-muted' },
}

interface FreestyleSaveStatusProps {
  outcome: FreestyleSaveOutcome
  onRetry?: () => void
}

export function FreestyleSaveStatus({ outcome, onRetry }: FreestyleSaveStatusProps) {
  const { text, tone } = COPY[outcome]
  return (
    <p role="status" className={`flex items-center gap-2 text-sm ${tone}`}>
      <span>{text}</span>
      {outcome === 'failed' && onRetry ? (
        <button type="button" onClick={onRetry} className="underline">
          重试
        </button>
      ) : null}
    </p>
  )
}
