import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useArticleScrollPosition } from './useArticleScrollPosition'
import { useArticleImageUpload } from './useArticleImageUpload'
import { useArticleReadingProgress } from './useArticleReadingProgress'
import type { ArticleReadingOwnerId } from '@/shared/api/contracts/articleReading'
import type { MindMapEditorState } from '@/shared/api/contracts'
import type { EditorDocGraphOptions } from '../documentGraphProjection'
import type { MindMapEditorSurfaceProps } from '../MindMapEditorSurface.types'
import type { ContextMenuAction } from '@/shared/ui/mindmap-canvas/NodeContextMenu'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { canAddMindMapBranchChild, canMutateMindMapBranchStructure, collectMindMapBranchScope, editMindMapNode, moveMindMapNode } from '@/modules/content/domain/mindmap-document-entity'
import { addMindMapArticleNode, articleBodyToPlainText, indentMindMapArticleNode, outdentMindMapArticleNode, projectMindMapArticle, updateMindMapArticleBody } from '@/modules/content/domain/mindmap-document-entity/model/articleDocument'
import type { ArticleStructureRequest } from './ArticleRichEditor'
import type { ArticleBlock } from '@/modules/content/domain/mindmap-document-entity/model/articleDocument'
import { ArticleRichEditor } from './ArticleRichEditor'
import { RichDocument } from '@/shared/ui/rich-document/RichDocument'
import { hasHighlightMarkup, sanitizeMindMapRichHtml, serializeContentEditable } from '@/shared/lib/mindmapRichText'
import './article.css'

type EditorDoc = MindMapEditorState['editor_doc']
export interface ArticleWorkspaceProps {
  active?: boolean
  focusRequestUid?: string | null
  focusRequestNonce?: number
  ownerId?: ArticleReadingOwnerId | null
  document: EditorDoc
  canEdit: boolean
  scopeBranchUid: string | null
  selectedUid: string | null
  toolbar: ReactNode
  fullscreen?: boolean
  onToggleFullscreen?: () => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  getDocument: () => EditorDoc
  onCommit: (document: EditorDoc) => void
  onSelect: (uid: string) => void
  onActivate?: (uid: string) => void
  onLocate: (uid: string) => void
  onDelete: (uid: string) => void
  buildActions: (uid: string) => ContextMenuAction[]
  onCountBadgeClick?: (uid: string) => void
  countByUid?: Record<string, number>
  revealMap?: Record<string, 'hidden' | 'placeholder' | 'revealed'>
  onReveal?: (uid: string) => void
  decorations?: EditorDocGraphOptions
  selectionActions?: MindMapEditorSurfaceProps['buildSelectionToolbarActions']
}

function readingBodyVisible(body: unknown) {
  if (articleBodyToPlainText(body).trim()) return true
  try { return /"type":"(?:image|table|horizontalRule|blockMath|inlineMath)"/.test(JSON.stringify(body)) } catch { return false }
}

function ArticleTitle({ block, editable, onChange, onSelect, onEnter }: { block: ArticleBlock; editable: boolean; onChange: (text: string) => void; onSelect: () => void; onEnter: () => void }) {
  const element = useRef<HTMLDivElement>(null)
  // Controlled echoes leave the caret alone; history navigation replaces its value.
  useLayoutEffect(() => {
    if (!element.current) return
    const current = serializeContentEditable(element.current)
    if (current === block.storedText) return
    if (hasHighlightMarkup(block.storedText)) element.current.innerHTML = sanitizeMindMapRichHtml(block.storedText)
    else element.current.textContent = block.text
  }, [block.storedText, block.text])
  return <div ref={element} className="article-section-title" data-kind={block.kind} data-depth={Math.min(block.depth, 6)}
    contentEditable={editable} suppressContentEditableWarning role={editable ? 'textbox' : 'heading'}
    aria-level={editable ? undefined : Math.min(block.depth + 1, 6)} aria-label={editable ? '知识点标题' : undefined}
    onFocus={onSelect} onInput={(event) => { if (editable && !(event.nativeEvent as InputEvent).isComposing) onChange(serializeContentEditable(event.currentTarget)) }}
    onCompositionEnd={(event) => { if (editable) onChange(serializeContentEditable(event.currentTarget)) }}
    onBlur={(event) => { if (editable) onChange(serializeContentEditable(event.currentTarget)) }}
    onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); onChange(serializeContentEditable(event.currentTarget)); onEnter() } }}
  />
}

