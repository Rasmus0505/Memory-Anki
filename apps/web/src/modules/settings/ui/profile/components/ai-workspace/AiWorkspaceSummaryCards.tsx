import { Card, CardContent } from "@/shared/components/ui/card";

export function AiWorkspaceSummaryCards({
  providerCount,
  activeModelCount,
  sceneCount,
  recentSuccessCallCount,
}: {
  providerCount: number;
  activeModelCount: number;
  sceneCount: number;
  recentSuccessCallCount: number;
}) {
  return (
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <Card>
        <CardContent className="p-4">
          <div className="text-sm text-muted-foreground">Provider 数</div>
          <div className="mt-2 text-2xl font-semibold">{providerCount}</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="text-sm text-muted-foreground">活跃模型数</div>
          <div className="mt-2 text-2xl font-semibold">{activeModelCount}</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="text-sm text-muted-foreground">场景数</div>
          <div className="mt-2 text-2xl font-semibold">{sceneCount}</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="text-sm text-muted-foreground">最近成功调用</div>
          <div className="mt-2 text-2xl font-semibold">
            {recentSuccessCallCount}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
