import { useEffect } from 'react'
import { retireOwner } from './core/owner'

/**
 * Binds an fx owner to a component identity: when `owner` changes or the
 * component unmounts, every pending step cued under the old owner is cancelled.
 */
export function useFxOwner(owner: string | null | undefined) {
  useEffect(() => {
    if (!owner) return
    return () => retireOwner(owner)
  }, [owner])
  return owner ?? undefined
}
