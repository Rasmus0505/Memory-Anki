import { useEffect, useRef, useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import Image from '@tiptap/extension-image'
import Mathematics from '@tiptap/extension-mathematics'
import Highlight from '@tiptap/extension-highlight'
import type { JSONContent } from '@tiptap/react'
import type { EditorView } from '@tiptap/pm/view'
import { resolveArticleStructureInput, type ArticleStructureRequest } from '@/modules/content/domain/mindmap-document-entity/model/articleStructureInput'
export type { ArticleStructureRequest } from '@/modules/content/domain/mindmap-document-entity/model/articleStructureInput'
import 'katex/dist/katex.min.css'
import './article.css'

export interface ArticleRichEditorProps {
  content: JSONContent
  editable: boolean
  label: string
  onChange: (content: JSONContent) => void
  onFocus?: () => void
  onStructure?: (request: ArticleStructureRequest) => void
  uploadImage?: (file: File) => Promise<{ src: string; alt?: string }>
  /** Stable document owner + block UID; mandatory when uploads are enabled. */
  uploadOwnerKey?: string
}

/** The mounted editor owns composition and selection; controlled echoes never reset its document. */
export function ArticleRichEditor({ content, editable, label, onChange, onFocus, onStructure, uploadImage, uploadOwnerKey }: ArticleRichEditorProps) {
  const [insert, setInsert] = useState<'image' | 'math' | 'link' | null>(null)
  const [value, setValue] = useState('')
  const [caption, setCaption] = useState('')
  const [inputError, setInputError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const uploadOperation = useRef(0)
  const mounted = useRef(true)
  const ownerKey = useRef(uploadOwnerKey)
  ownerKey.current = uploadOwnerKey
  const uploadHandler = useRef<(file: File) => void>(() => {})
  const callbacks = useRef({ onChange, onFocus, onStructure, uploadImage })
  callbacks.current = { onChange, onFocus, onStructure, uploadImage }
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; uploadOperation.current += 1 }
  }, [])
  useEffect(() => {
    uploadOperation.current += 1
    setUploading(false)
    setUploadError('')
  }, [uploadOwnerKey, editable])
  const requestStructure = (view: EditorView, text: string, composing = false, modified = false) => {
    if (!callbacks.current.onStructure || !view.editable) return false
    const { selection } = view.state
    const { $from } = selection
    const request = resolveArticleStructureInput({
      paragraphText: $from.parent.textContent,
      offset: $from.parentOffset,
      topLevelParagraph: $from.depth === 1 && $from.parent.type.name === 'paragraph',
      collapsed: selection.empty,
      composing: composing || view.composing,
      modified,
      insertedText: text,
    })
    if (!request) return false
    // Publish only removal of the marker before asking the host to insert a node.
    // The surrounding body and all imported list structure stay untouched.
    view.dispatch(view.state.tr.delete($from.start(), $from.end()))
    callbacks.current.onStructure(request)
    return true
  }
  const editor = useEditor({
    enableInputRules: onStructure ? ['bold', 'italic', 'strike', 'code', 'blockquote', 'codeBlock', 'horizontalRule', 'highlight'] : true,
    extensions: [
      StarterKit.configure({ undoRedo: false, heading: false, link: { openOnClick: false } }),
      TableKit.configure({ table: { resizable: true } }),
      Image.configure({ allowBase64: false }),
      Mathematics.configure({ katexOptions: { throwOnError: false, trust: false } }),
      Highlight,
    ],
    content,
    editable,
    editorProps: {
      attributes: { class: 'article-rich-content', 'aria-label': label, role: 'textbox', 'aria-multiline': 'true' },
      handleKeyDown: (view, event) => {
        if (event.key !== ' ') return false
        const handled = requestStructure(view, ' ', event.isComposing || event.keyCode === 229, event.ctrlKey || event.metaKey || event.altKey)
        if (handled) event.preventDefault()
        return handled
      },
      handleTextInput: (view, from, to, text) => from === to && requestStructure(view, text),
      handlePaste: (view, event) => {
        if (!view.editable || !callbacks.current.uploadImage || !ownerKey.current) return false
        const file = Array.from(event.clipboardData?.files ?? []).find((candidate) => candidate.type.startsWith('image/'))
        if (!file) return false
        event.preventDefault()
        uploadHandler.current(file)
        return true
      },
    },
    onUpdate: ({ editor: current }) => callbacks.current.onChange(current.getJSON()),
    onFocus: () => callbacks.current.onFocus?.(),
  })
  useEffect(() => { editor?.setEditable(editable, false) }, [editable, editor])
  useEffect(() => {
    if (editor && JSON.stringify(editor.getJSON()) !== JSON.stringify(content)) {
      editor.commands.setContent(content, { emitUpdate: false })
    }
  }, [content, editor])
  uploadHandler.current = (file) => {
    const upload = callbacks.current.uploadImage
    const owner = ownerKey.current
    if (!upload || !owner || !editor?.isEditable || editor.isDestroyed) return
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type) || file.size <= 0 || file.size > 20 * 1024 * 1024) {
      setUploadError('请选择 20MB 以内的 PNG、JPEG、GIF 或 WebP 图片（不支持 SVG）。')
      return
    }
    const operation = ++uploadOperation.current
    const currentEditor = editor
    const isCurrent = () => mounted.current && uploadOperation.current === operation && ownerKey.current === owner && !currentEditor.isDestroyed && currentEditor.isEditable
    setUploading(true)
    setUploadError('')
    void (async () => {
      try {
        const result = await upload(file)
        if (!isCurrent()) return
        if (!/^(https?:\/\/|\/(?!\/)|assets\/[a-zA-Z0-9][a-zA-Z0-9._-]*$)/.test(result.src) || result.src.includes('\\') || Array.from(result.src).some((char) => char.charCodeAt(0) <= 32)) throw new Error('上传返回的图片地址无效。')
        currentEditor.chain().focus().setImage({ src: result.src, alt: result.alt ?? file.name }).run()
        setInsert(null)
      } catch (error) {
        if (isCurrent()) setUploadError(error instanceof Error ? error.message : '图片上传失败，请重试。')
      } finally {
        if (mounted.current && uploadOperation.current === operation && ownerKey.current === owner) setUploading(false)
      }
    })()
  }
  if (!editor) return null
  const action = (name: string, execute: () => void, active = false) => (
    <button type="button" key={name} aria-pressed={active} onMouseDown={(event) => event.preventDefault()} onClick={execute}>{name}</button>
  )
  return <div className="article-rich-editor">
    {editable && <div className="article-format-bar" role="toolbar" aria-label="正文格式">
      {onStructure && action('新知识点', () => onStructure({ kind: 'heading', placement: 'sibling' }))}
      {onStructure && action('子知识点', () => onStructure({ kind: 'heading', placement: 'child' }))}
      {action('粗体', () => { editor.chain().focus().toggleBold().run() }, editor.isActive('bold'))}
      {action('斜体', () => { editor.chain().focus().toggleItalic().run() }, editor.isActive('italic'))}
      {action('重点', () => { editor.chain().focus().toggleHighlight().run() }, editor.isActive('highlight'))}
      {action('引用', () => { editor.chain().focus().toggleBlockquote().run() }, editor.isActive('blockquote'))}
      {action('代码块', () => { editor.chain().focus().toggleCodeBlock().run() }, editor.isActive('codeBlock'))}
      {action('表格', () => { editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() })}
      {(['image', 'math', 'link'] as const).map((kind) => action({ image: '图片', math: '公式', link: '链接' }[kind], () => {
        setInsert(kind); setInputError(''); setCaption('')
        setValue(kind === 'math' ? String(editor.getAttributes('inlineMath').latex ?? editor.getAttributes('blockMath').latex ?? '') : kind === 'image' ? String(editor.getAttributes('image').src ?? '') : String(editor.getAttributes('link').href ?? ''))
      }))}
      {editor.isActive('table') && <>
        {action('增加行', () => { editor.chain().focus().addRowAfter().run() })}
        {action('增加列', () => { editor.chain().focus().addColumnAfter().run() })}
        {action('删除行', () => { editor.chain().focus().deleteRow().run() })}
        {action('删除列', () => { editor.chain().focus().deleteColumn().run() })}
        {action('删除表格', () => { editor.chain().focus().deleteTable().run() })}
      </>}
    </div>}
    {uploading && <p role="status" className="text-sm text-muted-foreground">正在上传图片…</p>}
    {uploadError && <p role="alert" className="text-sm text-destructive">{uploadError}</p>}
    <EditorContent editor={editor} />
    <Dialog open={insert !== null} onOpenChange={(open) => { if (!open) setInsert(null) }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{insert === 'math' ? '编辑公式' : insert === 'image' ? '插入图片' : '编辑链接'}</DialogTitle>
          <DialogDescription>{insert === 'math' ? '输入 LaTeX，公式将在正文中渲染。' : '填写资源地址，确认后插入当前光标位置。'}</DialogDescription></DialogHeader>
        <Input aria-label={insert === 'math' ? 'LaTeX 公式' : '资源地址'} value={value} onChange={(event) => setValue(event.target.value)} />
        {insert === 'image' && uploadImage && uploadOwnerKey && <label className="grid gap-1 text-sm">上传本地图片<Input type="file" aria-label="上传本地图片" accept="image/png,image/jpeg,image/gif,image/webp" disabled={uploading} onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) uploadHandler.current(file)
        }} /><span className="text-xs text-muted-foreground">PNG / JPEG / GIF / WebP，最大 20MB；也可直接粘贴图片。</span></label>}
        {insert === 'image' && <Input aria-label="图片说明" placeholder="图片说明" value={caption} onChange={(event) => setCaption(event.target.value)} />}
        {inputError && <p role="alert" className="text-sm text-destructive">{inputError}</p>}
        <Button onClick={() => {
          const trimmed = value.trim()
          if (!trimmed || (insert !== 'math' && !/^(https?:\/\/|\/(?!\/))/.test(trimmed))) { setInputError('请填写有效内容；资源地址需为 HTTP(S) 或站内路径。'); return }
          if (insert === 'math') {
            if (editor.isActive('inlineMath')) editor.chain().focus().updateAttributes('inlineMath', { latex: trimmed }).run()
            else if (editor.isActive('blockMath')) editor.chain().focus().updateAttributes('blockMath', { latex: trimmed }).run()
            else editor.chain().focus().insertContent({ type: 'blockMath', attrs: { latex: trimmed } }).run()
          } else if (insert === 'image') editor.chain().focus().setImage({ src: trimmed, alt: caption }).run()
          else editor.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run()
          setInsert(null)
        }}>确认</Button>
      </DialogContent>
    </Dialog>
  </div>
}
