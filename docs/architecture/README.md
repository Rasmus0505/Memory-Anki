# Memory Anki Architecture

## Principles
- High cohesion inside a module, low coupling across modules.
- Runtime data never lives in the repository.
- Feature behavior is expressed through explicit contracts instead of duplicated ad hoc DTOs.
- Frontend persists only UI-local temporary state; business state belongs to backend storage.
- Every business datum has one owning backend module; cross-module access goes through public application services, contracts, or explicit `core`/`shared` abstractions.
- Generated output and tool caches are not source. Do not commit package metadata, local runtime data, lockfiles from unsupported package managers, or build artifacts.

## Backend Shape
- `app`: bootstrap, DI wiring, router registration.
- `core`: config, logging, errors, clocks, shared helpers.
- `infrastructure`: database engine, filesystem adapters, external integrations.
- `modules/*/{domain,application,infrastructure,presentation}`: feature boundaries.
- `domain`: pure business model, value types, and policies. It must not know FastAPI, SQLAlchemy sessions, filesystem paths, environment variables, clocks, or external AI gateways.
- `application`: commands, queries, orchestration, and projections. It may depend on domain rules and explicit ports/adapters, not on another module's private infrastructure.
- `presentation`: HTTP schemas, routers, serializers, and request/response compatibility. API DTOs belong here or in application projections, not in `domain`.
- Cross-module reads or writes must use the owning module's public application service, contract, or projection. Do not import another module's `infrastructure`, `presentation`, private leaf service, repository, SQLAlchemy model, or helper unless the exception is documented with owner, reason, risk, and tests.

## Frontend Shape
- `app`: providers, router, top-level shell wiring.
- `features`: user-facing behaviors composed from entities.
- `entities`: domain-facing API/model adapters.
- `shared`: reusable UI, helpers, infrastructure wrappers.
- `app/router` owns route wiring, lazy imports, redirects, and residency/cache policy. Business pages and page-local components belong in `features/*`.
- Dashboard and palace catalog/list/shelf implementations live in `features/dashboard` and `features/palace-catalog`; `app/router` may import them but must not host their page code, view settings, tests, or page components.
- Feature-specific API wrappers live with their owning feature or entity. `features/dashboard/api`, `features/review/api`, `features/profile/api`, `features/voice-coach/api`, `entities/preferences/api`, `entities/palace/api`, `entities/mini-palace/api`, `entities/palace-segment/api`, `entities/knowledge-import/api`, and `entities/quiz/api` own their endpoints; do not recreate broad business modules under `shared/api/modules`.
- Quiz question and generation endpoints are entity-owned in `entities/quiz/api`. Features such as knowledge editing and palace quiz can consume that entity API, but they must not import another feature's API module just to reach quiz data.
- Palace list, editor, practice, version, chapter-link, attachment, focus, and palace state endpoints are entity-owned in `entities/palace/api`. Mini-palace endpoints are owned by `entities/mini-palace/api`; palace segment endpoints are owned by `entities/palace-segment/api`. Import preview, streaming parse, and recoverable import-job endpoints are entity-owned in `entities/knowledge-import/api`; palace editing consumes them without making import jobs part of the palace API surface.
- Production code should import API wrappers through the owning public barrel, such as `entities/palace/api`, `entities/mini-palace/api`, and `entities/palace-segment/api`. Do not make internal API file names part of a cross-module contract; tests may still mock a specific internal file when that is the narrowest honest seam.
- Mind-map import workflow UI, history, batch/PDF orchestration, and apply/undo controller live in `features/mindmap-import`. Palace editing and knowledge editing consume its public barrel; they must not import `mindmap-import` internals or keep import workflow code under `features/palace-edit`.
- `shared` must remain behavior-agnostic. If a helper knows a feature's workflow, terminology, state machine, or storage key, it belongs in the owning `feature` or `entity`.
- Browser preferences that are used by multiple features belong in `entities/preferences/model`; feature components can render controls, but the persistence model has one owner.
- `shared/preferences` owns only generic client-preference transport, cache, migration, and store primitives. Concrete schemas, defaults, storage keys, sanitizers, and exports belong in `entities/preferences/model` or the owning shared component module. Backend `client_preferences.*` is the authority after initialization; `localStorage` is migration input or truly UI-local state, not a second long-term source of truth.
- `shared/lib/localStorage` is only a backward-compatible hook facade. It must not hard-code feature storage keys, look up key ownership through a registry, or know backend preference keys implicitly; callers or `entities/preferences/model` provide explicit preference ownership.
- Frontend config contracts are part of architecture: `apps/web/package.json` must stay npm-only, `typecheck` must be `tsc -b --noEmit`, `openapi:types` must target `127.0.0.1:8012`, and `vite.config.ts` must proxy `/api` to the same backend port.

## Rules
- Presentation can depend on application and contracts, never on another module's infrastructure internals.
- Shared utilities must stay behavior-agnostic.
- New persisted business data requires backend ownership plus tests.
- Any new module must include contracts, service tests, and boundary-safe imports.
- API contracts are the front/back single source of truth. Interface changes must update backend schemas, frontend contracts or generated types, and contract tests together.
- New modules/features should be created only for new data ownership, independent lifecycle, or a stable public contract. Otherwise extend the owning module.
- Database migrations default to forward-compatible changes. Destructive migrations require an explicit marker, reason, migration path, and runtime data risk note.
- File splitting follows boundaries: domain policy, application command/query, presentation schema/router, frontend model/hook/component. Do not split files by arbitrary line ranges into vague helpers.
- Cross-boundary changes must be explicit in review notes: changed contracts, storage layout, runtime layout, generated types, or architecture-check rules.
- Runtime/config contracts such as `apps/api/runtime-contract.json`, `apps/api/storage-layout.json`, `apps/web/package.json`, `apps/web/vite.config.ts`, and generated API contracts must change together with `tools/check_architecture.py` and focused tests.
- Refactors must remove replaced facades, old entrypoints, duplicate DTOs, stale config keys, orphan tests, and generated artifacts. Temporary compatibility shims need an owner, scope, removal condition, and regression test.
- Use `tools/check_architecture.py` as the executable boundary contract. If a new architectural invariant matters, encode it there before relying on convention.

## AI Coding Prompt
Use this short prompt for future AI coding sessions:

> Before editing, read `docs/architecture/README.md`, `CONTRIBUTING.md`, and the relevant owning module. Preserve backend module ownership, frontend FSD layers, and contracts as the single source of truth; do not reach through another owner’s private internals, import private infrastructure, or copy DTOs for convenience. If sharing is needed, move code to the narrowest legal owner or public contract. If a boundary must be bent, explain why, name the risk, and add the smallest useful test.
> Read the current `git status` first, keep parallel work intact, and do not revert other people's changes. Prefer the narrowest stable owner: feature-only UI/API stays in `features/*`, cross-feature domain behavior belongs in `entities/*`, and `shared/*` is for behavior-agnostic infrastructure only. Use public contracts instead of private internals, and when a new abstraction is useful, give it an owner, a deletion condition, and a test.
