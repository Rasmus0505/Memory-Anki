from __future__ import annotations

import threading
from collections.abc import Callable
from typing import Protocol


class EnglishTaskRunner(Protocol):
    def launch(self, task_id: str, target: Callable[[str], None]) -> None:
        ...


class LocalThreadEnglishTaskRunner:
    def launch(self, task_id: str, target: Callable[[str], None]) -> None:
        thread = threading.Thread(
            target=target,
            args=(task_id,),
            name=f"memory-anki-english-{task_id[:8]}",
            daemon=True,
        )
        thread.start()


class InlineEnglishTaskRunner:
    def launch(self, task_id: str, target: Callable[[str], None]) -> None:
        target(task_id)
