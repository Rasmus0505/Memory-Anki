import { useQuery } from '@tanstack/react-query'
import { getLearningProgress } from '../api/learningProgressApi'

/** One read-only snapshot; scope changes are local, so late requests cannot cross scopes. */
export function useLearningProgress() {
  return useQuery({
    queryKey: ['dashboard', 'learning-progress'],
    queryFn: getLearningProgress,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: 1,
  })
}
