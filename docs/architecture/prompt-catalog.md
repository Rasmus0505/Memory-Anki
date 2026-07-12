# Prompt Catalog Boundary

Prompt ownership and customization belong to the `settings` context. Business use cases reference stable prompt keys and render them through `platform.application.PromptCatalog`.

## Dependency Direction

```text
business application -> platform.application.PromptCatalog
settings.api -> settings.infrastructure.SettingsPromptCatalog -> settings prompt registry
presentation/composition -> constructs adapter -> injects catalog into use case or worker
```

## Invariants

1. Business contexts do not import settings prompt templates or registry helpers.
2. Template defaults, persisted overrides, aliases, placeholders, and rendering remain settings-owned.
3. Business code owns prompt keys and input variables, not template text.
4. Background workers receive a session-independent catalog adapter; request sessions are never captured by worker threads.
5. AI runtime selection and prompt rendering remain separate ports.

## Migration State

- Palace AI split, mind-map import, palace quiz, and English Reading are migrated.
- English course batch and single-sentence translation are migrated through `PromptCatalog`.
