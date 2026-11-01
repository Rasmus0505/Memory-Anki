import { useState, type MouseEvent } from 'react'
import { Star } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { toast } from '@/shared/feedback/toast'
import { setPalaceFavorite, useIsPalaceFavorite } from './palaceFavoriteStore'

/** Yellow filled star used wherever a favorited palace is listed. */
export function PalaceFavoriteStar({
  className,
  title = '已收藏',
}: {
  className?: string
  title?: string
}) {
  return (
    <Star
      aria-label={title}
      data-testid="palace-favorite-star"
      className={cn('size-3.5 shrink-0 fill-current text-warning', className)}
    />
  )
}

/**
 * Toggle on a palace card. The star is always drawn (outline when off) so the
 * card says the palace can be favorited before the first click.
 */
export function PalaceFavoriteButton({
  palaceId,
  className,
  iconClassName,
}: {
  palaceId: number
  className?: string
  iconClassName?: string
}) {
  const favorite = useIsPalaceFavorite(palaceId)
  const [pending, setPending] = useState(false)

  const toggle = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (pending) return
    setPending(true)
    try {
      await setPalaceFavorite(palaceId, !favorite)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '收藏没保存成功')
    } finally {
      setPending(false)
    }
  }

  return (
    <button
      type="button"
      aria-pressed={favorite}
      aria-label={favorite ? '取消收藏这个宫殿' : '收藏这个宫殿'}
      title={favorite ? '取消收藏' : '收藏宫殿'}
      aria-busy={pending || undefined}
      data-testid="palace-favorite-toggle"
      data-favorite={favorite ? 'true' : 'false'}
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-md transition-colors',
        'hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
        pending && 'opacity-60',
        className,
      )}
      onClick={(event) => void toggle(event)}
    >
      <Star
        aria-hidden
        className={cn(
          'size-4 transition-colors',
          favorite ? 'fill-current text-warning' : 'text-muted-foreground/70',
          iconClassName,
        )}
      />
    </button>
  )
}
