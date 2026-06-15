"""Palace domain repositories.

Thin encapsulation of ``session.query(...)`` access for Palace/Peg so that
application services depend on a repository abstraction instead of reaching
into the ORM session directly. This establishes the presentation → service →
repository dependency direction called for in the architecture plan.
"""

from .palace_repository import PalaceRepository

__all__ = ["PalaceRepository"]
