import { useState, type CSSProperties } from 'react'
import { BookOpen, ChevronDown, ChevronLeft, ChevronRight, ChevronsRight, CircleDot, Folder, GraduationCap, Search, SearchX } from 'lucide-react'
import type { LearningProgressNode } from '@/shared/api/contracts/learningProgress'
import { KIND_LABELS, STATE_LABELS, memoryState, percentage, type IndexedProgressNode, type ProgressView } from '../../domain/learningProgress'
import { ProgressBar, ProgressLegend } from './ProgressOverview'

function NodeIcon({ kind }: { kind: string }) {
  if (kind === 'subject') return <GraduationCap size={16} />
  if (kind === 'palace') return <BookOpen size={15} />
  if (kind === 'memory_point') return <CircleDot size={14} />
  return <Folder size={15} />
}

export function ProgressExplorer({ rows, view, expanded, onToggle, selectedId, onSelect, onScope, resultKey }: {
  rows: IndexedProgressNode[]
  view: ProgressView
  expanded: Set<string>
  onToggle: (id: string) => void
  selectedId: string | null
  onSelect: (node: LearningProgressNode) => void
  onScope: (id: string) => void
  resultKey: string
}) {
  // Reset pagination for a new range/filter, without losing expansion on view switches.
  const [paging, setPaging] = useState({ key: resultKey, page: 0 })
  const size = view === 'matrix' ? 96 : 30
  const pages = Math.max(1, Math.ceil(rows.length / size))
  const page = paging.key === resultKey ? Math.min(paging.page, pages - 1) : 0
  const visible = rows.slice(page * size, (page + 1) * size)
  const groups = new Map<string, { path: string; items: Array<{ entry: IndexedProgressNode; ordinal: number }> }>()
  visible.forEach((entry, i) => {
    const key = entry.ancestors.at(-1)?.id ?? 'current'
    const group = groups.get(key) ?? { path: entry.ancestors.map((part) => part.name).join(' / ') || '当前范围', items: [] }
    group.items.push({ entry, ordinal: page * size + i + 1 })
    groups.set(key, group)
  })
  const changePage = (next: number) => setPaging({ key: resultKey, page: Math.max(0, Math.min(pages - 1, next)) })
  if (!rows.length) return <div className="lp-empty" role="status"><SearchX size={30} /><h3>这里暂时没有符合条件的内容</h3><p>试试切换筛选、缩短关键词，或回到上一级。没有记录不代表没有努力。</p></div>
  return <>
    {view === 'hierarchy' && <>
      <div className="lp-table-head" aria-hidden="true"><span>知识结构</span><span>复习覆盖</span><span>题目作答</span></div>
      <ul aria-label="知识层级进度">
        {visible.map(({ node, ancestors, depth }) => <li className="lp-row" key={node.id} data-selected={node.id === selectedId}>
          <div className="lp-row-name" style={{ '--lp-depth': depth } as CSSProperties}>
            {node.children.length ? <button className="lp-icon-button" onClick={() => onToggle(node.id)} aria-expanded={expanded.has(node.id)} aria-label={`${expanded.has(node.id) ? '收起' : '展开'}${node.name}`}>
              {expanded.has(node.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button> : <span style={{ width: 16, flexShrink: 0 }} />}
            <span className="lp-node-icon"><NodeIcon kind={node.kind} /></span>
            <button className="lp-node-text" onClick={() => onSelect(node)} aria-label={`查看${node.name}详情`} aria-pressed={node.id === selectedId} title={node.name}>
              <strong>{node.name}</strong><small>{KIND_LABELS[node.kind] ?? node.kind}{node.children.length ? ` · ${node.children.length} 个子项` : ''}{node.metrics.memory_due > 0 ? ` · ${node.metrics.memory_due} 待复习` : ''}{ancestors.length > 0 ? ` · ${ancestors.at(-1)?.name}` : ''}</small>
            </button>
          </div>
          <div className="lp-row-metric"><div><span>{node.metrics.memory_reviewed} / {node.metrics.memory_total}</span><small>{node.metrics.memory_total ? `${percentage(node.metrics.memory_reviewed, node.metrics.memory_total)}%` : '—'}</small></div><ProgressBar metrics={node.metrics} /></div>
          <div className="lp-row-quiz">{node.metrics.quiz_total ? `${node.metrics.quiz_answered} / ${node.metrics.quiz_total}` : '—'}<small>{node.metrics.quiz_total ? '已作答 / 总题数' : '暂无关联题目'}</small></div>
        </li>)}
      </ul>
    </>}
    {view === 'matrix' && <div className="lp-matrix">
      <p className="lp-matrix-intro">每一格，是一个真实记忆点。点选查看名称、位置和练习情况；琥珀色表示到了复习时间，不等于已经遗忘。</p>
      <div aria-label="记忆点分布">
        {[...groups].map(([key, group]) => <section key={key} className="lp-matrix-group" aria-label={group.path}>
          <h3 title={group.path}>{group.path}<small>{group.items.length} 个点 · 本页</small></h3>
          <div className="lp-matrix-grid">{group.items.map(({ entry: { node }, ordinal }) => <button key={node.id} className="lp-tile" data-state={memoryState(node.metrics)} aria-pressed={selectedId === node.id}
            aria-label={`${node.name}，${STATE_LABELS[memoryState(node.metrics)]}`} title={`${node.name} · ${STATE_LABELS[memoryState(node.metrics)]}`} onClick={() => onSelect(node)}>
            <span>{ordinal}</span><small>{node.name}</small>
          </button>)}</div>
        </section>)}
      </div>
      <ProgressLegend />
    </div>}
    {view === 'questions' && <div className="lp-comparison">
      <p className="lp-matrix-intro">按当前知识范围比较题目覆盖。同一道题反复作答仍计为一道；父级按题目去重，不简单累加子项。</p>
      {visible.map(({ node }) => <div className="lp-comparison-row" key={node.id}>
        <div className="lp-comparison-top"><button onClick={() => onSelect(node)} title={node.name}>{node.name}</button><span>{node.metrics.quiz_answered} / {node.metrics.quiz_total} 题</span></div>
        <div className="lp-bar" role="img" aria-label={`${node.name}已作答 ${node.metrics.quiz_answered}，共 ${node.metrics.quiz_total} 题`}><span className="lp-bar-reviewed" style={{ width: `${percentage(node.metrics.quiz_answered, node.metrics.quiz_total)}%` }} /></div>
        <div className="lp-comparison-note"><span>{node.metrics.quiz_total ? `${percentage(node.metrics.quiz_answered, node.metrics.quiz_total)}% 已作答 · ${node.metrics.quiz_total - node.metrics.quiz_answered} 题未作答` : '暂无关联题目'}</span>{node.children.length > 0 && <button onClick={() => onScope(node.id)} className="inline-flex items-center gap-1">查看下一级<ChevronsRight size={12} /></button>}</div>
      </div>)}
    </div>}
    <div className="lp-pagination"><span>{rows.length} 个{view === 'matrix' ? '记忆点' : '条目'} · 第 {page + 1} / {pages} 页</span><div><button className="lp-icon-button" aria-label="上一页" disabled={page === 0} onClick={() => changePage(page - 1)}><ChevronLeft size={15} /></button><button className="lp-icon-button" aria-label="下一页" disabled={page + 1 >= pages} onClick={() => changePage(page + 1)}><ChevronRight size={15} /></button></div></div>
  </>
}

export function ProgressSearch({ query, onChange }: { query: string; onChange: (value: string) => void }) {
  return <label className="lp-search"><Search size={15} aria-hidden="true" /><input aria-label="搜索当前范围" placeholder="搜索学科、宫殿或记忆点…" value={query} onChange={(event) => onChange(event.target.value)} /></label>
}
