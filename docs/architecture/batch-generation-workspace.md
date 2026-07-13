# Batch Generation Workspace Boundary

The batch generation context owns persistent planning for whole-book and multi-PDF work. It stores uploaded asset metadata, book and section plans, generation-step snapshots, editable drafts, deterministic quality issues, and explicit publish plans.

## Dependency Direction

- Presentation exposes workspace commands and snapshots.
- `batch_generation.application` owns PDF planning, revision checks, stale-operation protection, draft validation, and publish-plan construction.
- Palace and quiz content remain owned by their existing modules. Batch generation may hand off to their public facades or UI routes, but must not mutate their internal tables directly.
- PDF files live below `APP_HOME/batch_generation`; database rows store only paths relative to `APP_HOME`.

## Safety Rules

- Every section carries a stable `operation_id` and revision. Editing a title, page range, output mode, or target invalidates downstream steps and rotates the operation identity.
- Draft writes with stale operation identity are rejected.
- Generated content remains isolated until an explicit publish plan has no unresolved quality or revision conflicts.
- Palace replacement is represented as a versioned replace action; quiz replacement is represented as a question-level merge action.

## First-Version Execution Boundary

The first version provides complete planning, prompt-package inspection, draft persistence, quality checks, and publish-plan review. Actual AI execution and final content publication reuse the existing Palace editor/import and Quiz generation workspaces rather than duplicating those engines.

## Workspace Lifecycle

- Leaving `/batch-generation` returns to the creation root without clearing the active workspace; reopening the batch workspace resumes the saved local workspace ID.
- Deletion is explicit and destructive. The application removes workspace-owned plans, assets, sections, steps, drafts, quality issues, publish plans, and the workspace directory below `APP_HOME/batch_generation`.
- Workspace deletion validates that the resolved asset directory remains directly below the batch-generation root and uses a temporary tombstone directory so a failed database transaction can restore the files.
- Content already published into Palace, Knowledge, or Quiz ownership is not deleted with the batch workspace.
