import type { ImportStreamDeltaEvent, ImportStreamStatusEvent } from '@/shared/api/contracts'
import { readJsonResponse } from '@/shared/api/jsonResponse'
import { readSseResultResponse } from '@/shared/api/sseResponse'

export interface ImportStreamHandlers {
  onStatus?: (event: ImportStreamStatusEvent) => void
  onDelta?: (event: ImportStreamDeltaEvent) => void
}

export async function readImportJson<T>(response: Response): Promise<T> {
  return readJsonResponse<T>(response, {
    feature: 'Import API',
    nonJsonErrorMessage: 'The server returned a non-JSON error page. Please try again later.',
  })
}

export async function parseImportStreamResponse<T extends { ok: boolean; error?: string }>(
  response: Response,
  handlers?: ImportStreamHandlers,
): Promise<T> {
  return readSseResultResponse<T, ImportStreamStatusEvent, ImportStreamDeltaEvent>(response, {
    feature: 'Import stream API',
    handlers,
    jsonOptions: {
      nonJsonErrorMessage: 'The server returned a non-JSON error page. Please try again later.',
    },
    selectErrorMessage: (payload) => {
      if (payload && typeof payload === 'object' && 'error' in payload) {
        const error = (payload as { error?: unknown }).error
        if (typeof error === 'string' && error.trim()) return error
      }
      return 'Import failed. Please try again later.'
    },
    makeErrorResult: (message) => ({ ok: false, error: message }) as T,
    unsupportedStreamMessage: 'This browser cannot read streaming responses.',
    parseErrorMessage: 'The streaming response data was malformed.',
    missingResultMessage: 'The streaming response did not return a final result.',
  })
}
