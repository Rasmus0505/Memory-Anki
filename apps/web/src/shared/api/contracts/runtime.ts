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
  app_home_source: 'default' | 'env'
  runtime_snapshot?: string | null
  release_id?: string | null
  frontend_entry_asset?: string | null
  frontend_bundle_hash?: string | null
  storage_mode: string
  managed_storage_items: Array<{
    key: string
    relative_path: string
    kind: string
    required: boolean
    absolute_path: string
  }>
  backup_covered_items: string[]
  active_runtime_instances?: Array<{
    instance_id?: string | null
    pid?: number | null
    channel?: string | null
    startup_mode?: string | null
    workspace?: string | null
    runtime_snapshot?: string | null
    started_at?: string | null
    last_seen_at?: string | null
    age_seconds?: number | null
  }>
}
