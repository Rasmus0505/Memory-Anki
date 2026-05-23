import { ArrowLeft, Check, Clock, Copy, ImagePlus, LoaderCircle, Sparkles, Trash2, Type } from 'lucide-react'
import { useEffect, useState, type ChangeEvent, type ClipboardEvent } from 'react'
import type { MindMapImportSourceNode, MindMapImportSourceTree } from '@/shared/api/contracts'
import type { ImportHistoryItem } from '@/features/palace-edit/model/mindmap-import'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { cn } from '@/shared/lib/utils'

interface PalaceMindMapImportDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'mindmap' | 'text'
  onModeChange: (mode: 'mindmap' | 'text') => void
  loading: boolean
  applying: boolean
  undoing: boolean
  error: string
  sourceTree: MindMapImportSourceTree | null
  extractedText: string
  imagePreviewUrl: string
  targetNodeLabel: string
  canAppend: boolean
  canUndoLastImport: boolean
  history: ImportHistoryItem[]
  onPaste: (event: ClipboardEvent<HTMLDivElement>) => void
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void
  onApplyReplace: () => void
  onApplyAppend: () => void
  onUndoLastImport: () => void
  onSelectHistory: (item: ImportHistoryItem) => void
  onDeleteHistory: (id: string) => void
  className?: string
  overlayClassName?: string
}

