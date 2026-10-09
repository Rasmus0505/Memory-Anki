"""Memory Anki API package."""

from memory_anki.core.windows_wmi import disable_hanging_windows_wmi

# Before any later import can pull in SQLAlchemy. A wedged WMI service makes
# platform.machine() block forever, which freezes launcher and API startup.
disable_hanging_windows_wmi()
