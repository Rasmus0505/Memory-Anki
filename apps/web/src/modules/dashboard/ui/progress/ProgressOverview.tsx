import { BookOpen, CircleCheck, Clock3 } from 'lucide-react'
import type { LearningProgressMetrics } from '@/shared/api/contracts/learningProgress'
import { percentage } from '../../domain/learningProgress'

const number = new Intl.NumberFormat('zh-CN')
export function ProgressBar({ metrics }: { metrics: LearningProgressMetrics }) {
  // Due is an independent scheduling signal, not evidence of forgetting.
  const reviewed = percentage(metrics.memory_reviewed, metrics.memory_total)
  return <div className="lp-bar" role="img" aria-label={`有复习记录 ${metrics.memory_reviewed}，共 ${metrics.memory_total} 个记忆点`}>
    <span className="lp-bar-reviewed" style={{ width: `${reviewed}%` }} />
  </div>
}

export function ProgressLegend() {
  return <div className="lp-legend">
    <span><i className="lp-dot lp-dot-green" />有复习记录</span>
    <span><i className="lp-dot lp-dot-amber" />待复习</span>
    <span><i className="lp-dot" />暂无复习记录</span>
  </div>
}

export function ProgressOverview({ metrics, name, palaceCount }: {
  metrics: LearningProgressMetrics
  name: string
  palaceCount: number
}) {
  const coverage = percentage(metrics.memory_reviewed, metrics.memory_total)
  const circumference = 2 * Math.PI * 53
  return <section className="lp-overview" aria-label="当前范围学习概览">
    <div className="lp-overview-main">
      <div className="lp-overview-copy">
        <h2>{name === '全部学科' ? '让每一次复习，都有迹可循。' : name}</h2>
        <div className="lp-big-number">{number.format(metrics.memory_reviewed)}<span className="lp-number-total">/ {number.format(metrics.memory_total)}</span></div>
        <p className="lp-subtitle">个记忆点已有复习记录。每一点积累，都是下一次想起的底气。</p>
        <ProgressBar metrics={metrics} />
        <div className="lp-legend">
          <span><i className="lp-dot lp-dot-green" />已复习 {number.format(metrics.memory_reviewed)}</span>
          <span><i className="lp-dot" />尚无记录 {number.format(Math.max(0, metrics.memory_total - metrics.memory_reviewed))}</span>
        </div>
      </div>
      <div className="lp-ring" role="img" aria-label={`复习覆盖率 ${metrics.memory_total ? `${coverage}%` : '暂无记忆点'}`}>
        <svg viewBox="0 0 120 120" fill="none" aria-hidden="true">
          <circle className="lp-ring-track" cx="60" cy="60" r="53" strokeWidth="6" />
          <circle className="lp-ring-fill" cx="60" cy="60" r="53" strokeWidth="6" strokeLinecap={coverage ? 'round' : 'butt'} strokeDasharray={`${circumference * coverage / 100} ${circumference}`} />
        </svg>
        <div className="lp-ring-label"><strong>{metrics.memory_total ? `${coverage}%` : '—'}</strong><small>复习覆盖率</small></div>
      </div>
    </div>
    <div className="lp-stats">
      <div className="lp-stat"><span className="lp-stat-icon"><CircleCheck size={18} /></span><div><div className="lp-stat-label">题目已作答</div><div className="lp-stat-value">{number.format(metrics.quiz_answered)}<small>/ {number.format(metrics.quiz_total)}</small></div></div></div>
      <div className="lp-stat"><span className="lp-stat-icon amber"><Clock3 size={18} /></span><div><div className="lp-stat-label">待复习记忆点</div><div className="lp-stat-value">{number.format(metrics.memory_due)}<small>个</small></div></div></div>
      <div className="lp-stat"><span className="lp-stat-icon"><BookOpen size={18} /></span><div><div className="lp-stat-label">当前范围宫殿</div><div className="lp-stat-value">{number.format(palaceCount)}<small>座</small></div></div></div>
    </div>
  </section>
}
