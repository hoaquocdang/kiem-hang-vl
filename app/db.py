from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from app.config import DATA_DIR, DATABASE_PATH, DATABASE_URL, IS_CLOUD


USERS_DATA_DIR = DATA_DIR / "users"
SPLIT_DATABASE_MIGRATION_KEY = "split_user_databases_v1"


# ===== SQLITE HELPERS (local mode) =====

def _dict_factory(cursor: sqlite3.Cursor, row: tuple) -> dict:
    return {column[0]: row[index] for index, column in enumerate(cursor.description)}


def get_connection(database_path: Path = DATABASE_PATH) -> sqlite3.Connection:
    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path)
    connection.row_factory = _dict_factory
    connection.current_user_id = None  # type: ignore[attr-defined]
    return connection


def user_database_path(user_id: int) -> Path:
    return USERS_DATA_DIR / f"user_{int(user_id)}.db"


def delete_user_database(user_id: int) -> None:
    if IS_CLOUD:
        with data_connection_scope(user_id) as conn:
            sessions = conn.execute(
                "SELECT id FROM stock_sessions WHERE user_id = ?", (user_id,)
            ).fetchall()
            for session in sessions:
                sid = session["id"]
                conn.execute("DELETE FROM scan_events WHERE session_id = ?", (sid,))
                conn.execute("DELETE FROM inventory_items WHERE session_id = ?", (sid,))
            conn.execute("DELETE FROM stock_sessions WHERE user_id = ?", (user_id,))
        return

    database_path = user_database_path(user_id)
    for path in [
        database_path,
        Path(f"{database_path}-wal"),
        Path(f"{database_path}-shm"),
    ]:
        if path.exists():
            path.unlink()


# ===== POSTGRESQL HELPERS (cloud mode) =====

if IS_CLOUD:
    import psycopg2
    import psycopg2.extras

    class _PGCursor:
        """sqlite3-compatible cursor backed by psycopg2."""

        def __init__(self, cur: Any) -> None:
            self._cur = cur
            self.lastrowid: int | None = None
            self.rowcount: int = cur.rowcount

        def fetchone(self) -> dict | None:
            row = self._cur.fetchone()
            return dict(row) if row is not None else None

        def fetchall(self) -> list[dict]:
            return [dict(row) for row in self._cur.fetchall()]

    class _PGConnection:
        """sqlite3-compatible connection backed by psycopg2."""

        def __init__(self, conn: Any) -> None:
            self._conn = conn
            self.current_user_id: int | None = None

        @staticmethod
        def _q(sql: str) -> str:
            """Convert ? placeholders to %s for psycopg2."""
            return sql.replace("?", "%s")

        def execute(self, sql: str, params=None) -> _PGCursor:
            cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute(self._q(sql), params or ())
            return _PGCursor(cur)

        def executemany(self, sql: str, params_seq) -> _PGCursor:
            cur = self._conn.cursor()
            psycopg2.extras.execute_batch(cur, self._q(sql), list(params_seq))
            return _PGCursor(cur)

        def commit(self) -> None:
            self._conn.commit()

        def rollback(self) -> None:
            self._conn.rollback()

        def close(self) -> None:
            self._conn.close()

    def _new_pg_conn() -> _PGConnection:
        raw = psycopg2.connect(DATABASE_URL)
        raw.autocommit = False
        return _PGConnection(raw)


# ===== POSTGRESQL SCHEMA =====

_PG_SCHEMA = """
CREATE TABLE IF NOT EXISTS app_users (
    id BIGSERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    last_login_at TEXT
);
CREATE TABLE IF NOT EXISTS auth_sessions (
    token TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    user_agent TEXT,
    FOREIGN KEY(user_id) REFERENCES app_users(id)
);
CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_app_users_role_active ON app_users(role, is_active);
CREATE TABLE IF NOT EXISTS stock_sessions (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL,
    source_filename TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS inventory_items (
    id BIGSERIAL PRIMARY KEY,
    session_id BIGINT NOT NULL,
    barcode TEXT NOT NULL DEFAULT '',
    sku TEXT,
    variant_key TEXT NOT NULL DEFAULT '',
    product_name TEXT,
    operation_label TEXT,
    operation_code TEXT,
    operation_key TEXT,
    price TEXT,
    color TEXT,
    size TEXT,
    stock_qty INTEGER NOT NULL,
    scanned_qty INTEGER NOT NULL DEFAULT 0,
    reason_code TEXT,
    reason_note TEXT,
    source_note TEXT,
    last_scanned_at TEXT,
    FOREIGN KEY(session_id) REFERENCES stock_sessions(id)
);
CREATE TABLE IF NOT EXISTS scan_events (
    id BIGSERIAL PRIMARY KEY,
    session_id BIGINT NOT NULL,
    item_id BIGINT,
    barcode TEXT NOT NULL DEFAULT '',
    scan_code TEXT NOT NULL DEFAULT '',
    color_code TEXT,
    size_code TEXT,
    operation_code TEXT,
    operation_key TEXT,
    quantity INTEGER NOT NULL,
    status TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(session_id) REFERENCES stock_sessions(id),
    FOREIGN KEY(item_id) REFERENCES inventory_items(id)
);
CREATE INDEX IF NOT EXISTS idx_items_session ON inventory_items(session_id);
CREATE INDEX IF NOT EXISTS idx_items_variant ON inventory_items(session_id, color, size, operation_code);
CREATE INDEX IF NOT EXISTS idx_events_session ON scan_events(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON stock_sessions(is_active, id DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON stock_sessions(user_id, is_active, id DESC);
"""

