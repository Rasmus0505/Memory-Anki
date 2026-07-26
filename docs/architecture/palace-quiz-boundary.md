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

## Quiz–Mindmap Node Binding（题库结合 / 双向关联）

`quiz.application.node_binding` binds questions to mind-map node UIDs. A question keeps a **single owner palace**; each edge points at a **target** mind-map palace + `node_uid` (cross-palace allowed).

- Storage: `palace_quiz_question_node_bindings`
  - `palace_id` on the edge = **target** mindmap palace (node lives there)
  - Unique: `(question_id, palace_id, node_uid)` so the same string uid on two palaces cannot collide
  - `source` = `ai` | `manual`
- Reverse list: `GET /palaces/{id}/quiz-node-bindings` returns every edge whose **target** is this palace, including foreign-owner questions, with `question_owner_palace_id` / titles / `is_cross_palace`.
- Per-question list: `GET /palace-quiz-questions/{id}/node-bindings` for quiz → 知识点 digression.
- Node search: `GET /quiz-node-search?q=` (global or scoped) for authoring.
- Write paths: `POST .../preview` + `.../apply` (AI, human confirm), `POST .../mutate` (manual; optional `target_palace_id` on each add/remove), `POST .../auto-bind-text` (deterministic text-overlap backfill).
- Merge modes (AI apply): `replace_all` (clear **this target palace’s AI edges**; manual kept) and `fill_unbound`.
- Bidirectional UI:
  - Map/review → `NodeBoundQuizDialog` overlay (owner labels 本宫 / 来自·他宫); green badges = subtree union of **remaining** bound questions (including cross-owner edges); when all session-completed, badge stays with **total count in gray** so the learner can reopen and review prior answers (prev/next keeps resolved states).
  - Quiz → multi-edge picker → `QuizKnowledgeDigressionDialog` full readonly target map + sticky **返回做题** (overlay; attempt draft stays in parent memory; PWA back closes digression first).
