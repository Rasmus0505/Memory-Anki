"""Public backup context facade for cross-context composition."""

from .application.backup_lifecycle import (
    create_rescue_snapshot,
    list_backups,
    maybe_create_rolling_backup,
)
from .application.backup_palace_restore import restore_palace_version
from .application.backup_palace_versions import (
    cleanup_and_list_palace_versions,
    create_effective_palace_version,
    get_palace_version_detail,
    list_palace_versions,
)
from .application.editor_safety import (
    MIN_DANGEROUS_NODE_COUNT,
    count_editor_doc_nodes,
    is_dangerous_structure_change,
)
from .application.full_transfer_service import (
    FullTransferError,
    build_full_archive,
    import_full_archive,
    inspect_archive,
)

__all__ = [
    "MIN_DANGEROUS_NODE_COUNT",
    "FullTransferError",
    "build_full_archive",
    "cleanup_and_list_palace_versions",
    "count_editor_doc_nodes",
    "create_effective_palace_version",
    "create_rescue_snapshot",
    "get_palace_version_detail",
    "import_full_archive",
    "inspect_archive",
    "is_dangerous_structure_change",
    "list_backups",
    "list_palace_versions",
    "maybe_create_rolling_backup",
    "restore_palace_version",
]
