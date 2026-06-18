import { request } from '@/shared/api/http'
import type {
  PdfImportOptions,
  ReviewSettings,
} from '@/shared/api/contracts'

export function getReviewSettingsApi() {
  return request<ReviewSettings>('/settings/review')
}

export function updateReviewSettingsApi(data: Record<string, string>) {
  return request<ReviewSettings>('/settings/review', {
    method: 'PUT',
    body: JSON.stringify(data),
    persistence: {
      resourceKey: 'settings:review',
      coalesceKey: 'settings:review',
      description: '保存复习设置',
      replayMode: 'auto',
    },
  })
}

export function buildPdfImportOptionsFromSettings(settings: ReviewSettings | null | undefined): PdfImportOptions {
  return {
    quote_original_text_only: String(settings?.import_pdf_quote_original_default ?? 'true') === 'true',
    mount_on_original_leaf_only: String(settings?.import_pdf_mount_leaf_only_default ?? 'true') === 'true',
    preserve_emphasis_marks: String(settings?.import_pdf_preserve_emphasis_default ?? 'true') === 'true',
    semantic_split_long_paragraphs: String(settings?.import_pdf_semantic_split_default ?? 'true') === 'true',
    preserve_line_breaks: String(settings?.import_pdf_preserve_line_breaks_default ?? 'true') === 'true',
  }
}
