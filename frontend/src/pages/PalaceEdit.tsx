import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { api } from '@/api/client'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { ArrowLeft, Plus, X, Upload, ChevronRight, ChevronDown, GripVertical } from 'lucide-react'
import { toast } from 'sonner'
import { TreeRenderer } from '@/components/mindmap/TreeRenderer'
import type { TreeRenderMeta } from '@/components/mindmap/TreeRenderer'

interface PegNode {
  id?: number; name: string; content: string; sort_order: number
  parent_id?: number | null; children: PegNode[]
}

function newPeg(): PegNode { return { name: '', content: '', sort_order: 0, children: [] } }

export default function PalaceEdit() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = !!id

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [difficulty, setDifficulty] = useState(3)
  const [reviewMode, setReviewMode] = useState('flashcard')
  const [pegs, setPegs] = useState<PegNode[]>([newPeg()])
  const [attachments, setAttachments] = useState<any[]>([])
  const [selectedChapters, setSelectedChapters] = useState<number[]>([])
  const [subjects, setSubjects] = useState<any[]>([])
  const [chapterTree, setChapterTree] = useState<any>(null)

  useEffect(() => {
    api.getSubjects().then(setSubjects)
    if (isEdit) {
      api.getPalace(Number(id)).then(p => {
        setTitle(p.title || '')
        setDescription(p.description || '')
        setDifficulty(p.difficulty || 3)
        setReviewMode(p.review_mode || 'flashcard')
        setPegs(p.pegs.length > 0 ? p.pegs.map((pg: any) => mapPeg(pg)) : [newPeg()])
        setAttachments(p.attachments || [])
        setSelectedChapters((p.chapters || []).map((c: any) => c.id))
      })
    }
  }, [id])

  const mapPeg = (p: any): PegNode => ({
    id: p.id, name: p.name, content: p.content, sort_order: p.sort_order,
    parent_id: p.parent_id, children: (p.children || []).map(mapPeg),
  })

  const flattenPegs = (nodes: PegNode[], parentId: number | null = null): any[] => {
    const result: any[] = []
    nodes.forEach((n, i) => {
      result.push({ id: n.id, name: n.name, content: n.content, sort_order: i, parent_id: parentId, children: [] })
      if (n.children.length > 0) {
        result.push(...flattenPegs(n.children, n.id))
      }
    })
    return result
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const flatPegs = flattenPegs(pegs.filter(p => p.name.trim() || p.content.trim()))
    const data = { title, description, difficulty, review_mode: reviewMode, pegs: flatPegs }
    if (isEdit) {
      await api.updatePalace(Number(id), data)
      await api.linkPalaceChapters(Number(id), selectedChapters)
      toast.success('Saved')
    } else {
      const p = await api.createPalace(data)
      if (selectedChapters.length > 0) await api.linkPalaceChapters(p.id, selectedChapters)
      toast.success('Created')
      navigate(`/palaces/${p.id}/edit`)
      return
    }
  }

  const addChild = (path: number[]) => {
    const newPegs = structuredClone(pegs)
    let node = newPegs
    for (let i = 0; i < path.length - 1; i++) node = node[path[i]].children
    node[path[path.length - 1]].children.push(newPeg())
    setPegs(newPegs)
  }

  const removePeg = (path: number[]) => {
    const newPegs = structuredClone(pegs)
    if (path.length === 1 && newPegs.length <= 1) return
    let node = newPegs
    for (let i = 0; i < path.length - 1; i++) node = node[path[i]].children
    node.splice(path[path.length - 1], 1)
    setPegs(newPegs)
  }

  const updatePeg = (path: number[], field: string, value: string) => {
    const newPegs = structuredClone(pegs)
    let node = newPegs
    for (let i = 0; i < path.length - 1; i++) node = node[path[i]].children
    ;(node[path[path.length - 1]] as any)[field] = value
    setPegs(newPegs)
  }

  const renderPegRow = (peg: PegNode, meta: TreeRenderMeta) => (
    <div className="flex gap-2 items-start" style={{ paddingLeft: meta.depth * 24 }}>
      <div className="flex items-center gap-1 pt-2 text-xs text-muted-foreground shrink-0 w-6">
        <GripVertical className="h-3 w-3" />
      </div>
      <Input value={peg.name} onChange={e => updatePeg(meta.path, 'name', e.target.value)}
        placeholder={meta.depth === 0 ? '桩名称' : '子桩名称'} className="flex-[2] h-9" />
      <Input value={peg.content} onChange={e => updatePeg(meta.path, 'content', e.target.value)}
        placeholder="关联记忆内容" className="flex-[3] h-9" />
      <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0"
        onClick={() => addChild(meta.path)}><Plus className="h-4 w-4" /></Button>
      <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0"
        onClick={() => removePeg(meta.path)}><X className="h-4 w-4" /></Button>
    </div>
  )

  const loadChapterTree = (sid: number) => api.getSubjectTree(sid).then(setChapterTree)
  const toggleChapter = (cid: number) => setSelectedChapters(p => p.includes(cid) ? p.filter(x => x !== cid) : [...p, cid])

  const renderChTreeNode = (n: any, meta: TreeRenderMeta) => (
    <button type="button" onClick={() => toggleChapter(n.id)}
      className={`flex items-center gap-2 w-full text-left rounded-md px-2 py-1 text-sm transition-colors
        ${selectedChapters.includes(n.id) ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-secondary'}`}
      style={{ paddingLeft: 8 + meta.depth * 16 }}>
      <span className={`h-3.5 w-3.5 rounded border flex items-center justify-center text-[10px] shrink-0
        ${selectedChapters.includes(n.id) ? 'bg-primary border-primary text-primary-foreground' : 'border-input'}`}>
        {selectedChapters.includes(n.id) ? '✓' : ''}
      </span>
      {n.name}
    </button>
  )

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file || !id) return
    await api.uploadAttachment(Number(id), file)
    const p = await api.getPalace(Number(id)); setAttachments(p.attachments || [])
    toast.success('Uploaded')
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-4">
        <Link to="/palaces" className="text-muted-foreground hover:text-foreground transition-colors"><ArrowLeft className="h-5 w-5" /></Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{isEdit ? 'Edit Palace' : 'New Palace'}</h1>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Basic Info</CardTitle>
            <CardDescription>Name, description, difficulty.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="t">Title</Label>
              <Input id="t" value={title} onChange={e => setTitle(e.target.value)} placeholder="Palace name..." />
            </div>
            <div className="space-y-2">
              <Label htmlFor="d">Description <span className="text-muted-foreground font-normal">(Markdown)</span></Label>
              <Textarea id="d" value={description} onChange={e => setDescription(e.target.value)} rows={5} placeholder="Describe your palace..." />
            </div>
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label>Difficulty</Label>
                <div className="flex items-center gap-3">
                  <input type="range" min={1} max={5} value={difficulty} onChange={e => setDifficulty(+e.target.value)} className="flex-1" />
                  <span className="text-sm font-medium tabular-nums w-16 text-right">{'★'.repeat(difficulty)}{'☆'.repeat(5 - difficulty)}</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Review Mode</Label>
                <div className="flex gap-2">
                  {[{ v: 'flashcard', l: 'Flashcard' }, { v: 'browse', l: 'Browse' }].map(({ v, l }) => (
                    <button key={v} type="button" onClick={() => setReviewMode(v)}
                      className={`flex-1 rounded-md border px-3 py-1.5 text-sm font-medium transition-all active:scale-95
                        ${reviewMode === v ? 'bg-primary text-primary-foreground border-primary shadow-sm' : 'bg-background hover:bg-secondary'}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Memory Pegs</CardTitle>
              <CardDescription>Add pegs with unlimited sub-pegs for hierarchical memory.</CardDescription>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setPegs([...pegs, newPeg()])}>
              <Plus className="h-4 w-4" /> Add Peg
            </Button>
          </CardHeader>
          <CardContent className="space-y-1">
            <TreeRenderer
              nodes={pegs}
              getKey={(_: PegNode, i: number) => `${i}`}
              getChildren={(p: PegNode) => p.children}
              renderNode={renderPegRow}
              indentPerLevel={24}
              baseIndent={0}
              alwaysExpanded
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Link Chapters</CardTitle>
            <CardDescription>Link this palace to your knowledge outline chapters.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2 flex-wrap">
              {subjects.map((s: any) => (
                <Button key={s.id} type="button" variant={chapterTree?.subject?.id === s.id ? 'default' : 'outline'} size="sm"
                  onClick={() => loadChapterTree(s.id)}>
                  <span className="h-2 w-2 rounded-full mr-1.5" style={{ background: s.color }} />{s.name}
                </Button>
              ))}
            </div>
            {chapterTree && (
              <div className="border rounded-lg p-3 max-h-64 overflow-y-auto space-y-0.5">
                {chapterTree.chapters?.length > 0 ? (
                  <TreeRenderer
                    nodes={chapterTree.chapters}
                    getKey={(n: any) => n.id}
                    getChildren={(n: any) => n.children || []}
                    renderNode={renderChTreeNode}
                    alwaysExpanded
                  />
                ) : <p className="text-sm text-muted-foreground text-center py-4">No chapters. <Link to="/knowledge" className="text-primary hover:underline">Create</Link></p>}
              </div>
            )}
            {selectedChapters.length > 0 && <p className="text-xs text-muted-foreground">{selectedChapters.length} chapters linked</p>}
          </CardContent>
        </Card>

        {isEdit && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Attachments</CardTitle>
              <CardDescription>Upload images or files.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {attachments.map((att: any) => (
                    <div key={att.id} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
                      <a href={`/api/attachments/${att.id}`} target="_blank" className="text-primary hover:underline max-w-[200px] truncate">{att.original_name}</a>
                      <button type="button" onClick={async () => { await api.deleteAttachment(att.id); setAttachments(a => a.filter(x => x.id !== att.id)) }}
                        className="text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></button>
                    </div>
                  ))}
                </div>
              )}
              <label className="cursor-pointer inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm hover:bg-secondary transition-colors">
                <Upload className="h-4 w-4" /> Choose File
                <input type="file" onChange={handleUpload} className="hidden" />
              </label>
            </CardContent>
          </Card>
        )}

        <div className="flex items-center gap-3">
          <Button type="submit">{isEdit ? 'Save' : 'Create Palace'}</Button>
          <Link to="/palaces"><Button type="button" variant="outline">Cancel</Button></Link>
        </div>
      </form>
    </div>
  )
}
