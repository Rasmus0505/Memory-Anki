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
6. Reusable prompt blocks, block versions, scene defaults, and scene versions are owned by `settings`.
7. Compiled prompts always follow the fixed order: role, task, content fidelity, boundary, output schema, quality, scene instruction, run instruction.
8. Every AI call persists the final compiled text plus selected block keys, block versions, scene version, and run-only instruction.
9. `prompt_override` remains a full-replacement compatibility path; new UI flows prefer `prompt_options` composition.
10. Browser storage may retain model choice and unfinished run instructions, but never overrides the server scene default with a cached full prompt.

## Composition Flow

```text
settings prompt block library
  + active scene default (block keys + scene instruction)
  + optional run selection
  + optional run-only instruction
  -> PromptCatalog.compose
  -> compiled prompt snapshot
  -> AI runtime request/task audit record
```

All blocks are optional. Removing recommended blocks produces deterministic risk warnings but does not prevent generation. Saving a scene default immediately activates a new version and archives the previous version for rollback. Updating a shared block requires acknowledgement of every affected scene.

Legacy customized full prompts are migrated into scene-local `legacy.<prompt_key>` blocks rather than being heuristically split, preserving existing behavior until the user selects the recommended modular combination.

## Migration State

- Palace AI split, mind-map import, palace quiz, English Reading, peg association, AI learning, and batch generation are migrated.
- English course batch and single-sentence translation are migrated through `PromptCatalog`.
