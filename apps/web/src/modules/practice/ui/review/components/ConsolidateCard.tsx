import { useEffect, useMemo, useState } from 'react'
import { Layers3 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { ReviewConsolidateToday } from '@/shared/api/contracts'
import { buildReviewSessionPath } from '@/modules/memory/public'
import { getConsolidateTodayApi } from '@/modules/practice/ui/review/api/scheduleInsightApi'
import { startReviewSessionApi } from '@/modules/practice/ui/review/api/reviewApi'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'

export function ConsolidateCard() {
  const navigate = useNavigate()
  const [data, setData] = useState<ReviewConsolidateToday | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  useEffect(() => { let active = true; void getConsolidateTodayApi().then((r) => { if (active) setData(r.item) }).catch(() => { if (active) setData(null) }); return () => { active = false } }, [])
  const groups = useMemo(() => {
    const result = new Map<number, { title: string; uids: string[] }>()
    for (const item of data?.items ?? []) { const row = result.get(item.palace_id) ?? { title: item.palace_title, uids: [] }; row.uids.push(item.node_uid); result.set(item.palace_id, row) }
    return Array.from(result.entries())
  }, [data])
  if (!data?.pending) return null
  const start = async (palaceId: number, uids: string[]) => {
    setBusy(palaceId)
    try { const session = await startReviewSessionApi(palaceId, { entry_mode: 'node', scope_node_uids: uids, consolidate: true }); navigate(buildReviewSessionPath(session.id)) } finally { setBusy(null) }
  }
  return <Card data-testid="consolidate-card" className="border-warning/30">
    <CardHeader><CardTitle className="flex items-center gap-2"><Layers3 className="size-5 text-warning" />今日巩固（{data.pending} 张）</CardTitle></CardHeader>
    <CardContent className="space-y-2">
      <p className="text-xs text-muted-foreground">短间隔和掉队卡集中在这里，不会唤醒整个宫殿。</p>
      {groups.map(([palaceId, group]) => <div key={palaceId} className="flex items-center justify-between rounded-xl border px-3 py-3"><div><b>{group.title}</b><div className="text-xs text-muted-foreground">{group.uids.length} 张快速巩固</div></div><Button size="sm" variant="outline" disabled={busy === palaceId} onClick={() => void start(palaceId, group.uids)}>{busy === palaceId ? '进入中…' : '开始巩固'}</Button></div>)}
    </CardContent>
  </Card>
}
