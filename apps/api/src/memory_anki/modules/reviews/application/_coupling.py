"""Architecture notes for read-side coupling around palace reviews.

`reviews.application` is generally the orchestration layer for review flows.
The one approved reverse dependency in this package is `reviews -> palaces`,
and it is intentionally narrow:

- `review_execution_service` may use segment/mini-palace read helpers and log
  builders from `palaces.application`.
- `review_queue_service` may use palace restore helpers plus segment review
  read helpers from `palaces.application`.
- `sessions.application` remains a leaf package and must not depend on either
  `reviews.application` or `palaces.application`.

Do not add new write-side review orchestration to the `reviews -> palaces`
dependency edge. If that edge needs to grow beyond read/log helpers, extract
an adapter boundary first.
"""

