/**
 * Shared helpers for parsing Server-Sent Events (SSE) streams.
 */

/**
 * Parse a single SSE event block (the text between two blank lines) into its
 * `event` name and concatenated `data` payload. Returns `null` for empty or
 * data-less blocks, matching the EventSource semantics.
 */
export function parseSseEventBlock(block: string): { event: string; data: string } | null {
  const lines = block
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
  if (lines.length === 0) return null
  let event = 'message'
  const dataLines: string[] = []
  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim()
      continue
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim())
    }
  }
  if (dataLines.length === 0) return null
  return { event, data: dataLines.join('\n') }
}
