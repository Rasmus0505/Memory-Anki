# Palace Quiz Boundary

Palace Quiz owns question generation, validation, grouping, persistence, and quiz feedback. It may reference Palace identities and read projections, but Palace implementation modules are not shared libraries.

## Dependency Direction

```text
palace_quiz.application -> palaces.api
palace_quiz.application -> mindmap_document.api
palace_quiz.application -> platform.application AI contracts
palace_quiz.application -> platform.application UnitOfWork
```

Generic model-response helpers such as multimodal image content encoding and balanced JSON-object extraction live in `platform.application.ai_content`. Generic mind-map traversal lives in `mindmap_document`. Palace-specific title, explicit chapter scope, and mini-palace node parsing are intentionally exported through `palaces.api`.

The quiz application must never import `palaces.application`, `palaces.infrastructure`, or private mind-map document modules.

## Mutation Boundary

The four idempotent question mutations are composed by `palace_quiz.application.question_mutation_commands`. Presentation extracts the mutation identity from headers and constructs the platform SQLAlchemy adapters; the application command performs question, OCR-source, and mutation-response writes in one `UnitOfWork` transaction.

Low-level question and OCR write helpers may flush for command composition but must not commit when invoked by a mutation command. The command owns the single commit, so a failure while storing the mutation response rolls back every business write. Palace Quiz must not import the transitional `memory_anki.modules.persistence` context.

## Quiz–Mindmap Node Binding（题库结合）

`palace_quiz.application.node_binding` binds palace-owned questions to mind-map node UIDs via AI analysis or manual edits.

- Storage: `palace_quiz_question_node_bindings` (question_id + node_uid unique; `source` = `ai` | `manual`).
- API: `GET .../quiz-node-bindings`, `POST .../preview`, `POST .../apply`, `POST .../mutate` (manual add/remove).
- Preview is AI-only and non-destructive; apply writes after user confirmation.
- Merge modes: `replace_all` (clear AI edges then write accepted; manual edges kept) and `fill_unbound` (keep existing, only bind unbound questions).
- Manual panel (`mutate`) upserts edges with `source=manual` and can delete any edge.
- Frontend: palace editor overflow「题库结合」; green count badges also on formal review (`MindMapReviewFlow`) and palace learn/edit. Counts = subtree union of bound questions minus session-completed IDs.
