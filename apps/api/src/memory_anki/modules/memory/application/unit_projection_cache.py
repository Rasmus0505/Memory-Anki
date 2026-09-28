"""Process-local memo for per-document review-unit projections.

Keyed by a digest of the document's own content, so a document edited here or
synced in by Syncthing always misses. Nothing is persisted and no business state
is written: this only avoids re-walking unchanged mind-map documents per request.
"""

from __future__ import annotations

import hashlib
import json
import threading
from collections import OrderedDict
from collections.abc import Callable
from typing import Any

_CACHE: OrderedDict[str, Any] = OrderedDict()
_CACHE_LIMIT = 512
_CACHE_LOCK = threading.Lock()


def document_digest(editor_doc: Any) -> str:
    raw = editor_doc if isinstance(editor_doc, str) else json.dumps(editor_doc, sort_keys=True)
    return hashlib.blake2b((raw or "").encode("utf-8"), digest_size=20).hexdigest()


def cached_document_projection[T](editor_doc: Any, compute: Callable[[Any], T]) -> T:
    """Return `compute(editor_doc)`, reusing the result for identical content.

    Callers must treat the returned value as read-only; it is shared across requests.
    """
    key = document_digest(editor_doc)
    with _CACHE_LOCK:
        if key in _CACHE:
            _CACHE.move_to_end(key)
            return _CACHE[key]
    value = compute(editor_doc)
    with _CACHE_LOCK:
        _CACHE[key] = value
        while len(_CACHE) > _CACHE_LIMIT:
            _CACHE.popitem(last=False)
    return value


def clear_unit_projection_cache() -> None:
    with _CACHE_LOCK:
        _CACHE.clear()


__all__ = ["cached_document_projection", "clear_unit_projection_cache", "document_digest"]
