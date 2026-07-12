from collections.abc import Iterator

from memory_anki.infrastructure.db._tables._base import get_session

from .workspace_service import BatchWorkspaceService


def workspace_service_dep() -> Iterator[BatchWorkspaceService]:
    session = get_session()
    try:
        yield BatchWorkspaceService(session)
    finally:
        session.close()
