import { Navigate } from 'react-router-dom'

/** Legacy path: immersive freestyle now lives at `/freestyle`. */
export default function FreestyleSessionPage() {
  return <Navigate to="/freestyle" replace />
}

