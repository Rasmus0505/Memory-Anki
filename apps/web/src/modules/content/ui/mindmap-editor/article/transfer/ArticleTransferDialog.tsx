import { useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { exportArticleMarkdown } from '../interchange'
import type { ArticleTransferOptions } from '@/modules/content/application/articleTransfer'
import type { ArticleTransferController } from './useArticleTransfer'

export function ArticleTransferDialog({ transfer }: { transfer: ArticleTransferController }) {
  const [mode, setMode] = useState<ArticleTransferOptions['mode']>('create')
  const [confirmed, setConfirmed] = useState(false)
  const destructive = mode === 'replace' || mode === 'update'
  const blocked = transfer.busy || transfer.disabled
  const comparison = transfer.comparison
  const provenance = transfer.input?.manifest
  return <Dialog open={transfer.open} onOpenChange={(open) => { setConfirmed(false); transfer.setOpen(open) }}>
    <DialogContent className="z-[150] max-w-3xl">
      <DialogHeader><DialogTitle>文章导入 / 导出</DialogTitle><DialogDescription>Markdown 用于阅读交换；完整 ZIP 保留节点身份、图片和题目。导入前先预览，确认后才写入。</DialogDescription></DialogHeader>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={blocked} onClick={() => void transfer.exportFile(false)}>导出 Markdown</Button>
          <Button variant="outline" disabled={blocked} onClick={() => void transfer.exportFile(true)}>导出完整文章包 ZIP</Button>
        </div>
        <label className="block space-y-2">选择 Markdown 或完整 ZIP
          <input aria-label="选择文章文件" className="block w-full" type="file" accept=".md,.markdown,.zip" disabled={blocked} onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            setConfirmed(false)
            if (file) void transfer.loadFile(file)
            event.currentTarget.value = ''
          }} />
        </label>
        {transfer.disabled && <p role="alert">请先解决文档版本冲突，或返回当前宫殿。</p>}
        {transfer.busy && <p role="status">正在处理；当前编辑暂时冻结…</p>}
        {transfer.error && <p role="alert" className="text-destructive">{transfer.error}</p>}
        {transfer.notice && <p role="status">{transfer.notice}</p>}
        {transfer.warnings.length > 0 && <section aria-label="传输警告"><h3 className="font-semibold">注意事项</h3><ul className="list-disc pl-5">{transfer.warnings.map((warning, index) => <li key={`${warning.code}:${index}`}>{warning.message}</li>)}</ul></section>}
        {transfer.input && <>
          <section aria-label="文章来源"><h3 className="font-semibold">{transfer.fileName}</h3><p>来源：{provenance?.sourceOwner ?? '普通 Markdown（无可验证来源）'}</p><p>基准版本：{provenance?.baseRevision ?? '无'}</p><p>资源：{comparison?.assetCount ?? 0}；题目：{comparison?.hasQuiz ? '包含' : '不包含'}</p></section>
          {comparison && <section aria-label="变更比较"><p>新增 {comparison.added.length} · 删除 {comparison.removed.length} · 修改 {comparison.changed.length}</p><p>来源{comparison.sourceOwnerMatches ? '匹配' : '不匹配'}；版本{comparison.revisionMatches ? '匹配' : '不匹配'}。普通 Markdown 的节点身份会重新生成。</p>
            <details><summary>查看节点 UID 变更</summary>{(['added', 'removed', 'changed'] as const).map((kind) => <p key={kind}>{({ added: '新增', removed: '删除', changed: '修改' })[kind]}：{comparison[kind].join('、') || '无'}</p>)}</details>
          </section>}
          <details open><summary>文章预览</summary><pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded border p-3 text-sm">{exportArticleMarkdown(transfer.input.document).markdown}</pre></details>
          <label className="block">导入方式 <select aria-label="导入方式" value={mode} disabled={blocked} onChange={(event) => { setMode(event.target.value as ArticleTransferOptions['mode']); setConfirmed(false) }}>
            <option value="create">新建宫殿</option><option value="append" disabled={!transfer.selectedUid}>追加到选中节点</option><option value="replace">替换当前文章</option><option value="update" disabled={!comparison?.canUpdate}>更新原宫殿（来源及版本必须一致）</option>
          </select></label>
          {mode === 'append' && <p>追加位置：{transfer.selectedUid ?? '请先在文章或脑图中选择节点'}</p>}
          {destructive && <label className="flex gap-2"><input type="checkbox" checked={confirmed} disabled={blocked} onChange={(event) => setConfirmed(event.target.checked)} />我已比较变更，明确确认替换当前文章及其关联内容。</label>}
          <Button disabled={blocked || (destructive && !confirmed) || (mode === 'update' && !comparison?.canUpdate) || (mode === 'append' && !transfer.selectedUid)} onClick={() => void transfer.apply({ mode, parentUid: transfer.selectedUid, confirmReplace: confirmed })}>确认导入</Button>
        </>}
      </div>
    </DialogContent>
  </Dialog>
}
