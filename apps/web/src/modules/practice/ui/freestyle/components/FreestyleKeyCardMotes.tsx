import { useEffect, useRef } from 'react'
import { startKeyCardMotes } from './freestyleParticleScenes'

/** Invisible anchor inside a 3-star card; drifts motes off the card only while it is being read. */
export function FreestyleKeyCardMotes({ active }: { active: boolean }) {
  const anchorRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    const card = anchorRef.current?.parentElement
    if (!active || !card) return
    return startKeyCardMotes(card)
  }, [active])

  return <span ref={anchorRef} hidden aria-hidden />
}
