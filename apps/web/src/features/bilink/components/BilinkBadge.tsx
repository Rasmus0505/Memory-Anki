import { Badge } from '@/shared/components/ui/badge'

export function BilinkBadge({ count }: { count: number }) {
  return (
    <Badge
      variant="secondary"
      className="min-w-6 justify-center rounded-full border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] text-sky-700"
    >
      {count}
    </Badge>
  )
}
