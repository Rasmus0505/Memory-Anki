# AI Runtime Boundary

AI model selection is a platform capability, while model catalog administration and persisted settings remain owned by the `settings` context.

## Dependency Direction

```text
business application -> platform.application.AiRuntimeProvider
settings.api -> settings.infrastructure.SettingsAiRuntimeProvider -> settings application registry
presentation/composition -> constructs adapter -> injects provider into business use case
```

Business modules must not import `settings.application` or `settings.infrastructure` to resolve model runtime details. They receive the platform port and operate on `AiRuntimeOptions` plus `ResolvedAiRuntime`.

## Migration State

- Peg association and English listening (DashScope ASR + LLM translation) use the platform runtime port. In-app AI split, PDF/image mind-map import, quiz generation, English reading, and the PDF library were removed; their tables stay.
- English course generation persists non-secret ASR and translation runtime snapshots beside each task, restores current credentials inside workers, and carries stable `ownerId`/`operationId` across retries.
- English presentation composes `SettingsAiRuntimeProvider` through `memory_anki.modules.settings.api`; English application and infrastructure no longer import settings application internals.
- Prompt catalog dependencies are tracked separately from runtime resolution. Listening scenes are `asr_course_transcription` and `translation_course_batch`. Peg association keeps `peg_association_suggestions`.
- The settings UI exposes five top-level workspaces (`access`, `models`, `scenes`, `blocks`, `observability`); prompt composition stays in the prompt settings API, while Provider/model/scenario calls stay in the model settings API.
- English listening resolves credentials through the injected `AiRuntimeProvider` and `infrastructure/llm/openai_compatible.py`. `infrastructure/llm/gateway.py` was removed after its non-English callers were deleted.

## Invariants

1. Provider secrets and catalog ORM models never enter business contexts.
2. Runtime DTOs contain only call-ready values and public metadata.
3. Normalization occurs at the composition boundary before invoking a use case.
4. Business use cases accept a provider explicitly; they do not resolve global settings themselves.
5. Persisted worker snapshots never contain API keys; workers restore the current credential at execution time.
6. Entity-scoped background work persists stable owner and operation identities before launch.
7. `AiRuntimeOptions.prompt_options` carries the modular prompt selection independently from model resolution.
8. Persisted runtime snapshots retain `prompt_options` and the compiled prompt for reproducibility.
9. A Provider API-key row is authoritative even when its value is empty. The empty value is a durable tombstone that blocks environment fallback until the user saves a new key; Base URL keeps its existing empty-value fallback behavior.
10. `PUT /settings/ai-models` with `clear_all_api_keys: true` writes tombstones for every configurable Provider and `mindmap_ai_split_api_key`, so legacy and current call paths stop together.
