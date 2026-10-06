import { ArrowDownRight, ArrowUpRight, BookOpen, Compass, Info, Layers3 } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { LearningProgressMetrics, LearningProgressNode } from '@/shared/api/contracts/learningProgress'
import { KIND_LABELS } from '../../domain/learningProgress'
import { ProgressBar } from './ProgressOverview'

export function ProgressDetails({ node, ancestors, metrics, onScope, notes }: {
  node: LearningProgressNode | null
  ancestors: LearningProgressNode[]
  metrics: LearningProgressMetrics
  onScope: (id: string) => void
  notes: string[]
}) {
  const current = node?.metrics ?? metrics
  const palaceId = node?.palace_id
  return <aside className="lp-aside" aria-label="进度详情">
    <section className="lp-panel lp-detail" aria-live="polite" aria-atomic="true">
      <div className="lp-detail-icon">{node ? <BookOpen size={20} /> : <Compass size={20} />}</div>
      <div className="lp-eyebrow">{node ? 'IN FOCUS / 当前选中' : 'YOUR NEXT STEP / 下一步'}</div>
      <h2>{node?.name ?? '从全景，走向每一个细节'}</h2>
      <p className="lp-detail-description">{node ? `${ancestors.map((part) => part.name).join(' / ')}${ancestors.length ? ' / ' : ''}${KIND_LABELS[node.kind] ?? '内容'}` : '展开知识结构，或点选一个记忆点。你可以在这里查看它的复习记录和题目覆盖。'}</p>
      <ProgressBar metrics={current} />
      <dl>
        <div><dt>有复习记录</dt><dd>{current.memory_reviewed} / {current.memory_total}</dd></div>
        <div><dt>待复习记忆点</dt><dd>{current.memory_due}</dd></div>
        <div><dt>已作答题目</dt><dd>{current.quiz_total ? `${current.quiz_answered} / ${current.quiz_total}` : '暂无关联题目'}</dd></div>
        <div><dt>尚未作答</dt><dd>{current.quiz_total ? `${current.quiz_total - current.quiz_answered} 题` : '—'}</dd></div>
      </dl>
      <div className="lp-detail-actions">
        {node && node.children.length > 0 && <button className="lp-button lp-button-primary" onClick={() => onScope(node.id)}>聚焦这一范围<ArrowDownRight size={14} /></button>}
        {palaceId != null && <>
          <Link className="lp-button" to={`/palaces/${palaceId}/review`}>进入所属宫殿复习<ArrowUpRight size={14} /></Link>
          {current.quiz_total > 0 && <Link className="lp-button" to={`/palaces/${palaceId}/quiz`}>打开宫殿题库<ArrowUpRight size={14} /></Link>}
        </>}
        {!node && <Link className="lp-button" to="/palaces">打开知识书架<ArrowUpRight size={14} /></Link>}
      </div>
      {palaceId != null && node?.kind !== 'palace' && <p className="lp-detail-description">学习入口打开整个所属宫殿，不会自动限定为当前记忆点。</p>}
    </section>
    <section className="lp-note">
      <h3><Layers3 size={15} />积累，不止一个百分比</h3>
      <p>复习覆盖告诉你走过哪里，题目作答告诉你练过哪里。它们都不是“掌握率”，也不是对你的评分。</p>
      <details><summary>这些数字如何计算？</summary>
        <p>覆盖率 = 有复习记录的记忆点 ÷ 当前记忆点总数。待复习是独立的时间提醒，不与覆盖数相加。</p>
        <p>题目“已作答”不等于答对或掌握。各层按题目身份去重，父级数量可能小于子级相加。</p>
        <p>新增内容会改变分母，即使百分比下降，已有的积累也不会因此消失。</p>
        {notes.map((note) => <p key={note}>{note}</p>)}
      </details>
    </section>
    <div className="lp-subtitle flex items-start gap-2 px-2"><Info size={13} className="mt-1 shrink-0" /><span>基于当前本地学习记录。没有证据的数据，宁可留白，也不猜测。</span></div>
  </aside>
}