function SourceTreeNode({
  node,
  depth = 0,
}: {
  node: MindMapImportSourceNode
  depth?: number
}) {
  return (
    <div className="space-y-2">
      <div
        className="rounded-xl border border-border/70 bg-background/70 px-3 py-2 text-sm"
        style={{ marginLeft: depth * 14 }}
      >
        {node.text}
      </div>
      {node.children?.length ? (
        <div className="space-y-2">
          {node.children.map((child, index) => (
            <SourceTreeNode key={`${child.text}-${index}`} node={child} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function PalaceMindMapImportDrawer({
  open,
  onOpenChange,
  mode,
  onModeChange,
  loading,
  applying,
  undoing,
  error,
  sourceTree,
  extractedText,
  imagePreviewUrl,
  targetNodeLabel,
  canAppend,
  canUndoLastImport,
  history,
  onPaste,
  onFileChange,
  onApplyReplace,
  onApplyAppend,
  onUndoLastImport,
  onSelectHistory,
  onDeleteHistory,
  className,
  overlayClassName,
}: PalaceMindMapImportDrawerProps) {
  const nodeCount = sourceTree ? countNodes(sourceTree.children) : 0
  const [view, setView] = useState<'import' | 'history'>('import')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (open) {
      setView('import')
    }
  }, [open])

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1400)
    return () => window.clearTimeout(timer)
  }, [copied])

  const handleCopyText = async () => {
    if (!extractedText) return
    await navigator.clipboard.writeText(extractedText)
    setCopied(true)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={false} className={overlayClassName}>
      <DialogContent
        className={cn(
          'ml-auto mr-0 h-[calc(100vh-32px)] max-w-[560px] rounded-none rounded-l-3xl border-l bg-card/98 p-0 shadow-[0_24px_80px_rgba(15,23,42,0.28)]',
          className,
        )}
      >
        <DialogHeader>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {view === 'history' ? (
                  <Button variant="ghost" size="sm" onClick={() => setView('import')}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    返回导入
                  </Button>
                ) : (
                  <>
                    <DialogTitle>{mode === 'mindmap' ? '图片转脑图' : '图片转文字'}</DialogTitle>
                    <Badge variant="secondary">Qwen3-VL-Flash</Badge>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="inline-flex rounded-xl border border-border/70 bg-background/70 p-1">
                  <button
                    type="button"
                    className={cn(
                      'inline-flex items-center rounded-lg px-3 py-1.5 text-sm transition-colors',
                      mode === 'mindmap'
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                    onClick={() => onModeChange('mindmap')}
                  >
                    <Sparkles className="mr-2 h-4 w-4" />
                    转脑图
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'inline-flex items-center rounded-lg px-3 py-1.5 text-sm transition-colors',
                      mode === 'text'
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                    onClick={() => onModeChange('text')}
                  >
                    <Type className="mr-2 h-4 w-4" />
                    转文字
                  </button>
                </div>
                {mode === 'mindmap' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setView((current) => (current === 'history' ? 'import' : 'history'))}
                  >
                    <Clock className="mr-2 h-4 w-4" />
                    历史记录
                  </Button>
                ) : null}
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              {view === 'history'
                ? '这里集中查看、恢复和删除这次页面范围内的图片转脑图历史草稿。'
                : mode === 'mindmap'
                  ? '粘贴一张结构图，先生成脑图草稿，再决定覆盖当前宫殿或追加到选中节点。'
                  : '识别出的文字会一直保留在右侧，方便你回到导图里多次复制、分段粘贴，不会因为复制操作自动关闭。'}
            </p>
          </div>
          <DialogClose onClick={() => onOpenChange(false)} />
        </DialogHeader>

        <div
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
          onPaste={onPaste}
          tabIndex={0}
        >
          {view === 'history' ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="border-b px-6 py-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Clock className="h-4 w-4" />
                  转脑图历史记录
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  共 {history.length} 条。点击一条会回到导入页并载入这份草稿。
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                {history.length > 0 ? (
                  <div className="space-y-2">
                    {history.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <button
                            type="button"
                            className="min-w-0 flex-1 text-left"
                            onClick={() => {
                              onSelectHistory(item)
                              setView('import')
                            }}
                          >
                            <div className="truncate text-sm font-medium">{item.title || '未命名'}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {item.nodeCount} 节点
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {new Date(item.createdAt).toLocaleString()}
                            </div>
                          </button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => onDeleteHistory(item.id)}
                            title="删除此记录"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex h-full min-h-[260px] items-center justify-center rounded-2xl border border-dashed border-border/80 bg-background/60 text-sm text-muted-foreground">
                    还没有历史记录。先识别一张图片，历史会自动保存在这里。
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
          <div className="border-b px-6 py-4">
            <div className="grid gap-3">
              <label className="flex cursor-pointer items-center justify-center rounded-2xl border border-dashed border-border/80 bg-background/70 px-4 py-5 text-sm text-muted-foreground transition-colors hover:text-foreground">
                <ImagePlus className="mr-2 h-4 w-4" />
                选择图片或直接在这里粘贴
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onFileChange}
                />
              </label>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {loading ? (
                  <>
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                    {mode === 'mindmap' ? '正在识别图片结构并生成脑图草稿…' : '正在提取图片文字…'}
                  </>
                ) : sourceTree ? (
                  <>
                    <Sparkles className="h-3.5 w-3.5" />
                    已生成草稿，共 {nodeCount} 个节点
                  </>
                ) : extractedText ? (
                  <>
                    <Type className="h-3.5 w-3.5" />
                    已提取文字，可直接多次复制后回到导图粘贴
                  </>
                ) : (
                  '支持教材结构图、手写整理图、打印版脑图截图。'
                )}
              </div>
              {error ? (
                <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              ) : null}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="grid gap-5">
              <section className="space-y-3">
                <div className="text-sm font-medium">原图预览</div>
                <div className="overflow-hidden rounded-2xl border border-border/70 bg-background/70">
                  {imagePreviewUrl ? (
                    <img
                      src={imagePreviewUrl}
                      alt="待识别图片"
                      className="max-h-[240px] w-full object-contain bg-white"
                    />
                  ) : (
                    <div className="flex h-[180px] items-center justify-center text-sm text-muted-foreground">
                      还没有图片，先粘贴或选择一张图片。
                    </div>
                  )}
                </div>
              </section>

              <section className="space-y-3">
                {mode === 'mindmap' ? (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium">结构预览</div>
                      {sourceTree?.title ? <Badge variant="outline">{sourceTree.title}</Badge> : null}
                    </div>
                    <div
                      className={cn(
                        'rounded-2xl border border-border/70 bg-background/70 p-3',
                        !sourceTree && 'flex h-[220px] items-center justify-center text-sm text-muted-foreground',
                      )}
                    >
                      {sourceTree ? (
                        <div className="space-y-3">
                          {sourceTree.children.length > 0 ? (
                            sourceTree.children.map((node, index) => (
                              <SourceTreeNode key={`${node.text}-${index}`} node={node} />
                            ))
                          ) : (
                            <div className="text-sm text-muted-foreground">识别结果里还没有分支节点。</div>
                          )}
                        </div>
                      ) : (
                        '识别完成后，这里会显示轻量树形预览。'
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium">文字结果</div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleCopyText()}
                        disabled={!extractedText}
                      >
                        {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                        {copied ? '已复制' : '复制全部'}
                      </Button>
                    </div>
                    <div
                      className={cn(
                        'rounded-2xl border border-border/70 bg-background/70 p-3',
                        !extractedText && 'flex h-[260px] items-center justify-center text-sm text-muted-foreground',
                      )}
                    >
                      {extractedText ? (
                        <textarea
                          value={extractedText}
                          readOnly
                          className="min-h-[320px] w-full resize-y rounded-xl border border-border/70 bg-white px-3 py-3 text-sm leading-6 text-foreground outline-none"
                        />
                      ) : (
                        '识别完成后，这里会保留纯文字结果，你可以反复复制不同片段到导图里。'
                      )}
                    </div>
                  </>
                )}
              </section>
            </div>
          </div>

          <div className="border-t px-6 py-4">
            {mode === 'mindmap' ? (
              <>
                <div className="mb-3 text-xs text-muted-foreground">
                  追加目标：{targetNodeLabel || '请先在脑图中选中一个节点'}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Button
                    variant="outline"
                    onClick={onUndoLastImport}
                    disabled={!canUndoLastImport || loading || applying || undoing}
                  >
                    {undoing ? '撤销中…' : '撤销最近一次导入'}
                  </Button>
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading || applying || undoing}>
                      关闭侧栏
                    </Button>
                    <Button
                      variant="outline"
                      onClick={onApplyAppend}
                      disabled={!sourceTree || !canAppend || loading || applying || undoing}
                    >
                      {applying ? '应用中…' : '追加到选中节点'}
                    </Button>
                    <Button onClick={onApplyReplace} disabled={!sourceTree || loading || applying || undoing}>
                      {applying ? '应用中…' : '覆盖当前脑图'}
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground">
                  文字会保留在这里，复制后可直接回到脑图里继续编辑，不会自动关闭。
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
                    关闭侧栏
                  </Button>
                  <Button variant="outline" onClick={() => void handleCopyText()} disabled={!extractedText}>
                    {copied ? '已复制' : '复制全部'}
                  </Button>
                </div>
              </div>
            )}
          </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function countNodes(nodes: MindMapImportSourceNode[]) {
  return nodes.reduce((sum, node) => sum + 1 + countNodes(node.children || []), 0)
}