_pg_schema_ready = False


def _ensure_pg_schema() -> None:
    global _pg_schema_ready
    if _pg_schema_ready:
        return
    conn = _new_pg_conn()
    try:
        for stmt in _PG_SCHEMA.split(";"):
            stmt = stmt.strip()
            if stmt:
                conn.execute(stmt)
        conn.commit()
        _pg_schema_ready = True
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ===== SQLITE SCHEMA =====

def _init_auth_db(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS app_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE COLLATE NOCASE,
            display_name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            last_login_at TEXT
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS auth_sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            user_agent TEXT,
            FOREIGN KEY(user_id) REFERENCES app_users(id)
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS app_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id, expires_at)"
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_app_users_role_active ON app_users(role, is_active)"
    )


def init_data_db(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS stock_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            source_filename TEXT NOT NULL,
            imported_at TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS inventory_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            barcode TEXT NOT NULL DEFAULT '',
            sku TEXT,
            variant_key TEXT NOT NULL DEFAULT '',
            product_name TEXT,
            operation_label TEXT,
            operation_code TEXT,
            operation_key TEXT,
            price TEXT,
            color TEXT,
            size TEXT,
            stock_qty INTEGER NOT NULL,
            scanned_qty INTEGER NOT NULL DEFAULT 0,
            reason_code TEXT,
            reason_note TEXT,
            source_note TEXT,
            last_scanned_at TEXT,
            FOREIGN KEY(session_id) REFERENCES stock_sessions(id)
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS scan_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            item_id INTEGER,
            barcode TEXT NOT NULL DEFAULT '',
            scan_code TEXT NOT NULL DEFAULT '',
            color_code TEXT,
            size_code TEXT,
            operation_code TEXT,
            operation_key TEXT,
            quantity INTEGER NOT NULL,
            status TEXT NOT NULL,
            note TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(session_id) REFERENCES stock_sessions(id),
            FOREIGN KEY(item_id) REFERENCES inventory_items(id)
        )
        """
    )
    _ensure_data_columns(connection)
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_items_session ON inventory_items(session_id)"
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_items_variant ON inventory_items(session_id, color, size, operation_code)"
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_events_session ON scan_events(session_id, created_at DESC)"
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_sessions_active ON stock_sessions(is_active, id DESC)"
    )


def _ensure_data_columns(connection: sqlite3.Connection) -> None:
    existing_inventory_columns = {
        row["name"]
        for row in connection.execute("PRAGMA table_info(inventory_items)").fetchall()
    }
    inventory_additions = {
        "barcode": "TEXT NOT NULL DEFAULT ''",
        "sku": "TEXT",
        "variant_key": "TEXT NOT NULL DEFAULT ''",
        "operation_label": "TEXT",
        "operation_code": "TEXT",
        "operation_key": "TEXT",
        "price": "TEXT",
        "source_note": "TEXT",
    }
    for column_name, definition in inventory_additions.items():
        if column_name not in existing_inventory_columns:
            connection.execute(f"ALTER TABLE inventory_items ADD COLUMN {column_name} {definition}")

    existing_scan_columns = {
        row["name"]
        for row in connection.execute("PRAGMA table_info(scan_events)").fetchall()
    }
    scan_additions = {
        "barcode": "TEXT NOT NULL DEFAULT ''",
        "scan_code": "TEXT NOT NULL DEFAULT ''",
        "color_code": "TEXT",
        "size_code": "TEXT",
        "operation_code": "TEXT",
        "operation_key": "TEXT",
    }
    for column_name, definition in scan_additions.items():
        if column_name not in existing_scan_columns:
            connection.execute(f"ALTER TABLE scan_events ADD COLUMN {column_name} {definition}")


def init_db() -> None:
    if IS_CLOUD:
        _ensure_pg_schema()
        return
    Path(DATA_DIR).mkdir(parents=True, exist_ok=True)
    USERS_DATA_DIR.mkdir(parents=True, exist_ok=True)
    with connection_scope() as connection:
        _init_auth_db(connection)


# ===== CONTEXT MANAGERS =====

@contextmanager
def connection_scope():
    if IS_CLOUD:
        _ensure_pg_schema()
        conn = _new_pg_conn()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
    else:
        conn = get_connection(DATABASE_PATH)
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


@contextmanager
def data_connection_scope(user_id: int):
    if IS_CLOUD:
        _ensure_pg_schema()
        conn = _new_pg_conn()
        conn.current_user_id = user_id
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
    else:
        path = user_database_path(user_id)
        conn = get_connection(path)
        conn.current_user_id = None  # type: ignore[attr-defined]
        try:
            init_data_db(conn)
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


# ===== LEGACY MIGRATION (SQLite only) =====

def migrate_legacy_stock_data(connection: sqlite3.Connection, default_user_id: int) -> None:
    if IS_CLOUD:
        return
    _init_auth_db(connection)
    if _get_meta(connection, SPLIT_DATABASE_MIGRATION_KEY):
        return
    if not _table_exists(connection, "stock_sessions"):
        _set_meta(connection, SPLIT_DATABASE_MIGRATION_KEY, "no_legacy_stock_tables")
        return

    session_columns = _column_names(connection, "stock_sessions")
    has_user_id = "user_id" in session_columns
    sessions = connection.execute("SELECT * FROM stock_sessions ORDER BY id").fetchall()
    if not sessions:
        _set_meta(connection, SPLIT_DATABASE_MIGRATION_KEY, "no_legacy_sessions")
        return

    existing_user_ids = {
        row["id"]
        for row in connection.execute("SELECT id FROM app_users").fetchall()
    }
    grouped_session_ids: dict[int, list[int]] = {}
    for session in sessions:
        raw_user_id = session["user_id"] if has_user_id else None
        target_user_id = raw_user_id if raw_user_id in existing_user_ids else default_user_id
        grouped_session_ids.setdefault(int(target_user_id), []).append(int(session["id"]))

    for user_id, session_ids in grouped_session_ids.items():
        with data_connection_scope(user_id) as data_connection:
            _copy_rows(
                connection,
                data_connection,
                "stock_sessions",
                session_ids,
                exclude_columns={"user_id"},
            )
            _copy_rows(connection, data_connection, "inventory_items", session_ids)
            _copy_rows(connection, data_connection, "scan_events", session_ids)

    _set_meta(connection, SPLIT_DATABASE_MIGRATION_KEY, "completed")


def _copy_rows(
    source: sqlite3.Connection,
    target: sqlite3.Connection,
    table_name: str,
    session_ids: list[int],
    exclude_columns: set[str] | None = None,
) -> None:
    if not session_ids or not _table_exists(source, table_name):
        return

    source_columns = _column_names(source, table_name)
    target_columns = _column_names(target, table_name)
    excluded = exclude_columns or set()
    columns = [
        column
        for column in source_columns
        if column in target_columns and column not in excluded
    ]
    if not columns:
        return

    placeholders = ", ".join("?" for _ in session_ids)
    where_clause = f"WHERE session_id IN ({placeholders})"
    if table_name == "stock_sessions":
        where_clause = f"WHERE id IN ({placeholders})"

    column_sql = ", ".join(columns)
    rows = source.execute(
        f"SELECT {column_sql} FROM {table_name} {where_clause}",
        session_ids,
    ).fetchall()
    if not rows:
        return

    insert_placeholders = ", ".join("?" for _ in columns)
    target.executemany(
        f"INSERT OR IGNORE INTO {table_name} ({column_sql}) VALUES ({insert_placeholders})",
        ([row[column] for column in columns] for row in rows),
    )


def _table_exists(connection: sqlite3.Connection, table_name: str) -> bool:
    row = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table_name,),
    ).fetchone()
    return row is not None


def _column_names(connection: sqlite3.Connection, table_name: str) -> list[str]:
    return [
        row["name"]
        for row in connection.execute(f"PRAGMA table_info({table_name})").fetchall()
    ]


def _get_meta(connection: sqlite3.Connection, key: str) -> str | None:
    row = connection.execute("SELECT value FROM app_meta WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else None


def _set_meta(connection: sqlite3.Connection, key: str, value: str) -> None:
    connection.execute(
        """
        INSERT INTO app_meta(key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        """,
        (key, value),
    )
