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

- Palace association, AI split, and mind-map import jobs use the platform runtime port.
- Import jobs persist a non-secret runtime snapshot and restore current provider credentials through `AiRuntimeProvider.restore` inside the worker.
- Palace presentation routers compose the settings-backed adapter through `memory_anki.modules.settings.api`; request sessions are not captured by background threads.
- English course generation persists non-secret ASR and translation runtime snapshots beside each task, restores current credentials inside workers, and carries stable `ownerId`/`operationId` across retries.
- English presentation composes `SettingsAiRuntimeProvider` through `memory_anki.modules.settings.api`; English application and infrastructure no longer import settings application internals.
- Prompt catalog dependencies are tracked separately from runtime resolution.

## Invariants

1. Provider secrets and catalog ORM models never enter business contexts.
2. Runtime DTOs contain only call-ready values and public metadata.
3. Normalization occurs at the composition boundary before invoking a use case.
4. Business use cases accept a provider explicitly; they do not resolve global settings themselves.
5. Persisted worker snapshots never contain API keys; workers restore the current credential at execution time.
6. Entity-scoped background work persists stable owner and operation identities before launch.
7. `AiRuntimeOptions.prompt_options` carries the modular prompt selection independently from model resolution.
8. Persisted runtime snapshots retain `prompt_options` and the compiled `prompt_override` for reproducibility, while remaining compatible with historical snapshots that only contain `prompt_override`.
