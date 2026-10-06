import { Navigate, useParams } from 'react-router-dom'
import { ImmersiveFreestylePage } from '@/modules/practice/public'

/** Shelf review reuses the freestyle feed, but stays on this palace route. */
export default function PalaceReviewPage() {
  const palaceId = Number(useParams().id)
  if (!Number.isSafeInteger(palaceId) || palaceId <= 0) {
    return <Navigate to="/palaces" replace />
  }
  return <ImmersiveFreestylePage lockedPalaceId={palaceId} />
}
