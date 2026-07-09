import { Link } from 'react-router-dom'
import { Plus, Sparkles } from 'lucide-react'
import type { DashboardResponse } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'

interface DashboardNewPalacesCardProps {
  data: Pick<DashboardResponse, 'today_new_palace_count' | 'today_new_palaces'>
}

export function DashboardNewPalacesCard({ data }: DashboardNewPalacesCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{`新增章节数量：${data.today_new_palace_count}`}</CardTitle>
        <Link to="/palaces/new">
          <Button size="sm" variant="outline" className="h-8">
            <Plus data-icon="inline-start" />
            新建
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        {data.today_new_palaces.some((subject) => subject.chapter_groups.length > 0 || subject.ungrouped_palaces.length > 0) ? (
          <div className="flex flex-col gap-4">
            {data.today_new_palaces.map((subjectGroup, subjectIndex) => {
              const hasAny = subjectGroup.chapter_groups.length > 0 || subjectGroup.ungrouped_palaces.length > 0
              if (!hasAny) return null
              const showSubjectTitle = data.today_new_palaces.filter((item) => item.subject).length > 1
              return (
                <div key={`${subjectGroup.subject?.id ?? 'ungrouped'}-${subjectIndex}`} className="flex flex-col gap-2">
                  {showSubjectTitle && subjectGroup.subject ? (
                    <div className="text-xs font-medium text-muted-foreground">{subjectGroup.subject.name}</div>
                  ) : null}
                  {subjectGroup.chapter_groups.map((group) => (
                    <div key={group.source_chapter?.id ?? `group-${subjectIndex}`} className="flex flex-col gap-1">
                      <div className="text-sm font-semibold">{group.source_chapter?.name ?? '未关联章节'}</div>
                      <div className="flex flex-col gap-1.5 pl-4">
                        {group.palaces.map((palace) => (
                          <Link
                            key={palace.id}
                            to={`/palaces/${palace.id}/edit`}
                            className="block truncate rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-secondary active:scale-[0.98]"
                          >
                            {palace.title || '未命名宫殿'}
                          </Link>
                        ))}
                      </div>
                    </div>
                  ))}
                  {subjectGroup.ungrouped_palaces.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      <div className="text-sm font-semibold text-muted-foreground">未关联章节</div>
                      <div className="flex flex-col gap-1.5 pl-4">
                        {subjectGroup.ungrouped_palaces.map((palace) => (
                          <Link
                            key={palace.id}
                            to={`/palaces/${palace.id}/edit`}
                            className="block truncate rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-secondary active:scale-[0.98]"
                          >
                              {palace.title || '未命名宫殿'}
                          </Link>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="py-8 text-center text-sm text-muted-foreground">
            今天还没有新增记忆宫殿。
            <div className="mt-3">
              <Link to="/palaces/new">
                <Button variant="outline" size="sm">
                  <Sparkles data-icon="inline-start" />
                  创建一个
                </Button>
              </Link>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
