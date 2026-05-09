export const API_BASE = '/api/v1'

export async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    console.error('[API ERROR]', {
      url: `${API_BASE}${url}`,
      method: options?.method || 'GET',
      status: response.status,
      body,
    })
    throw new Error(body || `HTTP ${response.status}`)
  }

  const contentType = response.headers.get('content-type')
  if (contentType?.includes('application/json')) {
    return response.json()
  }
  return response.text() as unknown as T
}
