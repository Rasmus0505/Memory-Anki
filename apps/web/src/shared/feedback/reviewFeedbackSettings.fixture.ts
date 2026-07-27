import {
  sanitizeReviewFeedbackSettings,
  type ReviewFeedbackSettings,
} from '@/shared/feedback/reviewFeedbackSettings'

/**
 * Build a complete settings object for tests from a partial override.
 *
 * Tests used to inline the whole struct, so every field added or removed meant
 * editing unrelated test files. Running the override through sanitize keeps
 * fixtures valid across schema changes for free.
 */
export function createReviewFeedbackSettingsFixture(
  overrides: Partial<ReviewFeedbackSettings> = {},
): ReviewFeedbackSettings {
  return sanitizeReviewFeedbackSettings({
    ...sanitizeReviewFeedbackSettings({}),
    ...overrides,
  })
}