export function ArticleWorkspace(props: ArticleWorkspaceProps) {
  const { document, canEdit, scopeBranchUid, selectedUid, getDocument, onCommit, onSelect } = props
  const progress = useArticleReadingProgress(props.ownerId ?? null)
  const uploadImage = useArticleImageUpload(props.ownerId ?? null)
  const [editing, setEditing] = useState(false)
  const [outline, setOutline] = useState(false)
  const [query, setQuery] = useState('')
  const [recall, setRecall] = useState(false)
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set())
  const [fontSize, setFontSize] = useState(16)
  const scrollRef = useRef<HTMLDivElement>(null)
  const blocks = useMemo(() => projectMindMapArticle(document, scopeBranchUid ?? undefined), [document, scopeBranchUid])
  const scope = useMemo(() => scopeBranchUid ? collectMindMapBranchScope(document, scopeBranchUid) : null, [document, scopeBranchUid])
  const articleScroll = useArticleScrollPosition({ active: props.active ?? true, rootRef: scrollRef,
    ownerId: props.ownerId ?? null, selectedUid, recordProgress: progress.recordProgress, onSelect,
  })
  const explicitFocus = props.focusRequestUid
  const focusNonce = props.focusRequestNonce
  const navigateArticle = articleScroll.navigateTo
  useEffect(() => { if (props.active && explicitFocus) navigateArticle(explicitFocus) }, [props.active, explicitFocus, focusNonce, navigateArticle])
  const editable = canEdit && editing
  const concealed = (uid: string) => props.revealMap?.[uid] === 'hidden' || props.revealMap?.[uid] === 'placeholder'
  const matching = blocks.filter((block) => !concealed(block.uid) && `${block.text}\n${articleBodyToPlainText(block.body)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const locate = (uid: string) => articleScroll.navigateTo(uid)
  const add = (uid: string, placement: 'child' | 'sibling', request?: ArticleStructureRequest) => {
    const result = addMindMapArticleNode(getDocument(), uid, placement, scopeBranchUid ?? undefined)
    if (result.nodeUid && request) {
      const created = projectMindMapArticle(result.document).find((block) => block.uid === result.nodeUid)
      if (created) {
        const next = updateMindMapArticleBody(result.document, result.nodeUid, created.body, request.kind)
        result.document = request.text ? editMindMapNode(next, result.nodeUid, request.text) : next
      }
    }
    onCommit(result.document)
    if (result.nodeUid) locate(result.nodeUid)
  }
  return <div className="article-workspace" data-testid="article-workspace">
    <div className="article-workspace-header">
      {props.toolbar}
      {props.onToggleFullscreen && <Button size="sm" variant="outline" title={props.fullscreen ? '退出全屏' : '进入全屏'} onClick={props.onToggleFullscreen}>{props.fullscreen ? '退出全屏' : '进入全屏'}</Button>}
      {progress.resumeCursor && blocks.some((block) => block.uid === progress.resumeCursor?.node_uid) && <Button size="sm" variant="outline" onClick={() => articleScroll.navigateTo(progress.resumeCursor!.node_uid, progress.resumeCursor!.block_offset ?? 0)}>接续阅读</Button>}
      {progress.error && <span role="status" className="text-xs text-muted-foreground" title={progress.error}>进度暂存于本设备</span>}
      <Button size="sm" variant="outline" onClick={() => setOutline(!outline)} aria-pressed={outline}>目录</Button>
      {canEdit && <Button size="sm" variant={editable ? 'default' : 'outline'} onClick={() => setEditing(!editing)}>{editable ? '完成编辑' : '编辑文章'}</Button>}
      <Button size="sm" variant="outline" onClick={() => setRecall(!recall)} aria-pressed={recall}>主动回忆</Button>
      <Button size="sm" variant="ghost" onClick={() => setFontSize((size) => size === 20 ? 16 : size + 2)}>字号 {fontSize}</Button>
      {canEdit && <><Button size="sm" variant="ghost" disabled={!props.canUndo} onClick={props.onUndo}>撤销</Button><Button size="sm" variant="ghost" disabled={!props.canRedo} onClick={props.onRedo}>重做</Button></>}
    </div>
    <div className="article-workspace-body">
      {outline && <nav className="article-outline" aria-label="文章目录">
        <Input aria-label="搜索文章" placeholder="搜索标题和正文" value={query} onChange={(event) => setQuery(event.target.value)} />
        <p className="my-2 text-xs text-muted-foreground">{query ? `${matching.length} 处匹配` : `${blocks.length} 个知识点`}</p>
        {matching.map((block) => <button key={block.uid} type="button" onClick={() => locate(block.uid)} style={{ paddingLeft: `${Math.min(block.depth, 3) * 8 + 4}px` }}>{block.text || '未命名知识点'}</button>)}
      </nav>}
      <div ref={scrollRef} className="article-scroll" onKeyDown={(event) => {
        if (!canEdit || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return
        event.preventDefault()
        if (event.shiftKey) props.onRedo(); else props.onUndo()
      }}>
        <article className="article-paper" style={{ fontSize }}>
          {blocks.map((block) => {
            const active = selectedUid === block.uid
            const hostHidden = props.revealMap?.[block.uid] === 'hidden' || props.revealMap?.[block.uid] === 'placeholder'
            const hidden = hostHidden || (recall && !editable && !revealed.has(block.uid))
            const mutable = block.parentUid !== null && canMutateMindMapBranchStructure(scope, block.uid)
            const depth = Math.min(block.depth, 6)
            return <section key={block.uid} className="article-section" data-article-uid={block.uid} data-depth={depth} data-active={active} style={{ ['--article-depth' as string]: depth }} onClick={(event) => { if ((event.target as HTMLElement).closest('button,a,input,[contenteditable]')) return; onSelect(block.uid); if (!editable && !hostHidden) props.onActivate?.(block.uid) }}>
              {hostHidden ? <div className="article-section-title" role="heading" aria-level={Math.min(block.depth + 1, 6)}>待回忆</div> : <ArticleTitle block={block} editable={editable} onSelect={() => onSelect(block.uid)} onEnter={() => add(block.uid, mutable ? 'sibling' : 'child')} onChange={(text) => {
                if (text !== block.storedText) onCommit(editMindMapNode(getDocument(), block.uid, text))
              }} />}
              {hidden ? <button type="button" className="my-3 w-full rounded-lg border border-dashed p-4 text-sm text-muted-foreground" onClick={() => { if (hostHidden) props.onReveal?.(block.uid); else setRevealed((current) => new Set([...current, block.uid])) }}>回忆这个知识点，然后点击揭晓</button> : editable && active ? <ArticleRichEditor content={block.body} editable uploadImage={uploadImage} uploadOwnerKey={`${props.ownerId ?? 'unscoped'}:${block.uid}`} onStructure={(request) => add(block.uid, request.placement === 'sibling' && !mutable ? 'child' : request.placement, request)} label={`${block.text}的正文`} onFocus={() => onSelect(block.uid)} onChange={(body) => onCommit(updateMindMapArticleBody(getDocument(), block.uid, body))} /> : readingBodyVisible(block.body) ? <RichDocument document={block.body} className="article-rich-content" /> : null}
              {!hostHidden && <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                {(props.decorations?.statusChipsByNodeUid?.[block.uid] ?? []).map((chip, index) => <span key={index} className="rounded border px-1.5 py-0.5">{chip.text}</span>)}
                {props.decorations?.masteryByNodeUid?.[block.uid]?.manualLabel && <span>{props.decorations.masteryByNodeUid[block.uid]?.manualLabel}</span>}
              </div>}
              {active && <div className="article-section-tools">
                  <button type="button" onClick={() => props.onLocate(block.uid)}>定位导图</button>
                  {(props.countByUid?.[block.uid] ?? 0) > 0 && <button type="button" onClick={() => props.onCountBadgeClick?.(block.uid)}>关联题目 · {props.countByUid?.[block.uid]}</button>}
                  {(props.selectionActions?.(block.uid) ?? []).map((action) => <button key={action.id} type="button" disabled={action.disabled} onClick={action.onClick}>{action.label}</button>)}
                  {props.buildActions(block.uid).map((action, index) => <button key={`${action.label}-${index}`} type="button" disabled={action.disabled} onClick={action.onClick}>{action.label}</button>)}
                  {editable && <>
                    <button type="button" onClick={() => onCommit(updateMindMapArticleBody(getDocument(), block.uid, block.body, block.kind === 'heading' ? 'list' : 'heading'))}>{block.kind === 'heading' ? '转为列表项' : '转为标题'}</button>
                    <button type="button" disabled={!canAddMindMapBranchChild(scope, block.uid)} onClick={() => add(block.uid, 'child')}>新增下级</button>
                    <button type="button" disabled={!mutable} onClick={() => add(block.uid, 'sibling')}>新增同级</button>
                    <button type="button" disabled={!mutable} onClick={() => onCommit(indentMindMapArticleNode(getDocument(), block.uid, scopeBranchUid ?? undefined))}>降低层级</button>
                    <button type="button" disabled={!mutable} onClick={() => onCommit(outdentMindMapArticleNode(getDocument(), block.uid, scopeBranchUid ?? undefined))}>提升层级</button>
                    <button type="button" disabled={!mutable} onClick={() => onCommit(moveMindMapNode(getDocument(), block.uid, 'up'))}>上移章节</button>
                    <button type="button" disabled={!mutable} onClick={() => onCommit(moveMindMapNode(getDocument(), block.uid, 'down'))}>下移章节</button>
                    <button type="button" disabled={!mutable} onClick={() => props.onDelete(block.uid)}>删除章节</button>
                  </>}
              </div>}
            </section>
          })}
        </article>
      </div>
    </div>
  </div>
}
