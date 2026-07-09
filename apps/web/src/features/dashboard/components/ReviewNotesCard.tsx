import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getRecentReviewNotesApi, type ReviewNoteItem } from '@/features/dashboard/api'
import { Badge } from '@/shared/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'

function formatReviewDate(value: string | null) {
  if (!value) return '未记录'
  return value.slice(5)
}

export function ReviewNotesCard() {
  const [items, setItems] = useState<ReviewNoteItem[] | null>(null)

  useEffect(() => {
    let cancelled = false
    getRecentReviewNotesApi(10)
      .then((payload) => {
        if (!cancelled) setItems(payload.items)
      })
      .catch(() => {
        if (!cancelled) setItems([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!items?.length) return null

  return (
    <Card className="min-w-0 border-border/70">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">最近复盘</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((item) => (
          <div key={item.id} className="min-w-0 rounded-lg border border-border/70 px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <Badge variant="outline" className="shrink-0">
                {formatReviewDate(item.review_date)}
              </Badge>
              <Link
                to={`/palaces/${item.palace_id}`}
                className="min-w-0 truncate text-sm font-medium text-foreground hover:text-primary"
              >
                {item.palace_title || '未命名宫殿'}
              </Link>
            </div>
            <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">
              {item.note}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
