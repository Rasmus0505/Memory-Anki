import { lazy, type ComponentType } from 'react'

const CHUNK_ERROR_PATTERN =
  /failed to fetch dynamically imported module|loading chunk|importing a module script failed|load failed|failed to fetch/i

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return CHUNK_ERROR_PATTERN.test(message)
}

export class ChunkLoadError extends Error {
  constructor(original: unknown) {
    const originalMessage = original instanceof Error ? original.message : String(original)
    super(`页面资源加载失败（可能是应用刚更新过）：${originalMessage}`)
    this.name = 'ChunkLoadError'
  }
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

export async function loadLazyModuleWithRetry<T extends ComponentType<unknown>>(
  importer: () => Promise<{ default: T }>,
) {
  try {
    return await importer()
  } catch (firstError) {
    await delay(500)
    try {
      return await importer()
    } catch (secondError) {
      if (isChunkLoadError(secondError) || isChunkLoadError(firstError)) {
        throw new ChunkLoadError(secondError)
      }
      throw secondError
    }
  }
}

/**
 * React.lazy wrapper: retries a dynamic import once after 500ms.
 * Persistent chunk-load failures are normalized for route-level refresh guidance.
 */
export function lazyWithRetry<T extends ComponentType<unknown>>(
  importer: () => Promise<{ default: T }>,
) {
  return lazy(() => loadLazyModuleWithRetry(importer))
}
