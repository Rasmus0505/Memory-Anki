import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/shared/components/ui/button'

/** Editor opened from 随心: the round is server-backed, so returning is safe. */
export function FreestyleReturnButton() {
  const navigate = useNavigate()
  return (
    <Button variant="ghost" size="sm" onClick={() => navigate('/freestyle')}>
      <ArrowLeft className="mr-1 size-4" />
      返回随心
    </Button>
  )
}
