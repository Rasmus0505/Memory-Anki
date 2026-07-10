from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from alembic.script import ScriptDirectory
from sqlalchemy import engine_from_config, inspect, pool
from sqlalchemy.engine import Connection

from memory_anki.core.config import DATABASE_URL, ensure_runtime_dirs
from memory_anki.infrastructure.db._tables import Base

config = context.config
ensure_runtime_dirs()
config.set_main_option("sqlalchemy.url", DATABASE_URL)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def bootstrap_empty_database(connection: Connection) -> bool:
    if inspect(connection).get_table_names():
        return False
    target_metadata.create_all(bind=connection, checkfirst=True)
    head = ScriptDirectory.from_config(config).get_current_head()
    if head is None:
        raise RuntimeError("Alembic has no head revision")
    connection.exec_driver_sql(
        "CREATE TABLE alembic_version (version_num VARCHAR(255) NOT NULL)"
    )
    connection.exec_driver_sql(
        "INSERT INTO alembic_version (version_num) VALUES (?)",
        (head,),
    )
    connection.commit()
    return True


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        if bootstrap_empty_database(connection):
            return
        context.configure(connection=connection, target_metadata=target_metadata)

        with context.begin_transaction():
            context.run_migrations()
        connection.commit()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
