import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'

export default function BatchGenerationWorkspacePage() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-3xl items-center justify-center p-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>整书批量生成</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          AI 出题、讲解、纠错和自由提问已禁用
        </CardContent>
      </Card>
    </main>
  )
}
