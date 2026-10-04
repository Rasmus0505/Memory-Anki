import logging

from memory_anki.core.request_context import get_request_id

LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s request_id=%(request_id)s %(message)s"
APPLICATION_LOGGER_ROOT = "memory_anki"


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "request_id"):
            record.request_id = get_request_id() or "-"
        return True


def _reenable_application_loggers() -> None:
    """Clear the ``disabled`` flag on ``memory_anki.*`` loggers.

    ``logging.config.fileConfig`` defaults to ``disable_existing_loggers=True``
    and sets ``disabled = True`` on every logger that already exists. Alembic
    calls ``fileConfig`` on every startup while applying migrations, which would
    otherwise silently mute module-level loggers created at import time
    (backups, startup runtime, request logging) for the rest of the process.
    """
    for name, logger in list(logging.Logger.manager.loggerDict.items()):
        if not isinstance(logger, logging.Logger):
            continue
        if name == APPLICATION_LOGGER_ROOT or name.startswith(f"{APPLICATION_LOGGER_ROOT}."):
            logger.disabled = False


def configure_logging() -> None:
    """Install the application's root logging configuration.

    Idempotent and re-runnable: ``force=True`` discards whatever handlers the
    root logger currently carries. That matters because Alembic's ``fileConfig``
    runs on every startup (``run_migrations``) and swaps the root handler for
    its own WARN-level console formatter. Callers must invoke this again after
    migrations have run, otherwise every INFO log is dropped.
    """
    logging.basicConfig(
        level=logging.INFO,
        format=LOG_FORMAT,
        force=True,
    )
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)
    request_id_filter = RequestIdFilter()
    for handler in root_logger.handlers:
        handler.addFilter(request_id_filter)
    _reenable_application_loggers()
