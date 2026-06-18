export function normalizePreviewEditorDoc(
  value: Record<string, unknown> | string | null,
): Record<string, unknown> | string {
  if (!value) return ''
  return value
}

export function normalizePreviewConfig(
  value: Record<string, unknown> | string | null,
): Record<string, unknown> {
  if (!value) {
    return {
      theme: { template: 'avocado', config: {} },
      layout: 'logicalStructure',
      config: {},
    }
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>
      return {
        theme: {
          template: 'avocado',
          config: {},
          ...((parsed.theme as Record<string, unknown> | undefined) ?? {}),
        },
        layout: parsed.layout ?? 'logicalStructure',
        config: (parsed.config as Record<string, unknown> | undefined) ?? {},
        ...parsed,
      }
    } catch {
      return {
        theme: { template: 'avocado', config: {} },
        layout: 'logicalStructure',
        config: {},
      }
    }
  }
  return {
    theme: {
      template: 'avocado',
      config: {},
      ...((value.theme as Record<string, unknown> | undefined) ?? {}),
    },
    layout: value.layout ?? 'logicalStructure',
    config: (value.config as Record<string, unknown> | undefined) ?? {},
    ...value,
  }
}
