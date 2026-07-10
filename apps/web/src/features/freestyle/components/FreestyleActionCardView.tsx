import { ExternalLink } from 'lucide-react'
import { CONTENT_TYPE_LABELS } from '@/features/freestyle/model/freestyle-labels'
import type { FreestyleActionCard } from '@/shared/api/contracts'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'

export function FreestyleActionCardView({
  card,
  onOpenPalace,
}: {
  card: FreestyleActionCard
  onOpenPalace?: () => void
}) {
  return (
    <div className="mx-auto flex min-h-[min(720px,calc(100vh-150px))] w-full max-w-[calc(100vw-3rem)] flex-col justify-center px-0 py-16 sm:max-w-3xl sm:px-4">
      <div className="rounded-lg border border-white/12 bg-zinc-900/88 p-5 text-zinc-50 shadow-2xl backdrop-blur sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-300">
              {CONTENT_TYPE_LABELS[card.content_type]}
            </div>
            <h2 className="mt-3 text-2xl font-semibold leading-tight sm:text-3xl">{card.title}</h2>
            <div className="mt-3 text-sm text-zinc-300">{card.subtitle}</div>
          </div>
          <Badge className="shrink-0 border-amber-300/30 bg-amber-300/10 text-amber-100">
            {card.reason}
          </Badge>
        </div>
        {card.palace_context ? (
          <div className="mt-5 rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-zinc-300">
            {card.palace_context.resolved_title || card.palace_context.title}
          </div>
        ) : null}
        {card.palace_context && onOpenPalace ? (
          <Button type="button" className="mt-6 w-full sm:w-auto" onClick={onOpenPalace}>
            <ExternalLink className="size-4" />
            查看宫殿
          </Button>
        ) : (
          <Button asChild className="mt-6 w-full sm:w-auto">
            <a href={card.href}>
              <ExternalLink className="size-4" />
              继续
            </a>
          </Button>
        )}
      </div>
    </div>
  )
}
