import { useMemo } from 'react'
import { Link2, MoveRight } from 'lucide-react'
import type { BilinkNodeContext, MindMapEditorState } from '@/shared/api/contracts'
import { MindMapFrame } from '@/shared/components/mindmap-host'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import {
  buildBilinkPreviewEditorState,
  sanitizeBilinkText,
} from '@/features/bilink/model/bilink-text'

interface BilinkPreviewPopoverProps {
  open: boolean
  loading: boolean
  error: string
  context: BilinkNodeContext | null
  editorState: MindMapEditorState | null
  highlightQuery?: string | null
  onClose: () => void
  onJump: (context: BilinkNodeContext) => void
}

function NodePills({
  label,
  items,
}: {
  label: string
  items: Array<{ uid: string; text: string }>
}) {
  if (!items.length) return null
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <span
            key={item.uid}
            className="inline-flex rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-muted-foreground"
          >
            {sanitizeBilinkText(item.text) || '未命名节点'}
          </span>
        ))}
      </div>
    </div>
  )
}

export function BilinkPreviewPopover({
  open,
  loading,
  error,
  context,
  editorState,
  highlightQuery = null,
  onClose,
  onJump,
}: BilinkPreviewPopoverProps) {
  if (!open) return null

  const previewEditorState = useMemo(
    () => buildBilinkPreviewEditorState(editorState, highlightQuery),
    [editorState, highlightQuery],
  )
  const sanitizedNodeText = sanitizeBilinkText(context?.node_text) || '未命名节点'
  const sanitizedNodePath = (context?.node_path ?? [])
    .map((segment) => sanitizeBilinkText(segment))
    .filter(Boolean)
  const sanitizedNodeNote = sanitizeBilinkText(context?.node_note)
  const sanitizedParentText = sanitizeBilinkText(context?.parent_text)
  const sanitizedPalaceTitle = sanitizeBilinkText(context?.palace_title) || '未命名宫殿'

  return (
    <div className="pointer-events-auto fixed inset-0 z-[125] flex items-center justify-center bg-black/20 p-4">
      <Card className="flex h-[min(88vh,940px)] w-[min(1200px,100%)] flex-col border-border bg-background shadow-2xl">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">宫殿预览</CardTitle>
            {context ? (
              <div className="mt-1 text-xs text-muted-foreground">{sanitizedPalaceTitle}</div>
            ) : null}
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            关闭
          </Button>
        </CardHeader>

        <CardContent className="grid min-h-0 flex-1 gap-4 overflow-hidden pb-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          {loading ? <div className="text-sm text-muted-foreground">正在加载宫殿预览...</div> : null}
          {!loading && error ? (
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}
          {!loading && !error && context && previewEditorState ? (
            <>
              <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
                <div className="rounded-2xl border border-border bg-muted/70 p-4">
                  <div className="text-lg font-semibold text-primary">{sanitizedNodeText}</div>
                  {sanitizedNodePath.length > 0 ? (
                    <div className="mt-2 text-xs text-muted-foreground">
                      {sanitizedNodePath.join(' / ')}
                    </div>
                  ) : null}
                  {sanitizedNodeNote ? (
                    <div className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{sanitizedNodeNote}</div>
                  ) : null}
                </div>

                {sanitizedParentText ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <MoveRight className="h-4 w-4" />
                    父节点：{sanitizedParentText}
                  </div>
                ) : null}

                <NodePills label="子节点" items={context.children} />
                <NodePills label="同级节点" items={context.siblings} />

                <div className="flex justify-end">
                  <Button type="button" onClick={() => onJump(context)}>
                    <Link2 className="h-4 w-4" />
                    跳转到该宫殿
                  </Button>
                </div>
              </div>

              <div className="min-h-0">
                <MindMapFrame
                  key={`bilink-preview-${context.palace_id}-${context.node_uid ?? 'palace'}-${highlightQuery?.trim() || 'plain'}`}
                  editorState={previewEditorState}
                  readonly
                  onEditorStateChange={() => {}}
                  className="h-[min(68vh,760px)] w-full rounded-2xl border border-border/70 bg-background"
                />
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
