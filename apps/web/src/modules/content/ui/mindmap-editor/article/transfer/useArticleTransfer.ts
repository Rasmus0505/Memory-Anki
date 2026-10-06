import { useEffect, useRef, useState } from 'react'
import { applyArticleTransfer, collectArticlePackageExport, compareArticleTransfer, type ArticleTransferHost, type ArticleTransferInput, type ArticleTransferOptions } from '@/modules/content/application/articleTransfer'
import type { ArticleTransferResponse } from '@/modules/content/api/articlePackageApi'
import { ARTICLE_PACKAGE_LIMITS, exportArticleMarkdown, exportArticlePackage, importArticleMarkdown, importArticlePackage, type ArticleInterchangeWarning } from '../interchange'

export interface ArticleTransferHostPort {
  ownerId: string
  readHost: () => Omit<ArticleTransferHost, 'operationId'> | null
  flushSave: () => Promise<void>
  onApplied: (result: ArticleTransferResponse, captured: ArticleTransferHost) => void | Promise<void>
  pendingConflict: boolean
  selectedUid?: string
  active?: boolean
}
export function downloadArticleFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

export function useArticleTransfer(port: ArticleTransferHostPort) {
  const latest = useRef(port)
  latest.current = port
  const [operationScope] = useState(() => crypto.randomUUID())
  const epoch = useRef(0)
  const locked = useRef(false)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [input, setInput] = useState<ArticleTransferInput | null>(null)
  const [warnings, setWarnings] = useState<ArticleInterchangeWarning[]>([])
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    epoch.current += 1
    setOpen(false)
    setInput(null)
    setError(null)
    setWarnings([])
    return () => { epoch.current += 1 }
  }, [port.ownerId, port.active])
  const current = (ticket: number, owner: string) => epoch.current === ticket && latest.current.ownerId === owner && latest.current.active !== false
  const run = async (task: (ticket: number, owner: string) => Promise<void>) => {
    if (locked.current || latest.current.pendingConflict || latest.current.active === false) return
    locked.current = true
    setBusy(true)
    setError(null)
    setNotice(null)
    const ticket = ++epoch.current, owner = latest.current.ownerId
    try { await task(ticket, owner) }
    catch (cause) { if (current(ticket, owner)) setError(cause instanceof Error ? cause.message : '文章传输失败') }
    finally { locked.current = false; setBusy(false) }
  }
  const readHost = (operationId: string) => {
    const host = latest.current.readHost()
    if (!host || latest.current.pendingConflict || latest.current.active === false) throw new Error('当前文档不可用或存在版本冲突')
    return { ...host, operationId }
  }
  const prepare = async (ticket: number, owner: string) => {
    await latest.current.flushSave()
    if (!current(ticket, owner)) throw new Error('文章传输操作已过期')
    const host = readHost(`article-transfer:${operationScope}:${owner}:${ticket}`)
    if (host.dirty) throw new Error('当前修改尚未保存，请先解决保存错误')
    return structuredClone(host)
  }
  const loadFile = (file: File) => run(async (ticket, owner) => {
    setInput(null)
    setWarnings([])
    setFileName(file.name)
    if (file.size > ARTICLE_PACKAGE_LIMITS.compressedBytes) throw new Error('文章文件超过 16 MiB')
    const preview = /\.zip$/i.test(file.name)
      ? importArticlePackage(new Uint8Array(await file.arrayBuffer()), { expectedSourceOwner: owner })
      : /\.(md|markdown)$/i.test(file.name)
        ? importArticleMarkdown(await file.text(), { title: file.name.replace(/\.[^.]+$/, '') })
        : (() => { throw new Error('请选择 Markdown (.md) 或完整文章包 (.zip)') })()
    if (!current(ticket, owner)) return
    setInput(preview)
    setWarnings(preview.warnings)
  })
  const apply = (options: ArticleTransferOptions) => run(async (ticket, owner) => {
    if (!input) throw new Error('请先选择文章文件并预览')
    const captured = await prepare(ticket, owner)
    const outcome = await applyArticleTransfer(input, captured, options, () => {
      const host = readHost(captured.operationId)
      return current(ticket, owner) ? host : { ...host, operationId: 'expired' }
    })
    if (!current(ticket, owner)) return
    if (outcome.stale) throw new Error('导入已在服务器完成，但当前文档已变化；请重新加载检查，勿重复提交')
    await latest.current.onApplied(outcome.result, captured)
    if (current(ticket, owner)) { setInput(null); setNotice('文章导入完成'); setOpen(false) }
  })
  const exportFile = (full: boolean) => run(async (ticket, owner) => {
    const captured = await prepare(ticket, owner)
    if (full) {
      if (!captured.palaceId || !captured.revision) throw new Error('请先保存宫殿后导出完整文章包')
      const source = await collectArticlePackageExport(captured.palaceId, captured.revision)
      if (!current(ticket, owner)) return
      const now = readHost(captured.operationId)
      if (JSON.stringify(now) !== JSON.stringify(captured)) throw new Error('文档已变化，请重新导出')
      const result = exportArticlePackage(source.document, source.options)
      setWarnings(result.warnings)
      downloadArticleFile(new Blob([new Uint8Array(result.bytes)], { type: 'application/zip' }), 'article.zip')
    } else {
      const result = exportArticleMarkdown(captured.document)
      setWarnings(result.warnings)
      downloadArticleFile(new Blob([result.markdown], { type: 'text/markdown;charset=utf-8' }), 'article.md')
    }
    setNotice('导出完成')
  })
  const host = port.readHost()
  const comparison = input && host ? compareArticleTransfer(input, { ...host, operationId: 'preview' }) : null
  return { open, busy, input, warnings, fileName, error, notice, comparison,
    selectedUid: port.selectedUid, disabled: port.pendingConflict || port.active === false,
    setOpen: (value: boolean) => { if (!locked.current) { setOpen(value); if (!value) epoch.current += 1 } },
    loadFile, apply, exportFile,
  }
}
export type ArticleTransferController = ReturnType<typeof useArticleTransfer>
