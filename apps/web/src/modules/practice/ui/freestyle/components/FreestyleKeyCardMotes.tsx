import { useEffect, useRef } from 'react'
import { cue } from '@/shared/fx'

/** Invisible anchor inside a 3-star card; drifts motes off the card only while it is being read. */
export function FreestyleKeyCardMotes({ active }: { active: boolean }) {
  const anchorRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    const card = anchorRef.current?.parentElement
    if (!active || !card) return
    const playback = cue('card.motes', { card })
    return () => playback?.cancel()
  }, [active])

  return <span ref={anchorRef} hidden aria-hidden />
}
