import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarClock, Layers3 } from 'lucide-react'
import {
  getDueReviewUnitsApi,
  startUnitReviewSessionApi,
  type ReviewUnitDto,
} from '@/modules/practice/public'
import { buildReviewSessionPath } from '@/modules/memory/public'
import { InsightsSectionNav } from '@/pages/insights/InsightsSectionNav'
import { PageIntro } from '@/shared/components/layout/PageIntro'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { EmptyState, ErrorState, LoadingState } from '@/shared/components/state-placeholders'

interface PalaceDueGroup {
  palaceId: number
  palaceTitle: string
  units: ReviewUnitDto[]
}

export function groupDueUnitsByPalace(units: ReviewUnitDto[]): PalaceDueGroup[] {
  const groups = new Map<number, ReviewUnitDto[]>()
  for (const unit of units) {
    const current = groups.get(unit.palace_id) ?? []
    current.push(unit)
    groups.set(unit.palace_id, current)
  }
  return [...groups.entries()]
    .map(([palaceId, palaceUnits]) => ({
      palaceId,
      palaceTitle: palaceUnits[0]?.palace_title || `宫殿 #${palaceId}`,
      units: palaceUnits.sort((left, right) => left.due_date.localeCompare(right.due_date)),
    }))
    .sort((left, right) => left.units[0].due_date.localeCompare(right.units[0].due_date))
}

export default function ReviewOverview() {
  const navigate = useNavigate()
  const [units, setUnits] = useState<ReviewUnitDto[] | null>(null)
  const [startingPalaceId, setStartingPalaceId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void getDueReviewUnitsApi()
      .then((items) => {
        if (active) setUnits(items)
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : '加载单元复习队列失败')
      })
    return () => {
      active = false
    }
  }, [])

  const groups = useMemo(() => groupDueUnitsByPalace(units ?? []), [units])

  async function start(palaceId: number) {
    setStartingPalaceId(palaceId)
    setError(null)
    try {
      const session = await startUnitReviewSessionApi(palaceId)
      navigate(buildReviewSessionPath(session.id))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建单元复习会话失败')
    } finally {
      setStartingPalaceId(null)
    }
  }

  if (error && !units) return <ErrorState title="复习队列加载失败" description={error} />
  if (!units) return <LoadingState text="正在读取到期复习单元…" />

  return (
    <div className="space-y-5">
      <InsightsSectionNav />
      <PageIntro
        eyebrow="永久标记单元"
        title="复习安排"
        description="每座宫殿按永久标记边界切分；困难或忘记的单元会留在本轮继续重练。"
      />
      {error ? <ErrorState title="无法开始复习" description={error} /> : null}
      {groups.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="size-8" />}
          title="当前没有到期单元"
          description="没有永久标记的宫殿不会进入这里；请先在知识书架完成标记。"
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {groups.map((group) => (
            <Card key={group.palaceId}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Layers3 className="size-5 text-primary" />
                  {group.palaceTitle}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-sm text-muted-foreground">
                  {group.units.length} 个到期单元 · 最早 {group.units[0].due_date}
                </div>
                <div className="flex flex-wrap gap-2">
                  {group.units.map((unit) => (
                    <span key={unit.id} className="rounded-md border bg-muted/30 px-2 py-1 text-xs">
                      {unit.title || '剩余水流单元'}
                    </span>
                  ))}
                </div>
                <Button className="w-full" disabled={startingPalaceId === group.palaceId} onClick={() => void start(group.palaceId)}>
                  {startingPalaceId === group.palaceId ? '正在创建会话…' : '立即复习'}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
