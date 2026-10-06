# Training Evidence Boundary

## Product Boundary

The primary navigation is exactly `随心`, `知识`, `英语`, `创建`, and `洞察`. Settings remain a system/profile surface.

## Palace Review Evidence

Palace review records one effective four-level rating per unit encounter: `1=忘记`, `2=困难`, `3=记得`, `4=轻松`. The operation stores stable session, unit revision, encounter, and operation identity together with before/after unit state. Before the learner leaves, an amended rating replaces the effective operation from the same frozen baseline. Undo is LIFO and only available while the encounter is open.

There is no node recall evidence, inferred node rating, subtree rating inheritance, node mastery projection, or node FSRS state. Migration `0051_remove_node_review_history` removes the retired node event tables after creating a database backup.

## Quiz Evidence

Quiz attempts remain question-owned evidence with correctness, answer payload, source, and stable question identity. Node bindings classify a question against palace content but never turn a quiz attempt into a palace unit rating. Mind-map toolbar practice, node-bound badges, the freestyle overlay, and freestyle quiz cards share that question identity: a score written from one entry is the same progress the others read. The entry must not keep a private answer ledger. Refresh does not clear 已做. It is cleared only when the learner manually clears it, or the settlement page chooses to clear it.

## Trusted Progress Delivery

Question progress synchronization acknowledges only server-confirmed snapshots. Startup hydration must not mark unsent local answers as synchronized. Changes made during an in-flight save are drained after that request, and visible clients refresh shared progress on focus, reconnect, and a bounded polling interval. Different answer batches are not globally coalesced in the mutation queue.

Clear commands retain their original timestamp and scope. A delayed clear cannot delete a newer answer; clear tombstones remove both completed and unfinished local states. Local action timestamps are monotonically ordered, including a clear followed by an answer within one millisecond. Failed saves retain the local copy and expose an unsynchronized warning rather than claiming successful delivery.

Time investment, learning activity, and mastery evidence are separate facts. A question answer does not automatically rate a review unit, editing does not demonstrate recall, and unknown evidence must not be presented as a verified zero or as poor effort. User-facing reports contain facts without motivational judgments.

## Independent English Evidence

English topic patterns and English Reading vocabulary are independent FSRS cards. Their evidence and schedule do not read or mutate palace review-unit state.
