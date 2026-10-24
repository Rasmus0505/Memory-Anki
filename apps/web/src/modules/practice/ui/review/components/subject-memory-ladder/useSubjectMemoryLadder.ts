import { useQuery } from '@tanstack/react-query'
import { getSubjectMemoryLadderApi, SUBJECT_MEMORY_LADDER_QUERY_KEY } from './api'
import {
  findSubjectLadder,
  type SubjectMemoryLadderKey,
  type SubjectMemoryLadderSubject,
} from './model'

/**
 * 全站共用的记忆间隔数据。书架缩略图、书内筛选和进度页都读同一份缓存，
 * 这样切换页面时不会各发一次 `/review/subject-ladder`。
 */
export function useSubjectMemoryLadder(subjectKey: SubjectMemoryLadderKey | null) {
  const query = useQuery({
    queryKey: SUBJECT_MEMORY_LADDER_QUERY_KEY,
    queryFn: getSubjectMemoryLadderApi,
    staleTime: 30_000,
    enabled: subjectKey != null,
  })
  const subject: SubjectMemoryLadderSubject | null = subjectKey == null
    ? null
    : findSubjectLadder(query.data, subjectKey)
  return {
    ...query,
    subject,
    stages: subject?.stages ?? [],
  }
}
