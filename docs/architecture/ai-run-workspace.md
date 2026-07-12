# AI Run Workspace Boundary

All user-triggered AI work follows a preview, execute, and accept/apply lifecycle. The existing AI runtime and prompt catalog remain separate platform ports; the run workspace records user-visible workflow state and never owns provider secrets.

## Required lifecycle

1. Preview the effective prompt, selected model, thinking mode, and included context before execution.
2. Execute with stable `owner_id` and `operation_id`; persist the request snapshot, resolved public model metadata, result, and failure state.
3. Present the result without mutating Palace, Mind Map, Quiz, English, or Knowledge entities.
4. Require an explicit `accepted` or `applied` transition before a business facade writes generated content.
5. Allow history loading for reruns, soft deletion, restore, and deliberate permanent purge.

## Context selection

- Mind-map and quiz-bank content are explicit context selections, not hidden prompt concatenation.
- Each selection records enabled state, source entity, source revision, rendered content, and truncation state.
- Business contexts expose content through public facades or ports; the workspace must not query another context's tables.
- Relevant contexts may default to enabled, but the user can disable them before execution and preview the actual payload.

## Ownership

- `ai_learning` currently hosts the persisted run-workspace lifecycle and remains framework-free below presentation.
- `settings` owns model catalogs and prompt templates.
- AI call logs own provider-call diagnostics; run records own preview, result, application, rerun, and deletion state.
- Feature UIs may compose the shared workspace but must not auto-save an AI result immediately after generation.
