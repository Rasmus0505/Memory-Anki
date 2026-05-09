import { Link } from 'react-router-dom'
import { ArrowLeft, History } from 'lucide-react'
import type { MindMapEditorState } from '@/shared/api/contracts'
import { PageIntro } from '@/shared/components/layout/PageIntro'
import { MindMapFrame } from '@/shared/components/mindmap-host'
import { Button } from '@/shared/components/ui/button'
import { Badge } from '@/shared/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { SessionTimerBar } from '@/shared/components/session/SessionTimerBar'
import { cn } from '@/shared/lib/utils'
import { PalaceAttachmentPanel } from '@/features/palace-edit/components/PalaceAttachmentPanel'
import { PalaceChapterPanel } from '@/features/palace-edit/components/PalaceChapterPanel'
import { PalaceMetaPanel } from '@/features/palace-edit/components/PalaceMetaPanel'
import { PalaceVersionDialog } from '@/features/palace-edit/components/PalaceVersionDialog'
import { usePalaceEditPage } from '@/features/palace-edit/hooks/usePalaceEditPage'

export default function PalaceEdit() {
  const page = usePalaceEditPage()

  if (!page.palaceId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">
        正在为新宫殿创建草稿…
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageIntro
        title={page.palace?.title || '宫殿编辑器'}
        actions={
          <>
            <Link to="/palaces">
              <Button variant="outline" size="sm">
                <ArrowLeft className="mr-2 h-4 w-4" />
                返回列表
              </Button>
            </Link>
            {page.palace ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void page.handleOpenVersions()}
              >
                <History className="mr-2 h-4 w-4" />
                恢复点
              </Button>
            ) : null}
            <Badge variant={page.statusBadge.variant}>
              {page.statusBadge.label}
            </Badge>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-4">
          <SessionTimerBar
            effectiveSeconds={page.timer.effectiveSeconds}
            pauseCount={page.timer.pauseCount}
            status={page.timer.status}
            onStart={() => page.timer.start({ source: 'manual' })}
            onPause={() => page.timer.pause({ source: 'manual' })}
            onResume={() => page.timer.resume({ source: 'manual' })}
            onAdjustDuration={page.timer.adjustDuration}
            showCompleteAction={false}
            className={
              page.mindMapFullscreen
                ? 'fixed right-5 top-5 z-[100]'
                : 'sticky top-5 z-20'
            }
          />

          <PalaceMetaPanel
            palace={page.palace}
            title={page.title}
            createdAt={page.createdAt}
            onTitleChange={page.setTitle}
            onCreatedAtChange={page.setCreatedAt}
            onSave={page.handleSaveMeta}
            onEstablishCreatedAt={page.handleEstablishCreatedAt}
          />

          <PalaceChapterPanel
            chapterOptions={page.chapterOptions}
            selectedChapterIds={page.selectedChapterIds}
            onToggleChapter={page.handleChapterToggle}
          />

          <PalaceAttachmentPanel
            palace={page.palace}
            onUpload={page.handleAttachmentUpload}
            onDelete={page.handleAttachmentDelete}
          />
        </div>

        <Card
          className={cn(
            'min-h-[74vh] border-border/70 bg-card/92',
            page.mindMapFullscreen &&
              'fixed inset-4 z-[90] min-h-0 bg-card/96 shadow-2xl',
          )}
        >
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">宫殿脑图</CardTitle>
            </div>
            {page.selectedNode?.memoryAnkiId ? (
              <Badge variant="secondary">
                {page.selectedNode.memoryAnkiNodeType} #
                {page.selectedNode.memoryAnkiId}
              </Badge>
            ) : null}
          </CardHeader>
          <CardContent
            className={cn(
              'min-h-[64vh]',
              page.mindMapFullscreen && 'h-[calc(100vh-120px)] min-h-0',
            )}
          >
            {page.editorState ? (
              <MindMapFrame
                key={`${page.palaceId}-${page.frameVersion}`}
                editorState={page.editorState}
                onEditorStateChange={(nextState: MindMapEditorState) => {
                  page.timer.registerActivity({ source: 'mind_map_edit' })
                  page.setEditorState(nextState)
                }}
                onNodeActive={(nodes) => {
                  page.timer.registerActivity({ source: 'node_active' })
                  page.setSelectedNodes(nodes)
                }}
                onFullscreenChange={page.setMindMapFullscreen}
                className={cn(
                  'w-full rounded-2xl border border-border/70 bg-white',
                  page.mindMapFullscreen ? 'h-full' : 'h-[64vh]',
                )}
              />
            ) : (
              <div className="flex h-[64vh] items-center justify-center rounded-2xl border border-dashed border-border/80 bg-background/60 text-sm text-muted-foreground">
                正在加载宫殿编辑器…
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <PalaceVersionDialog
        open={page.versionOpen}
        versions={page.versions}
        removedDuplicateCount={page.removedDuplicateCount}
        previewingVersionId={page.previewingVersionId}
        previewVersionDetail={page.previewVersionDetail}
        previewLoading={page.previewLoading}
        previewError={page.previewError}
        editorStateLang={page.editorState?.lang || 'zh'}
        onOpenChange={(open) => {
          page.setVersionOpen(open)
          if (!open) page.handleCloseVersions()
        }}
        onClose={page.handleCloseVersions}
        onPreviewVersion={page.handlePreviewVersion}
        onRestoreVersion={page.handleRestoreVersion}
        onBackToList={page.resetVersionPreview}
      />
    </div>
  )
}
