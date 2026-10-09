"""Keep Windows startup off a wedged WMI service.

CPython's ``platform.machine()`` and ``platform.win32_ver()`` call
``_wmi.exec_query`` and never time out. SQLAlchemy calls ``platform.machine()``
while it is being imported. On a machine whose WMI provider is damaged or
spinning, that call blocks forever. ``start-all.bat`` then sits on
"Checking for updates..." because ``pwa_server.prepare`` holds the service
lock inside ``_database_at_alembic_head`` and prints nothing.

``platform`` already falls back to ``sys.getwindowsversion()`` and the
``PROCESSOR_*`` environment variables when ``_wmi`` is unavailable. Clearing
it is that supported fallback, not a change to architecture detection.
"""

from __future__ import annotations

import os


def disable_hanging_windows_wmi() -> None:
    if os.name != "nt":
        return
    import platform

    # Private CPython attribute, so typeshed does not declare it. Clearing it
    # selects platform's documented non-WMI fallback for machine()/win32_ver().
    platform._wmi = None  # type: ignore[attr-defined]
