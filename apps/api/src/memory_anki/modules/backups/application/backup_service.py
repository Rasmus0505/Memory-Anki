from __future__ import annotations

from memory_anki.core.config import FULL_BACKUPS_DIR as FULL_BACKUPS_DIR
from memory_anki.modules.backups.application import backup_lifecycle as _backup_lifecycle
from memory_anki.modules.backups.application.backup_lifecycle import (
    ROLLING_EDIT_BACKUP_INTERVAL as ROLLING_EDIT_BACKUP_INTERVAL,
)
from memory_anki.modules.backups.application.backup_lifecycle import (
    create_full_backup as create_full_backup,
)
from memory_anki.modules.backups.application.backup_lifecycle import (
    create_rescue_snapshot as create_rescue_snapshot,
)
from memory_anki.modules.backups.application.backup_lifecycle import (
    create_shutdown_backup as create_shutdown_backup,
)
from memory_anki.modules.backups.application.backup_lifecycle import (
    ensure_daily_backup as ensure_daily_backup,
)
from memory_anki.modules.backups.application.backup_lifecycle import (
    list_backups as list_backups,
)
from memory_anki.modules.backups.application.backup_lifecycle import (
    maybe_create_periodic_backup as maybe_create_periodic_backup,
)
from memory_anki.modules.backups.application.backup_lifecycle import (
    maybe_create_rolling_backup as maybe_create_rolling_backup,
)
from memory_anki.modules.backups.application.backup_lifecycle import (
    restore_database_backup as restore_database_backup,
)
from memory_anki.modules.backups.application.backup_lifecycle import (
    start_periodic_backup_loop as start_periodic_backup_loop,
)
from memory_anki.modules.backups.application.backup_lifecycle import (
    stop_periodic_backup_loop as stop_periodic_backup_loop,
)
from memory_anki.modules.backups.application.editor_safety import (
    MAX_SAFE_REMAINING_NODES as MAX_SAFE_REMAINING_NODES,
)
from memory_anki.modules.backups.application.editor_safety import (
    MIN_DANGEROUS_NODE_COUNT as MIN_DANGEROUS_NODE_COUNT,
)
from memory_anki.modules.backups.application.editor_safety import (
    count_editor_doc_nodes as count_editor_doc_nodes,
)
from memory_anki.modules.backups.application.editor_safety import (
    is_dangerous_structure_change as is_dangerous_structure_change,
)

from .backup_palace_restore import (
    recover_palaces_from_git_snapshot,
    restore_palace_from_backup,
    restore_palace_version,
)
from .backup_palace_snapshots import (
    PalaceEditorSnapshotSummary,
    compare_palace_editor_snapshots,
    export_palace_snapshot_comparison,
    get_backup_palace_editor_snapshot,
    get_current_palace_editor_snapshot,
    get_palace_version_snapshot,
    palace_editor_snapshot_to_dict,
)
from .backup_palace_versions import (
    create_effective_palace_version,
    create_palace_version,
    get_palace_version_detail,
    list_palace_versions,
    cleanup_duplicate_palace_versions,
    should_create_editor_snapshot,
)


def _sync_facade_dependencies() -> None:
    _backup_lifecycle.FULL_BACKUPS_DIR = FULL_BACKUPS_DIR


def maybe_create_interval_backup(*args, **kwargs):
    _sync_facade_dependencies()
    return _backup_lifecycle.maybe_create_interval_backup(*args, **kwargs)

__all__ = [
    "MAX_SAFE_REMAINING_NODES",
    "MIN_DANGEROUS_NODE_COUNT",
    "PalaceEditorSnapshotSummary",
    "ROLLING_EDIT_BACKUP_INTERVAL",
    "cleanup_duplicate_palace_versions",
    "compare_palace_editor_snapshots",
    "count_editor_doc_nodes",
    "create_effective_palace_version",
    "create_full_backup",
    "create_palace_version",
    "create_rescue_snapshot",
    "create_shutdown_backup",
    "ensure_daily_backup",
    "FULL_BACKUPS_DIR",
    "export_palace_snapshot_comparison",
    "get_backup_palace_editor_snapshot",
    "get_current_palace_editor_snapshot",
    "get_palace_version_detail",
    "get_palace_version_snapshot",
    "is_dangerous_structure_change",
    "list_backups",
    "list_palace_versions",
    "maybe_create_interval_backup",
    "maybe_create_periodic_backup",
    "maybe_create_rolling_backup",
    "palace_editor_snapshot_to_dict",
    "recover_palaces_from_git_snapshot",
    "restore_database_backup",
    "restore_palace_from_backup",
    "restore_palace_version",
    "should_create_editor_snapshot",
    "start_periodic_backup_loop",
    "stop_periodic_backup_loop",
]
