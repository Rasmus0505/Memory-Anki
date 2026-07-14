import { useRef, useState, type ChangeEvent } from 'react'
import {
  buildMindMapTransferFileName,
  countMindMapDocumentNodes,
  parseMindMapTransferFile,
  serializeMindMapTransferFile,
} from '@/entities/mindmap-document'
import type { ImportApplyContext, MindMapEditorState } from '@/shared/api/contracts'
import { appConfirm } from '@/shared/components/ui/native-dialog'
import { toast } from '@/shared/feedback/toast'

interface UsePalaceMindMapFileTransferOptions {
  editorState: MindMapEditorState | null
  palaceTitle: string
  applyEditorState: (
    nextState: MindMapEditorState,
    context?: ImportApplyContext,
  ) => Promise<void>
}

export function usePalaceMindMapFileTransfer({
  editorState,
  palaceTitle,
  applyEditorState,
}: UsePalaceMindMapFileTransferOptions) {
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const exportMindMap = () => {
    if (!editorState?.editor_doc) {
      toast.error('当前脑图还没加载完成。')
      return
    }
    try {
      const content = serializeMindMapTransferFile({
        document: editorState.editor_doc,
        sourceTitle: palaceTitle,
      })
      const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = buildMindMapTransferFileName(palaceTitle)
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      toast.success('脑图已导出')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导出脑图失败。')
    }
  }

  const importMindMap = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !editorState || importing) return

    setImporting(true)
    try {
      const transferFile = parseMindMapTransferFile(await file.text())
      const nodeCount = countMindMapDocumentNodes(transferFile.document)
      const sourceTitle = transferFile.source.title || '未命名脑图'
      const confirmed = await appConfirm(
        `文件：${file.name}\n来源：${sourceTitle}\n知识点数：${nodeCount}\n\n导入后将整体替换当前脑图，是否继续？`,
        {
          title: '导入思维导图',
          confirmText: '替换当前脑图',
          tone: 'danger',
        },
      )
      if (!confirmed) return

      await applyEditorState(
        { ...editorState, editor_doc: transferFile.document },
        {
          source: 'import',
          jobId: null,
          applyMode: 'replace',
          sourceTitle,
        },
      )
      toast.success('已导入并替换当前脑图')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导入脑图失败。')
    } finally {
      setImporting(false)
    }
  }

  return {
    input: (
      <input
        ref={fileInputRef}
        className="hidden"
        type="file"
        accept=".json,application/json"
        aria-label="选择要导入的脑图文件"
        onChange={(event) => { void importMindMap(event) }}
      />
    ),
    toolbarActions: [
      {
        label: '导出脑图',
        onClick: exportMindMap,
        disabled: !editorState?.editor_doc,
        separatorBefore: true,
      },
      {
        label: importing ? '正在导入…' : '导入脑图',
        onClick: () => fileInputRef.current?.click(),
        disabled: !editorState || importing,
        opensOverlay: true,
      },
    ],
  }
}