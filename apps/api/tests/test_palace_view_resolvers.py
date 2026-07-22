from types import SimpleNamespace

from memory_anki.modules.content.application.palace_view_resolvers import (
    _palace_outline_sort_key,
)


def test_palace_outline_sort_key_can_compare_bound_and_unbound_palaces():
    chapter = SimpleNamespace(sort_order=1, id=10, parent=None)
    bound = {"id": 1, "_primary_chapter": chapter}
    unbound = {"id": 2, "_primary_chapter": None}

    assert sorted([unbound, bound], key=_palace_outline_sort_key) == [bound, unbound]
