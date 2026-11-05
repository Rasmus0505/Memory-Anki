import { Skeleton } from '@/shared/components/ui/skeleton'

/** Tree rows: a few subjects, each with a couple of folded chapters. */
export function PalaceShelfSkeleton() {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border/80 bg-card p-3 shadow-card" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2.5 py-2" style={{ paddingLeft: i % 3 === 0 ? 4 : 28 }}>
          <Skeleton className="size-3.5 rounded-sm" />
          <Skeleton className={i % 3 === 0 ? 'h-4 w-40' : 'h-3.5 w-56'} />
          <Skeleton className="ml-auto h-5 w-14 rounded-full" />
        </div>
      ))}
    </div>
  )
}
