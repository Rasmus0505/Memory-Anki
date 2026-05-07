import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/api/client'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { BookOpen, ChevronRight, ChevronDown, Plus, Pencil, Trash2, FolderTree } from 'lucide-react'
import { toast } from 'sonner'
import { MindMapContainer, NodeContextMenu, chapterTreeToGraph } from '@/components/mindmap'
import type { TreeRenderMeta, MindMapNode, ContextMenuAction, ViewMode } from '@/components/mindmap'

interface Subject { id: number; name: string; color: string }
interface TreeNode { id: number; name: string; children: TreeNode[]; palace_count: number; parent_id: number | null }

export default function Knowledge() {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [tree, setTree] = useState<any>(null)
  const [selectedSubject, setSelectedSubject] = useState<number | null>(null)
  const [selectedChapter, setSelectedChapter] = useState<any>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [newSubject, setNewSubject] = useState('')
  const [newChapter, setNewChapter] = useState('')
  const [editingChapter, setEditingChapter] = useState<TreeNode | null>(null)
  const [subjectColor, setSubjectColor] = useState('#6366f1')
  const [editingSubject, setEditingSubject] = useState<number | null>(null)
  const [editSubjectName, setEditSubjectName] = useState('')
  const [editSubjectColor, setEditSubjectColor] = useState('#6366f1')
  const [view, setView] = useState<ViewMode>('outline')
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; node: TreeNode } | null>(null)

  const focusMode = view !== 'outline'

  const fetchSubjects = () => api.getSubjects().then(setSubjects)
  useEffect(() => { fetchSubjects() }, [])

  const collectIds = (nodes: TreeNode[]): number[] => {
    const ids: number[] = []
    for (const n of nodes) {
      ids.push(n.id)
      if (n.children?.length) ids.push(...collectIds(n.children))
    }
    return ids
  }

  const fetchTree = async (sid: number) => {
    setSelectedSubject(sid)
    setSelectedChapter(null)
    setEditingChapter(null)
    const data = await api.getSubjectTree(sid)
    setTree(data)
    const s = new Set<number>(collectIds(data.chapters || []))
    setExpanded(s)
  }

  const fetchChapter = async (cid: number) => {
    const data = await api.getChapter(cid)
    setSelectedChapter(data)
  }

  const createSubject = async () => {
    if (!newSubject.trim()) return
    const s = await api.createSubject({ name: newSubject, color: subjectColor })
    toast.success('学科已创建')
    setNewSubject('')
    fetchSubjects()
    fetchTree(s.id)
  }

  const updateSubject = async (id: number) => {
    if (!editSubjectName.trim()) return
    await api.updateSubject(id, { name: editSubjectName, color: editSubjectColor })
    toast.success('学科已更新')
    setEditingSubject(null)
    fetchSubjects()
    if (selectedSubject === id) fetchTree(id)
  }

  const deleteSubject = async (id: number) => {
    await api.deleteSubject(id)
    toast.success('学科已删除')
    if (selectedSubject === id) {
      setSelectedSubject(null)
      setTree(null)
      setSelectedChapter(null)
    }
    fetchSubjects()
  }

  const createChapter = async (parentId: number | null = null, name?: string) => {
    const chapterName = (name ?? newChapter).trim()
    if (!selectedSubject || !chapterName) return
    await api.createChapter(selectedSubject, { name: chapterName, parent_id: parentId })
    toast.success('章节已添加')
    setNewChapter('')
    setEditingChapter(null)
    fetchTree(selectedSubject)
  }

  const renameChapter = async (id: number, name: string) => {
    await api.updateChapter(id, { name } as any)
    toast.success('已重命名')
    fetchTree(selectedSubject!)
  }

  const deleteChapter = async (id: number) => {
    await api.deleteChapter(id)
    toast.success('已删除')
    fetchTree(selectedSubject!)
    setSelectedChapter(null)
    setEditingChapter(null)
  }

  const getContextActions = useCallback((node: TreeNode): ContextMenuAction[] => [
    {
      label: '添加子章节',
      icon: Plus,
      onClick: () => { setEditingChapter(node) },
    },
    {
      label: '重命名',
      icon: Pencil,
      onClick: () => {
        const name = prompt('新名称:', node.name)
        if (name?.trim()) renameChapter(node.id, name.trim())
      },
    },
    {
      label: '删除',
      icon: Trash2,
      onClick: () => deleteChapter(node.id),
      variant: 'danger' as const,
    },
  ], [])

  const handleContextMenu = useCallback((e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ x: e.clientX, y: e.clientY, node })
  }, [])

  const renderChapterNode = (node: TreeNode, meta: TreeRenderMeta) => {
    const isEditing = editingChapter?.id === node.id
    const isSelected = selectedChapter?.chapter?.id === node.id

    return (
      <div onContextMenu={(e) => handleContextMenu(e, node)}>
        <div
          className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors cursor-pointer
            ${isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-secondary'}`}
          style={{ paddingLeft: `${12 + meta.depth * 20}px` }}
          onClick={() => fetchChapter(node.id)}
        >
          {meta.hasChildren ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); meta.toggleExpand() }}
              className="text-muted-foreground shrink-0 hover:text-foreground"
            >
              {meta.isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          ) : <span className="w-3.5 shrink-0" />}
          <span className="flex-1 truncate">{node.name}</span>
          {node.palace_count > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 shrink-0">{node.palace_count}</Badge>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setEditingChapter(node) }}
            className="shrink-0 h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="添加子章节"
          >
            <Plus className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); deleteChapter(node.id) }}
            className="shrink-0 h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            title="删除"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
        {isEditing && (
          <div className="flex gap-1 mt-1" style={{ paddingLeft: `${32 + meta.depth * 20}px` }}>
            <input
              placeholder="子章节名..." autoFocus
              className="h-7 text-xs flex-1 rounded-md border border-input bg-background px-2 focus:outline-none focus:ring-1 focus:ring-ring"
              onKeyDown={e => {
                const val = (e.target as HTMLInputElement).value.trim()
                if (e.key === 'Enter' && val) createChapter(node.id, val)
              }} />
            <button type="button" className="h-7 px-2.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
              onClick={(e) => {
                const val = (e.currentTarget.parentElement?.querySelector('input') as HTMLInputElement)?.value?.trim()
                if (val) createChapter(node.id, val)
              }}>添加</button>
            <button type="button" className="h-7 px-2 text-xs rounded hover:bg-secondary transition-colors shrink-0"
              onClick={() => setEditingChapter(null)}>取消</button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4 h-[calc(100vh-5rem)] flex flex-col min-h-0">
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">知识大纲</h1>
          <p className="text-sm text-muted-foreground mt-1">建立学科章节体系，双向关联记忆宫殿。</p>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex gap-4">
        {/* 左侧：学科列表 */}
        <div className={`flex flex-col gap-2 shrink-0 transition-all duration-200 ${focusMode ? 'w-[44px]' : 'w-[260px]'}`}>
          {subjects.map(s => (
            focusMode ? (
              <button key={s.id}
                onClick={() => fetchTree(s.id)}
                className={`flex items-center justify-center h-9 w-9 rounded-full border-2 transition-colors shrink-0 mx-auto
                  ${selectedSubject === s.id ? 'border-primary ring-2 ring-primary/20' : 'border-muted hover:border-primary/50'}`}
                title={s.name}
                style={{ backgroundColor: s.color + '20' }}>
                <span className="text-xs font-bold" style={{ color: s.color }}>{s.name[0]}</span>
              </button>
            ) : editingSubject === s.id ? (
              <Card key={s.id} className="shrink-0">
                <CardContent className="!p-2 space-y-2">
                  <Input value={editSubjectName} onChange={e => setEditSubjectName(e.target.value)}
                    placeholder="学科名..." className="h-7 text-sm" autoFocus
                    onKeyDown={e => { if (e.key === 'Enter') updateSubject(s.id) }} />
                  <div className="flex gap-2">
                    <input type="color" value={editSubjectColor} onChange={e => setEditSubjectColor(e.target.value)}
                      className="h-7 w-7 rounded border cursor-pointer shrink-0" />
                    <Button size="sm" className="h-7 flex-1 text-xs" onClick={() => updateSubject(s.id)}>保存</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingSubject(null)}>取消</Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card key={s.id}
                className={`cursor-pointer transition-colors shrink-0 group ${selectedSubject === s.id ? 'ring-2 ring-primary' : 'hover:shadow-md'}`}
                onClick={() => fetchTree(s.id)}>
                <CardContent className="!p-3 flex items-center gap-3">
                  <div className="h-3 w-3 rounded-full shrink-0" style={{ background: s.color }} />
                  <span className="font-medium text-sm truncate flex-1">{s.name}</span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setEditingSubject(s.id); setEditSubjectName(s.name); setEditSubjectColor(s.color) }}
                    className="shrink-0 h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors opacity-0 group-hover:opacity-100"
                    title="编辑学科"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); deleteSubject(s.id) }}
                    className="shrink-0 h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
                    title="删除学科"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </CardContent>
              </Card>
            )
          ))}
          {!focusMode && (
            <Card className="shrink-0">
              <CardContent className="!p-3 space-y-2">
                <Input value={newSubject} onChange={e => setNewSubject(e.target.value)}
                  placeholder="新学科名..." className="h-8 text-sm" />
                <div className="flex gap-2">
                  <input type="color" value={subjectColor} onChange={e => setSubjectColor(e.target.value)}
                    className="h-8 w-8 rounded border cursor-pointer" />
                  <Button size="sm" className="h-8 flex-1" onClick={createSubject}>创建学科</Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* 中间：章节树 + 思维导图 */}
        <Card className={`flex-1 min-w-0 flex flex-col min-h-0 ${focusMode ? '' : ''}`}>
          <CardHeader className="pb-2 shrink-0">
            <CardTitle className="text-base flex items-center gap-2">
              <FolderTree className="h-4 w-4" />
              {tree?.subject?.name || '章节'}
            </CardTitle>
            {!focusMode && <CardDescription>大纲 / 图谱 / 画布三视图</CardDescription>}
          </CardHeader>
          <CardContent className="flex flex-col flex-1 min-h-0 space-y-2 overflow-hidden">
            {selectedSubject && view === 'outline' && (
              <div className="flex gap-2 shrink-0">
                <Input value={newChapter} onChange={e => setNewChapter(e.target.value)}
                  placeholder="添加根章节..." className="h-8 text-sm"
                  onKeyDown={e => { if (e.key === 'Enter') createChapter(null) }} />
                <Button size="sm" className="h-8" onClick={() => createChapter(null)}>
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
            {tree?.chapters?.length > 0 ? (
              <MindMapContainer
                graphData={chapterTreeToGraph(tree.chapters)}
                view={view}
                onViewChange={setView}
                onNodeClick={(node: MindMapNode) => fetchChapter(node.originalId)}
                treeProps={{
                  nodes: tree.chapters,
                  getKey: (c: TreeNode) => c.id,
                  getChildren: (c: TreeNode) => c.children || [],
                  renderNode: renderChapterNode,
                  expanded,
                  onExpandedChange: setExpanded,
                  showConnector: true,
                }}
              />
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                {selectedSubject ? '还没有章节，添加一个' : '先选择一个学科'}
              </p>
            )}
          </CardContent>
        </Card>

        {/* 右侧：章节关联的宫殿 */}
        {!focusMode && (
          <div className="w-[280px] shrink-0 space-y-3 overflow-y-auto">
            {selectedChapter ? (
              <>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  {selectedChapter.chapter.breadcrumbs?.map((b: any, i: number) => (
                    <span key={b.id} className="flex items-center gap-1">
                      {i > 0 && <ChevronRight className="h-3 w-3" />}
                      <button onClick={() => fetchChapter(b.id)} className="hover:text-foreground">{b.name}</button>
                    </span>
                  ))}
                </div>
                <h2 className="font-semibold text-lg">{selectedChapter.chapter.name}</h2>

                {selectedChapter.palaces?.length > 0 ? (
                  selectedChapter.palaces.map((p: any) => (
                    <Link key={p.id} to={`/palaces/${p.id}/edit`}>
                      <Card className="hover:shadow-md transition-shadow cursor-pointer">
                        <CardContent className="!p-4 flex items-center justify-between">
                          <div className="min-w-0">
                            <div className="font-semibold text-sm truncate">{p.title || '未命名'}</div>
                            <div className="text-xs text-muted-foreground mt-1">
                              {'★'.repeat(p.difficulty)}{'☆'.repeat(5 - p.difficulty)} · {p.pegs?.length || 0} pegs
                            </div>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </CardContent>
                      </Card>
                    </Link>
                  ))
                ) : (
                  <Card>
                    <CardContent className="!p-8 text-center text-sm text-muted-foreground">
                      此章节还没有关联宫殿。<br />
                      <Link to="/palaces" className="text-primary hover:underline mt-1 inline-block">去宫殿列表关联</Link>
                    </CardContent>
                  </Card>
                )}
              </>
            ) : (
              <Card>
                <CardContent className="!p-12 flex flex-col items-center text-center text-sm text-muted-foreground">
                  <BookOpen className="h-10 w-10 mb-3 text-muted-foreground/30" />
                  选择一个章节查看关联的宫殿
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>

      {/* 右键菜单 */}
      {ctxMenu && (
        <NodeContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          actions={getContextActions(ctxMenu.node)}
        />
      )}
    </div>
  )
}
