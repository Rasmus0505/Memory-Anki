import { describe, expect, it } from 'vitest'
import { bodyActionName } from './requestOutcome'

describe('bodyActionName', () => {
  it('reads the action of a round action body', () => {
    const body = JSON.stringify({ operation_id: 'op', action: 'compress_completed' })
    expect(bodyActionName('/api/v1/freestyle/rounds/r1/actions', body)).toBe('compress_completed')
  })

  it('does not parse bodies of other requests', () => {
    const body = JSON.stringify({ action: 'delete' })
    expect(bodyActionName('/api/v1/palaces/1/editor', body)).toBeUndefined()
  })

  it('returns nothing for a body that is not JSON', () => {
    expect(bodyActionName('/api/v1/freestyle/rounds/r1/actions', 'not json')).toBeUndefined()
    expect(bodyActionName('/api/v1/freestyle/rounds/r1/actions', undefined)).toBeUndefined()
  })
})
