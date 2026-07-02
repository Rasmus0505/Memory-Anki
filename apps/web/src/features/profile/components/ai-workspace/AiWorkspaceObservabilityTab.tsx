import { Search } from "lucide-react";
import type { AiCallLogSummary } from "@/shared/api/contracts";
import { LoadingState } from "@/shared/components/state-placeholders";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import {
  formatDateTime,
  type AiWorkspaceLogFilters,
} from "@/features/profile/model/ai-workspace";

export function AiWorkspaceObservabilityTab({
  logFilters,
  logs,
  logsLoading,
  onLogFilterChange,
  onLoadLogs,
  onOpenLogDetail,
}: {
  logFilters: AiWorkspaceLogFilters;
  logs: AiCallLogSummary[];
  logsLoading: boolean;
  onLogFilterChange: (filters: AiWorkspaceLogFilters) => void;
  onLoadLogs: () => Promise<void>;
  onOpenLogDetail: (logId: string) => Promise<void>;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-3 p-4 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
          <Input
            value={logFilters.provider}
            onChange={(event) =>
              onLogFilterChange({ ...logFilters, provider: event.target.value })
            }
            placeholder="Provider"
          />
          <Input
            value={logFilters.model}
            onChange={(event) =>
              onLogFilterChange({ ...logFilters, model: event.target.value })
            }
            placeholder="Model"
          />
          <Input
            value={logFilters.feature}
            onChange={(event) =>
              onLogFilterChange({ ...logFilters, feature: event.target.value })
            }
            placeholder="Feature"
          />
          <select
            value={logFilters.status}
            onChange={(event) =>
              onLogFilterChange({ ...logFilters, status: event.target.value })
            }
            className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">全部状态</option>
            <option value="success">success</option>
            <option value="error">error</option>
            <option value="started">started</option>
          </select>
          <Button type="button" onClick={() => void onLoadLogs()}>
            <Search className="mr-2 size-4" />
            筛选
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {logsLoading ? <LoadingState text="正在加载调用日志…" /> : null}
        {!logsLoading && logs.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-sm text-muted-foreground">
              当前没有符合筛选条件的 AI 调用日志。
            </CardContent>
          </Card>
        ) : null}
        {logs.map((log) => (
          <Card key={log.id} className="border-border/60">
            <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="font-medium">{log.feature}</div>
                  <Badge
                    variant={log.status === "error" ? "destructive" : "secondary"}
                  >
                    {log.status}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span>{log.provider}</span>
                  <span>{log.model}</span>
                  <span>{formatDateTime(log.created_at)}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void onOpenLogDetail(log.id)}
                >
                  查看详情
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
