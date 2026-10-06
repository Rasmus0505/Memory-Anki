# Durable article reading cursor

Content owns reading position independently of the mind-map document. Scrolling does not change `editor_doc`, document revision, save token, undo history, review evidence, or document query caches.

## Persistence and transport

`modules/content/application/article_reading.py` defines the command/response schemas and `ArticleReadingStore` port. Presentation composes `SqlAlchemyArticleReadingStore` and the platform `UnitOfWork`. The adapter uses the existing cross-cutting Config table with `article.reading.<owner_id>` keys. Settings has no generic public Config service to reuse (its public adapters are AI-specific); no private settings imports or new dependency edge are introduced. No migration is required.

GET and PUT `/api/v1/content/article-reading/{owner_id}` accept canonical owners `palace:<positive id>` and `knowledge-subject:<positive id>`. They return `{owner_id, cursor}`; an absent cursor is null. GET performs no writes, document repairs, or initialization. Positions reference a stable `node_uid`, with optional fractional `block_offset` between 0 and 1. The UI resolves the UID against the current document; a deleted UID is not repaired by a read request.

PUT includes `node_uid`, `block_offset`, `client_id`, `operation_id`, `client_sequence`, and `expected_revision` (0 for first save). A successful save returns a server UTC `updated_at` and incremented independent `revision`. Current-operation identical retries are idempotent. Same-client non-increasing sequences and mismatched expected revisions return HTTP 409 with `detail.code = article_reading_conflict` and `detail.remoteSnapshot`. The adapter performs conditional insert/update, preventing concurrent stale requests from replacing newer positions. Revision and timestamp are monotonic; node order is not, so reading backwards remains valid.

## Frontend

`modules/content/api/articleReadingApi.ts` validates owner-scoped responses and exports get/save functions through content's public entry. Shared contracts live in `shared/api/contracts/articleReading.ts`. Cursor PUT requests use `persistence: false`; stale positions must not be replayed through the generic offline mutation queue.

`useArticleReadingProgress(ownerId)` returns `resumeCursor`, `recordProgress(uid, offset)`, and `error`. Resume is offered explicitly, never an automatic jump. Writes debounce 500ms and serialize, carrying a tab client ID, monotonic sequence, and unique operation ID. Owner context and operation guards ignore stale completions; switching owners aborts pending requests and timers. Local fallback uses separate `article.reading.local.<owner>` browser keys; client identity/sequence survive remounts in session storage. On save uncertainty the hook re-reads the server and does not replay the failed position. Pending debounced writes at unmount remain in the local fallback; they are not force-sent as stale background writes.

Runtime data location and external Syncthing behavior remain unchanged. This feature adds no file synchronization.

## Verification

Isolated backend tests create only an in-memory Config table. They cover pure reads, scope isolation, CAS, backward movement, monotonic timestamps/revisions, idempotency, stale writes, and HTTP validation. Frontend tests cover the bridge, stale owner loads, debounce/serialization, resume without writes, and local fallback. `check_article_reading_cursor_boundary` protects separate persistence, GET purity, and the absence of document writes/invalidation and offline replay.
