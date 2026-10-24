import { ArrowRightToLine, PanelsTopLeft } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { MindMapImportFooter } from '@/modules/produce/ui/mindmap-import/components/import-drawer/footer'
import { MindMapImportResultsPanel } from '@/modules/produce/ui/mindmap-import/components/import-drawer/results-panel'
import { MindMapImportSourceConfigPanel } from '@/modules/produce/ui/mindmap-import/components/import-drawer/source-config-panel'
import { countSourceTreeNodes } from '@/modules/produce/ui/mindmap-import/components/import-drawer/source-tree'
import type {
  MindMapImportFooterModel,
  MindMapImportResultsModel,
  MindMapImportSourceConfigModel,
  MindMapImportDrawerProps,
} from '@/modules/produce/ui/mindmap-import/components/import-drawer/types'
import {
  normalizePreviewConfig,
  normalizePreviewEditorDoc,
} from '@/shared/lib/mindmapPreview'
import type { MindMapEditorState } from '@/shared/api/contracts'
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

const LAYOUT_MODE_STORAGE_KEY = 'memory-anki-mindmap-import-layout'

type ImportDrawerLayoutMode = 'floating' | 'sidebar'

/** Remember 悬浮窗/侧边栏 so reopening keeps the shape the user picked. */
function readStoredLayoutMode(): ImportDrawerLayoutMode {
  if (typeof window === 'undefined') return 'floating'
  try {
    return window.localStorage.getItem(LAYOUT_MODE_STORAGE_KEY) === 'sidebar' ? 'sidebar' : 'floating'
  } catch {
    return 'floating'
  }
}

function writeStoredLayoutMode(mode: ImportDrawerLayoutMode) {
  try {
    window.localStorage.setItem(LAYOUT_MODE_STORAGE_KEY, mode)
  } catch {
    // 本地偏好写入失败不应影响弹窗使用。
  }
}

