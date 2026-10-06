import { useMemo, useState } from 'react'
import { BookOpen, ChartNoAxesColumnIncreasing, ChevronRight, CircleHelp, Grid2X2, Layers3, RefreshCw } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { useLearningProgress } from '../../application/useLearningProgress'
import { indexProgress, progressRows, type ProgressFilter, type ProgressSort, type ProgressView } from '../../domain/learningProgress'
import { ProgressOverview } from './ProgressOverview'
import { ProgressExplorer, ProgressSearch } from './ProgressExplorer'
import { ProgressDetails } from './ProgressDetails'
import './progress.css'

const VIEWS = [
  { id: 'hierarchy', label: '层级', icon: Layers3 },
  { id: 'matrix', label: '分布', icon: Grid2X2 },
  { id: 'questions', label: '题目', icon: ChartNoAxesColumnIncreasing },
] as const

export function LearningProgressPage() {
  const result = useLearningProgress()
  const [params, setParams] = useSearchParams()
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const view: ProgressView = VIEWS.some((item) => item.id === params.get('view')) ? params.get('view') as ProgressView : 'hierarchy'
  const filter: ProgressFilter = ['due', 'unreviewed', 'unanswered'].includes(params.get('filter') ?? '') ? params.get('filter') as ProgressFilter : 'all'
  const sort: ProgressSort = ['coverage', 'due'].includes(params.get('sort') ?? '') ? params.get('sort') as ProgressSort : 'default'
  const query = params.get('q') ?? ''
  const index = useMemo(() => indexProgress(result.data?.roots ?? []), [result.data])
  const scope = index.get(params.get('scope') ?? '')
  const selected = index.get(params.get('selected') ?? '')
  const current = selected && (!scope || selected.node.id === scope.node.id || selected.ancestors.some((part) => part.id === scope.node.id)) ? selected : scope
  const roots = useMemo(() => scope ? (scope.node.children.length ? scope.node.children : [scope.node]) : result.data?.roots ?? [], [scope, result.data])
  const rows = useMemo(() => progressRows({
    roots, expanded: view === 'questions' ? new Set() : expanded,
    query, filter, sort, leavesOnly: view === 'matrix',
  }), [roots, expanded, query, filter, sort, view])
  const palaceCount = useMemo(() => {
    const ids = new Set<number>()
    for (const entry of index.values()) {
      if (entry.node.kind !== 'palace' || entry.node.palace_id == null) continue
      if (!scope || entry.node.id === scope.node.id || entry.ancestors.some((part) => part.id === scope.node.id)) ids.add(entry.node.palace_id)
    }
    if (scope?.node.palace_id != null) ids.add(scope.node.palace_id)
    return ids.size
  }, [index, scope])
  function updateParam(key: string, value: string, replace = true) {
    setParams((previous) => { const next = new URLSearchParams(previous); if (value) next.set(key, value); else next.delete(key); return next }, { replace })
  }
  function changeScope(id: string) {
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      if (id) next.set('scope', id); else next.delete('scope')
      next.delete('selected')
      return next
    })
  }
  function toggle(id: string) {
    setExpanded((previous) => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }
  const metrics = scope?.node.metrics ?? result.data?.metrics
  const name = scope?.node.name ?? '全部学科'
  const breadcrumbs = scope ? [...scope.ancestors, scope.node] : []
  const updated = result.data?.generated_at ? new Date(result.data.generated_at) : null
  return <div className="learning-progress" data-testid="learning-progress">
    <header className="lp-header">
      <div><div className="lp-eyebrow">LEARNING ATLAS / 学习全景</div><h1>进度</h1><p>看见知识的轮廓，也看见每一步积累。</p></div>
      <div className="lp-header-actions"><span className="lp-subtitle">不赶路，记住走过的路。</span><button className="lp-button" onClick={() => void result.refetch()} disabled={result.isFetching} aria-label="刷新进度"><RefreshCw size={13} />{result.isFetching ? '更新中' : '刷新'}</button></div>
    </header>
    {result.isError && <div className="lp-error" role="alert">{result.data ? '更新暂未成功，仍在显示上次快照。' : '暂时无法读取学习进度，请确认本地服务已启动。'} <button className="underline underline-offset-4" onClick={() => void result.refetch()}>重新加载</button></div>}
    {result.isPending && <div role="status" aria-label="正在加载学习进度"><div className="lp-overview lp-skeleton" style={{ height: 285 }} /><div className="lp-skeleton" style={{ height: 380 }} /><span className="sr-only">正在整理你的学习足迹…</span></div>}
    {result.data && metrics && <>
      <ProgressOverview metrics={metrics} name={name} palaceCount={palaceCount} />
      {result.data.roots.length === 0 ? <section className="lp-panel lp-empty"><BookOpen size={36} /><h2>你的学习全景，从第一座宫殿开始</h2><p>建立知识结构后，这里会逐层呈现记忆点和题目进度。现在不需要填满它，先从一个小单元开始。</p><Link className="lp-button lp-button-primary" to="/palaces">前往知识书架<ChevronRight size={14} /></Link></section> : <div className="lp-workspace">
        <section className="lp-panel" aria-label="知识进度浏览器">
          <div className="lp-explorer-header">
            <div className="lp-section-heading"><h2>知识版图</h2><div className="lp-view-switch" role="group" aria-label="进度视图">{VIEWS.map(({ id, label, icon: Icon }) => <button key={id} aria-pressed={view === id} onClick={() => updateParam('view', id)}><Icon size={13} />{label}</button>)}</div></div>
            <nav className="lp-breadcrumb" aria-label="进度范围"><button aria-current={!scope ? 'page' : undefined} onClick={() => changeScope('')}>全部学科</button>{breadcrumbs.map((part, i) => <span key={part.id} className="inline-flex items-center gap-1"><ChevronRight size={11} /><button aria-current={i === breadcrumbs.length - 1 ? 'page' : undefined} onClick={() => changeScope(part.id)} title={part.name}>{part.name}</button></span>)}</nav>
            <div className="lp-toolbar"><ProgressSearch query={query} onChange={(value) => updateParam('q', value)} />
              <select className="lp-select" aria-label="筛选进度" value={filter} onChange={(event) => updateParam('filter', event.target.value)}><option value="all">全部状态</option><option value="due">待复习</option><option value="unreviewed">尚未覆盖</option><option value="unanswered">有未做题目</option></select>
              <select className="lp-select" aria-label="排序方式" value={sort} onChange={(event) => updateParam('sort', event.target.value)}><option value="default">知识顺序</option><option value="coverage">覆盖从少到多</option><option value="due">待复习优先</option></select>
            </div>
            {view === 'hierarchy' && <div className="lp-expansion-controls"><span>逐层展开，让信息恰到好处</span><select className="lp-select" aria-label="批量展开层级" defaultValue="" onChange={(event) => {
              const depth = Number(event.target.value)
              const next = new Set<string>()
              const baseDepth = scope ? scope.depth + 1 : 0
              for (const entry of index.values()) {
                if (entry.depth - baseDepth < depth && entry.node.children.length && (!scope || entry.ancestors.some((part) => part.id === scope.node.id))) next.add(entry.node.id)
              }
              setExpanded(next)
              event.target.value = ''
            }}><option value="" disabled>展开层级</option><option value="0">全部收起</option><option value="1">展开一级</option><option value="2">展开两级</option><option value="3">展开三级</option></select></div>}
            {(query || filter !== 'all') && <p className="lp-subtitle mt-3">结果包含当前范围内匹配的下级内容。<button className="underline underline-offset-4" onClick={() => setParams((previous) => { const next = new URLSearchParams(previous); next.delete('q'); next.delete('filter'); return next }, { replace: true })}>清除筛选</button></p>}
            {params.get('scope') && !scope && <p className="lp-subtitle mt-3" role="status">原范围已不存在，已回到全部学科。</p>}
          </div>
          <ProgressExplorer rows={rows} view={view} expanded={expanded} onToggle={toggle} selectedId={current?.node.id ?? null} onSelect={(node) => updateParam('selected', node.id)} onScope={changeScope} resultKey={`${scope?.node.id ?? ''}:${view}:${query}:${filter}:${sort}`} />
        </section>
        <ProgressDetails node={current?.node ?? null} ancestors={current?.ancestors ?? []} metrics={metrics} onScope={changeScope} notes={result.data.notes} />
      </div>}
      <footer className="lp-footer"><span className="inline-flex items-center gap-1.5"><CircleHelp size={12} />复习记录 ≠ 记忆掌握 · 已作答 ≠ 已答对</span><span>{updated && Number.isFinite(updated.getTime()) ? `快照更新于 ${updated.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}` : '只读学习快照'} · 当前范围统计不随筛选改变</span></footer>
    </>}
  </div>
}
