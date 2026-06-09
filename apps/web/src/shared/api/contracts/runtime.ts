export interface RuntimeInfo {
  channel: string
  commit: string | null
  short_commit: string | null
  runtime_generation: number
  declared_runtime_generation: number
  min_supported_generation: number
  max_supported_generation: number
  last_started_at: string | null
  app_home: string
  storage_mode: string
  managed_storage_items: Array<{
    key: string
    relative_path: string
    kind: string
    required: boolean
    absolute_path: string
  }>
  backup_covered_items: string[]
}
