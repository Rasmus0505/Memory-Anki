from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Protocol

MUTATION_ID_HEADER = "X-Memory-Anki-Mutation-ID"
MAX_MUTATION_ID_LENGTH = 80


@dataclass(frozen=True)
class MutationIdentity:
    operation_id: str


def mutation_identity_from_headers(
    headers: Mapping[str, str] | None,
) -> MutationIdentity | None:
    if headers is None:
        return None
    operation_id = str(headers.get(MUTATION_ID_HEADER, "")).strip()
    if not operation_id or len(operation_id) > MAX_MUTATION_ID_LENGTH:
        return None
    return MutationIdentity(operation_id=operation_id)


class MutationResponseStore(Protocol):
    def get(self, identity: MutationIdentity | None) -> Any | None: ...

    def save(self, identity: MutationIdentity | None, payload: Any) -> None: ...
