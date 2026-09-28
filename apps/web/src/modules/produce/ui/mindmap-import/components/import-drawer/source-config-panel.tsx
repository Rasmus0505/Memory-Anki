import { ClipboardCopy, FileJson } from 'lucide-react'
import { useState } from 'react'
import type { MindMapImportSourceConfigModel } from '@/modules/produce/ui/mindmap-import/components/import-drawer/types'
import { Button } from '@/shared/components/ui/button'

interface MindMapImportSourceConfigPanelProps {
  model: MindMapImportSourceConfigModel
}

export function MindMapImportSourceConfigPanel({
  model,
}: MindMapImportSourceConfigPanelProps) {
  const {
    applying,
    error,
    manualImportFileName,
    manualImportFormatPrompt,
    manualImportText,
    nodeCount,
    onManualImportFileChange,
    onManualImportParse,
    onManualImportTextChange,
    sourceTree,
    undoing,
  } = model
  const [promptCopied, setPromptCopied] = useState(false)

  const handleCopyFormatPrompt = async () => {
    if (!manualImportFormatPrompt) return
    await navigator.clipboard.writeText(manualImportFormatPrompt)
    setPromptCopied(true)
    window.setTimeout(() => setPromptCopied(false), 1400)
  }

  return (
    <div className="border-b px-6 py-4">
      <div className="space-y-3 rounded-lg border border-border/70 bg-background/60 p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium">手动导入脑图</div>
            <div className="text-xs text-muted-foreground">
              粘贴 JSON / 缩进大纲，或导入 .json / .txt / .md 文件。解析后即可覆盖或追加到宫殿，不调用 AI。
            </div>
          </div>
          <label className="inline-flex cursor-pointer items-center rounded-md border px-3 py-2 text-sm hover:bg-secondary">
            <FileJson className="mr-2 size-4" />
            选择文件
            <input
              type="file"
              accept=".json,.txt,.md,.markdown,application/json,text/plain,text/markdown"
              className="hidden"
              onChange={onManualImportFileChange}
            />
          </label>
        </div>

        {manualImportFileName ? (
          <div className="text-xs text-muted-foreground">
            当前文件：<span className="font-medium text-foreground">{manualImportFileName}</span>
          </div>
        ) : null}

        <div className="space-y-2 rounded-md border border-dashed border-border/70 bg-muted/15 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium">格式整理提示词</div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void handleCopyFormatPrompt()}
              disabled={!manualImportFormatPrompt}
            >
              <ClipboardCopy className="mr-2 size-4" />
              {promptCopied ? '已复制' : '复制提示词'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            若从外部复制的节点/JSON 格式有误，可复制此提示词到外部工具，把内容整理成可导入 JSON 后再粘贴回来。
          </p>
          <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/70 bg-background/80 p-2 text-[11px] leading-relaxed text-muted-foreground">
            {manualImportFormatPrompt || '提示词加载中…'}
          </pre>
        </div>

        <label className="grid gap-1 text-sm">
          <span>粘贴 JSON 或大纲文本</span>
          <textarea
            className="min-h-[160px] rounded-md border bg-background px-3 py-2 font-mono text-xs leading-relaxed"
            value={manualImportText}
            onChange={(event) => onManualImportTextChange(event.target.value)}
            placeholder={`{\n  "title": "根节点标题",\n  "children": [\n    {\n      "text": "要点",\n      "children": [\n        { "text": "子要点", "children": [] }\n      ]\n    }\n  ]\n}`}
            spellCheck={false}
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={onManualImportParse}
            disabled={!manualImportText.trim() || applying || undoing}
          >
            解析为脑图草稿
          </Button>
          <span className="text-xs text-muted-foreground">
            支持：source-tree JSON、Memory Anki 导出 JSON、编辑器文档 JSON、Markdown/缩进大纲
          </span>
        </div>
      </div>

      <div
        data-testid="mindmap-import-stream-status"
        className="mt-3 text-xs text-muted-foreground"
      >
        {sourceTree
          ? `已生成草稿，共 ${nodeCount} 个知识点（手动导入，未调用 AI）`
          : '粘贴或导入 JSON/大纲后，点击「解析为脑图草稿」，再覆盖或追加到宫殿。'}
      </div>

      {error ? (
        <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}
    </div>
  )
}
