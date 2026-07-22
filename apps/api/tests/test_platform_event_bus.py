"""Tests for platform in-process event bus scaffold."""

from __future__ import annotations

from memory_anki.platform.events import EventBus


class _SampleEvent:
    def __init__(self, value: int) -> None:
        self.value = value


def test_event_bus_delivers_to_subscribers() -> None:
    bus = EventBus()
    seen: list[int] = []

    def handler(event: _SampleEvent) -> None:
        seen.append(event.value)

    bus.subscribe(_SampleEvent, handler)
    bus.publish(_SampleEvent(7))
    bus.publish(_SampleEvent(3))
    assert seen == [7, 3]


def test_event_bus_ignores_unrelated_types() -> None:
    bus = EventBus()
    seen: list[int] = []
    bus.subscribe(_SampleEvent, lambda e: seen.append(e.value))
    bus.publish(object())
    assert seen == []
