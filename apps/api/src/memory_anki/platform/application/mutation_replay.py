"""Replay lookup for idempotent HTTP writes.

Nine routers repeated the same three-line preamble::

    mutation_identity = mutation_identity_from_headers(request.headers)
    mutation_store = SqlAlchemyMutationResponseStore(s)
    existing_response = mutation_store.get(mutation_identity)
    if existing_response is not None:
        return existing_response

The helper here keeps that boilerplate in one place without taking over any
business behavior. It performs *only* replay lookup and storage:

- no commits (each caller keeps its own transaction ownership, because routers
  differ in when they commit and some rely on ``UnitOfWork`` inside a use case);
- no business validation of the replayed payload — a caller that must check the
  replay belongs to its entity does that itself;
- no response shaping — the stored payload is returned exactly as persisted.

It lives in ``platform.application`` (framework-free: it depends on the
``MutationResponseStore`` protocol, not on SQLAlchemy or FastAPI) so both the
platform layer and every module presentation layer can use it without creating a
cross-context dependency.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from .mutations import MutationIdentity, MutationResponseStore, mutation_identity_from_headers


@dataclass(frozen=True)
class MutationReplay[ResponseT]:
    """One caller's view of the mutation-replay boundary.

    Attributes:
        identity: The identity derived from the request's mutation-id header, or
            ``None`` when the request carried no usable id. Callers that also
            accept a body-supplied operation id override this before storing.
        store: The response store, so the caller can persist its response in the
            same transaction the use case already owns.
    """

    identity: MutationIdentity | None
    store: MutationResponseStore

    def existing(self) -> ResponseT | None:
        """Return the previously stored response for this identity, if any."""
        stored = self.store.get(self.identity)
        if stored is None:
            return None
        return stored  # type: ignore[return-value]

    def save(self, payload: Any) -> None:
        """Persist ``payload`` as this identity's response.

        Callers pass this as a use case's ``before_commit`` hook so the response
        and the business write commit or roll back together.
        """
        self.store.save(self.identity, payload)


def open_mutation_replay(
    store: MutationResponseStore,
    headers: Mapping[str, str] | None,
) -> MutationReplay[Any]:
    """Derive the request's identity and bind it to ``store``.

    ``store`` is constructed by the caller (presentation builds infrastructure
    adapters), which keeps each router's own ``SqlAlchemyMutationResponseStore``
    symbol — and therefore existing monkeypatching of it — intact.
    """
    return MutationReplay(identity=mutation_identity_from_headers(headers), store=store)
