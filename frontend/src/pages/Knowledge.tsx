import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/api/client'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { BookOpen, ChevronRight, ChevronDown, Plus, Pencil, Trash2, FolderTree, ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { MindMapContainer, chapterTreeToGraph } from '@/components/mindmap'
import type { TreeRenderMeta, MindMapNode } from '@/components/mindmap'

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
  const [editingChapter, setEditingChapter] = useState<any>(null)
  const [subjectColor, setSubjectColor] = useState('#6366f1')

  const fetchSubjects = () => api.getSubjects().then(setSubjects)
  useEffect(() => { fetchSubjects() }, [])

  const fetchTree = async (sid: number) => {
    setSelectedSubject(sid)
    setSelectedChapter(null)
    const data = await api.getSubjectTree(sid)
    setTree(data)
    const s = new Set<number>()
    data.chapters?.forEach((c: TreeNode) => s.add(c.id))
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

  const createChapter = async (parentId: number | null = null) => {
    if (!selectedSubject || !newChapter.trim()) return
    await api.createChapter(selectedSubject, { name: newChapter, parent_id: parentId })
    toast.success('章节已添加')
    setNewChapter('')
    fetchTree(selectedSubject)
  }

  const deleteChapter = async (id: number) => {
    await api.deleteChapter(id)
    toast.success('已删除')
    fetchTree(selectedSubject!)
    setSelectedChapter(null)
  }

  const renderChapterNode = (node: TreeNode, meta: TreeRenderMeta) => (
    <div>
      <div className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors group
        ${selectedChapter?.chapter?.id === node.id ? 'bg-primary/10 text-primary' : 'hover:bg-secondary'}`}
        style={{ paddingLeft: `${12 + meta.depth * 20}px` }}>
        {meta.hasChildren ? (
          <button onClick={meta.toggleExpand} className="text-muted-foreground">
            {meta.isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : <span className="w-3.5" />}
        <button onClick={() => fetchChapter(node.id)} className="flex-1 text-left truncate">
          {node.name}
        </button>
        {node.palace_count > 0 && (
          <Badge variant="secondary" className="text-[10px] px-1.5">{node.palace_count}</Badge>
        )}
        <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100"
          onClick={() => { setNewChapter(''); setEditingChapter(node) }}>
          <Plus className="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100"
          onClick={() => deleteChapter(node.id)}>
          <Trash2 className="h-3 w-3 text-destructive" />
        </Button>
      </div>
      {editingChapter?.id === node.id && (
        <div className="flex gap-1 mt-1" style={{ paddingLeft: `${32 + meta.depth * 20}px` }}>
          <Input value={newChapter} onChange={e => setNewChapter(e.target.value)}
            placeholder="子章节名..." className="h-7 text-xs" autoFocus
            onKeyDown={e => { if (e.key === 'Enter') { createChapter(node.id); setEditingChapter(null) } }} />
          <Button size="sm" className="h-7 text-xs" onClick={() => { createChapter(node.id); setEditingChapter(null) }}>添加</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingChapter(null)}>取消</Button>
        </div>
      )}
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">知识大纲</h1>
          <p className="text-sm text-muted-foreground mt-1">建立学科章节体系，双向关联记忆宫殿。</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr_1fr] gap-6">
        {/* 左侧：学科列表 */}
        <div className="space-y-3">
          {subjects.map(s => (
            <Card key={s.id}
              className={`cursor-pointer transition-colors ${selectedSubject === s.id ? 'ring-2 ring-primary' : 'hover:shadow-md'}`}
              onClick={() => fetchTree(s.id)}>
              <CardContent className="!p-4 flex items-center gap-3">
                <div className="h-3 w-3 rounded-full shrink-0" style={{ background: s.color }} />
                <span className="font-medium text-sm truncate">{s.name}</span>
              </CardContent>
            </Card>
          ))}
          <Card>
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
        </div>

        {/* 中间：章节树 + 思维导图 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FolderTree className="h-4 w-4" />
              {tree?.subject?.name || '章节'}
            </CardTitle>
            <CardDescription>大纲 / 图谱 / 画布三视图</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {selectedSubject && (
              <div className="flex gap-2">
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
                onNodeClick={(node: MindMapNode) => fetchChapter(node.originalId)}
                treeProps={{
                  nodes: tree.chapters,
                  getKey: (c: TreeNode) => c.id,
                  getChildren: (c: TreeNode) => c.children || [],
                  renderNode: renderChapterNode,
                  expanded,
                  onExpandedChange: setExpanded,
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
        <div className="space-y-3">
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
      </div>
    </div>
  )
}