export function MindMapImportDrawer(props: MindMapImportDrawerProps) {
  const {
    open,
    onOpenChange,
    previewEditorDoc,
    sourceTree,
    className,
    overlayClassName,
  } = props

  const [layoutMode, setLayoutMode] = useState<ImportDrawerLayoutMode>(readStoredLayoutMode)
  const toggleLayoutMode = () => {
    setLayoutMode((current) => {
      const next: ImportDrawerLayoutMode = current === 'floating' ? 'sidebar' : 'floating'
      writeStoredLayoutMode(next)
      return next
    })
  }
  const [previewFrameVersion, setPreviewFrameVersion] = useState(0)
  const previewSectionRef = useRef<HTMLElement | null>(null)
  const lastAutoScrollKeyRef = useRef('')

  const nodeCount = sourceTree ? countSourceTreeNodes(sourceTree.children) : 0
  const hasPreviewEditorDoc = Boolean(previewEditorDoc)
  const previewMindMapState = hasPreviewEditorDoc
    ? ({
        editor_doc: normalizePreviewEditorDoc(previewEditorDoc),
        editor_config: {
          ...normalizePreviewConfig(null),
          layout: 'mindMap',
        },
        editor_local_config: {},
        lang: 'zh',
      } satisfies MindMapEditorState)
    : null

  const sourceConfigModel: MindMapImportSourceConfigModel = {
    applying: props.applying,
    error: props.error,
    manualImportFileName: props.manualImportFileName,
    manualImportFormatPrompt: props.manualImportFormatPrompt,
    manualImportText: props.manualImportText,
    nodeCount,
    onManualImportFileChange: props.onManualImportFileChange,
    onManualImportParse: props.onManualImportParse,
    onManualImportTextChange: props.onManualImportTextChange,
    sourceTree: props.sourceTree,
    undoing: props.undoing,
  }
  const resultsModel: MindMapImportResultsModel = {
    previewFrameVersion,
    previewMindMapState,
    previewSectionRef,
    renderMindMapPreview: props.renderMindMapPreview,
    sourceTree: props.sourceTree,
  }
  const footerModel: MindMapImportFooterModel = {
    applying: props.applying,
    canAppend: props.canAppend,
    canUndoLastImport: props.canUndoLastImport,
    extractedText: '',
    loading: false,
    mode: 'mindmap',
    onApplyAppend: props.onApplyAppend,
    onApplyReplace: props.onApplyReplace,
    onClose: () => onOpenChange(false),
    onUndoLastImport: props.onUndoLastImport,
    sourceTree: props.sourceTree,
    targetNodeLabel: props.targetNodeLabel,
    undoing: props.undoing,
  }

  useEffect(() => {
    if (!open || !hasPreviewEditorDoc) return
    setPreviewFrameVersion((current) => current + 1)
  }, [open, hasPreviewEditorDoc, previewEditorDoc])

  useEffect(() => {
    if (!open || !sourceTree) return
    const autoScrollKey = `mindmap:manual-json:${sourceTree.title ?? ''}:${nodeCount}`
    if (autoScrollKey === lastAutoScrollKeyRef.current) return
    const timer = window.setTimeout(() => {
      const previewSection = previewSectionRef.current
      if (!previewSection) return
      lastAutoScrollKeyRef.current = autoScrollKey
      previewSection.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [open, sourceTree, nodeCount])

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogContent
        data-testid="mindmap-import-dialog-content"
        floatingId="mindmap-import"
        expandOnOpen
        dismissOnInteractOutside={false}
        layout={layoutMode === 'sidebar' ? 'unstyled' : 'centered'}
        className={cn(
          layoutMode === 'sidebar'
            ? 'h-[100dvh] max-w-none rounded-none border-0 bg-card/98 p-0 shadow-floating'
            : 'h-[min(92vh,980px)] max-w-[min(92vw,1440px)] rounded-lg border bg-card/98 p-0 shadow-floating',
          'overflow-hidden overscroll-contain',
          className,
          overlayClassName,
          // The sidebar dock owns its own placement. `layout="unstyled"` means
          // DialogContent ships no positioning of its own, so without `fixed`
          // the panel renders in normal flow at the end of <body> — off-screen,
          // which reads as "the button did nothing". These classes come last so
          // they also beat the callers' z-index classes (z-[110]/z-[120] sit
          // under the fullscreen mind-map host at z-230).
          layoutMode === 'sidebar' && 'fixed right-0 top-0 z-[241] flex w-full flex-col sm:right-4 sm:top-4 sm:h-[calc(100dvh-32px)] sm:w-[620px] sm:max-w-[calc(100vw-32px)] sm:rounded-l-3xl sm:border-l sm:border-border',
        )}
      >
        <DialogHeader>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <DialogTitle>文字转脑图</DialogTitle>
                <Badge variant="secondary">手动解析 · 不调用 AI</Badge>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 sm:h-8 sm:min-h-8"
                onClick={toggleLayoutMode}
                title={layoutMode === 'floating' ? '切换为右侧边栏' : '切换为中间悬浮窗'}
              >
                {layoutMode === 'floating' ? (
                  <>
                    <ArrowRightToLine className="mr-2 size-4" />
                    侧边栏
                  </>
                ) : (
                  <>
                    <PanelsTopLeft className="mr-2 size-4" />
                    悬浮窗
                  </>
                )}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              粘贴或载入 JSON，解析为脑图草稿后覆盖当前脑图，或追加到选中知识点。
            </p>
          </div>
          <DialogClose onClick={() => onOpenChange(false)} />
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div data-testid="mindmap-import-scroll-panel" className="min-h-0 flex-1 overflow-y-auto">
              <MindMapImportSourceConfigPanel model={sourceConfigModel} />
              <MindMapImportResultsPanel model={resultsModel} />
            </div>
            <MindMapImportFooter model={footerModel} copied={false} onCopyText={async () => {}} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
