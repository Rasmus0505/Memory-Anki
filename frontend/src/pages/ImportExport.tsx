import { useState } from 'react'
import { api } from '@/api/client'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Download, Upload, FileJson, FileText } from 'lucide-react'
import { toast } from 'sonner'

export default function ImportExport() {
  const [result, setResult] = useState<string | null>(null)

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault()
    const form = e.target as HTMLFormElement
    const file = (form.elements.namedItem('file') as HTMLInputElement).files?.[0]
    const format = (form.elements.namedItem('format') as HTMLSelectElement).value
    if (!file) return
    const res = await api.importFile(file, format)
    if (res.ok) {
      toast.success(`成功导入 ${res.count} 个宫殿`)
      setResult(null)
    } else {
      setResult(`导入失败: ${res.error}`)
    }
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">导入导出</h1>
        <p className="text-sm text-muted-foreground mt-1">备份数据或迁移宫殿。</p>
      </div>

      {result && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{result}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Download className="h-4 w-4" />导出</CardTitle>
            <CardDescription>导出所有宫殿为文件。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <a href={api.exportJson()} className="flex items-center gap-3 rounded-lg border p-3 hover:bg-secondary transition-colors text-sm">
              <FileJson className="h-5 w-5 text-muted-foreground shrink-0" />
              <div>
                <div className="font-medium">JSON 格式</div>
                <div className="text-xs text-muted-foreground">完整数据备份，适合迁移恢复</div>
              </div>
            </a>
            <a href={api.exportMarkdown()} className="flex items-center gap-3 rounded-lg border p-3 hover:bg-secondary transition-colors text-sm">
              <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
              <div>
                <div className="font-medium">Markdown 格式</div>
                <div className="text-xs text-muted-foreground">人类可读，适合分享和快速录入</div>
              </div>
            </a>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Upload className="h-4 w-4" />导入</CardTitle>
            <CardDescription>从文件导入宫殿。</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleImport} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">文件格式</label>
                <select name="format" className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                  <option value="json">JSON</option>
                  <option value="markdown">Markdown</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">选择文件</label>
                <input type="file" name="file" required className="w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-secondary file:text-foreground hover:file:bg-secondary/80" />
              </div>
              <Button type="submit" className="w-full">
                <Upload className="h-4 w-4" /> 开始导入
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
