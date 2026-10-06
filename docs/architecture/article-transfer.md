# Article transfer boundary

The article interchange parser under content UI produces canonical documents and opaque quiz payloads. `content/application/articleTransfer.ts` bridges those values to the scoped backend API without importing the dialog, editor Surface, or shared document session. The host supplies a captured owner/operation identity, clean document, revision, and a callback reading current host state. Completion returns `stale: true` after navigation or any intervening edit; callers must not hydrate it into the shared session. Dirty targets are rejected before network calls.

## Commands and comparison

`compareArticleTransfer` provides added/removed/changed node UID lists and source-owner/revision agreement for the dialog. `applyArticleTransfer` supports create, append subtree, replace, and same-owner update. Replace and update require explicit comparison confirmation. Update requires matching `palace:<id>` source owner and the package base revision equal to the current server revision. Every target mutation also requires an explicit expected revision. There is no stale-overwrite bypass.

The endpoints are `GET /palaces/{id}/article-package`, `POST /content/article-transfer` for creation, and `POST /palaces/{id}/article-transfer` for target mutations. They do not consume Peg import dialect or full-database archives. Destructive commands are not queued for background replay after ambiguous network failures.

Create, append and replace generate fresh node UIDs and drop imported numeric projection identities. Same-owner update preserves UIDs but restores numeric IDs only from the current target document. Append attaches the imported root under the explicitly selected current node. Bound target nodes cannot disappear; the quiz public guard rejects such replacements, including bindings retained for deleted question history.

## Transactions and assets

The content application composes existing palace creation, canonical document save and attachment services with a flush-only infrastructure UnitOfWork participant. The outer UnitOfWork commits once after quiz import succeeds. Any failure rolls back all database records and removes staged attachment files. After owner/revision/binding validation and before the first existing-target mutation, the route invokes the existing rescue snapshot service (database, quiz records and attachments); backup failure aborts the command. Tests inject no live backup callback. Existing target palace versions are also captured before mutation; ordinary rolling backup runs after successful response.

Package assets use the existing palace attachment storage/service. Transfer accepts bounded base64 PNG, JPEG, GIF and WebP bytes with signature checks; SVG and unsupported media produce explicit errors. Source references are remapped to new `/api/v1/attachments/<id>` URLs. Package-local or foreign attachment references left unresolved in documents or quiz payloads reject the transaction. Export only downloads internal attachment URLs; external assets fail explicitly rather than disappearing from the package.

Quiz question content and binding relations travel only through `quiz.api.export_article_quiz`, `import_article_quiz`, and `validate_article_quiz_target`. The quiz context owns its portable UUID contract and all question persistence. Same-owner imports also validate the quiz `source_revision` before any document or segment mutation, so independent question edits cannot be overwritten by a still-current document revision. Segment descriptors travel without numeric IDs, remap their node UIDs and are restored by content before quiz relations are attached. Exact existing descriptors are reused; ambiguous duplicates and removal of nodes referenced by existing segments are rejected. Numeric source IDs are not accepted as target bindings. Unsupported relation closures or noncanonical question payloads return validation errors; article transfer must display them and preserve the current draft.

## Validation

`test_article_package.py` uses temporary SQLite and filesystem fixtures for fresh UID identity, stale/missing revision rejection, owner and confirmation guards, append/update behavior, foreign attachments and rollback cleanup. `articleTransfer.test.ts` checks dirty preservation, same-owner comparison, unsupported quiz rejection, stale async completion and revision-safe export. No test accesses the configured live database or starts a replacement runtime.
