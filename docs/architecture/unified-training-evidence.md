# Training Evidence Boundary

## Product Boundary

The primary navigation is exactly `随心`, `知识`, `英语`, `创建`, and `洞察`. Settings remain a system/profile surface.

## Palace Review Evidence

Palace review records one effective four-level rating per unit encounter: `1=忘记`, `2=困难`, `3=记得`, `4=轻松`. The operation stores stable session, unit revision, encounter, and operation identity together with before/after unit state. Before the learner leaves, an amended rating replaces the effective operation from the same frozen baseline. Undo is LIFO and only available while the encounter is open.

There is no node recall evidence, inferred node rating, subtree rating inheritance, node mastery projection, or node FSRS state. Migration `0051_remove_node_review_history` removes the retired node event tables after creating a database backup.

## Quiz Evidence

Quiz attempts remain question-owned evidence with correctness, answer payload, source, and stable question identity. Node bindings classify a question against palace content but never turn a quiz attempt into a palace unit rating.

## Independent English Evidence

English topic patterns and English Reading vocabulary are independent FSRS cards. Their evidence and schedule do not read or mutate palace review-unit state.
