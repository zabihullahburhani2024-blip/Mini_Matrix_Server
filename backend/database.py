"""
SQLite persistence for users and activation codes.
All auth state lives on the server — never in the browser.
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Generator, Optional

logger = logging.getLogger("database")

DB_PATH = Path(__file__).resolve().parent / "data" / "minimatrix.db"
CODES_JSON = Path(__file__).resolve().parent / "data" / "activation_codes.json"

_lock = threading.Lock()


def _ensure_dir() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)


@contextmanager
def get_conn() -> Generator[sqlite3.Connection, None, None]:
    _ensure_dir()
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    """Create tables and seed activation code pool if empty."""
    with get_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                phone       TEXT    NOT NULL UNIQUE,
                name        TEXT    NOT NULL,
                pass_hash   TEXT    NOT NULL,
                recovery    TEXT    NOT NULL DEFAULT '',
                activated   INTEGER NOT NULL DEFAULT 0,
                activated_at REAL,
                expires_at  REAL,
                activation_code TEXT,
                created_at  REAL    NOT NULL
            );

            CREATE TABLE IF NOT EXISTS activation_codes (
                code        TEXT PRIMARY KEY,
                used        INTEGER NOT NULL DEFAULT 0,
                used_by     TEXT,
                used_at     REAL,
                expires_at  REAL
            );

            CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
            CREATE INDEX IF NOT EXISTS idx_codes_used ON activation_codes(used);
            """
        )

        count = conn.execute("SELECT COUNT(*) FROM activation_codes").fetchone()[0]
        if count == 0:
            _seed_codes(conn)


def _seed_codes(conn: sqlite3.Connection) -> None:
    codes: list[str] = []
    if CODES_JSON.exists():
        try:
            data = json.loads(CODES_JSON.read_text(encoding="utf-8"))
            if isinstance(data, dict) and "codes" in data:
                codes = [str(c).strip().lower() for c in data["codes"] if c]
            elif isinstance(data, list):
                codes = [str(c).strip().lower() for c in data if c]
        except Exception as e:
            logger.error("Failed to read activation_codes.json: %s", e)

    if not codes:
        logger.warning("No activation codes found to seed — pool is empty")
        return

    seen = set()
    rows = []
    for c in codes:
        if c and c not in seen:
            seen.add(c)
            rows.append((c,))

    conn.executemany(
        "INSERT OR IGNORE INTO activation_codes (code) VALUES (?)",
        rows,
    )
    logger.info("Seeded %d activation codes", len(rows))


# ── User helpers ────────────────────────────────────────────────────────────

def find_user_by_phone(phone: str) -> Optional[dict[str, Any]]:
    phone = _norm_phone(phone)
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE phone = ?", (phone,)
        ).fetchone()
        return dict(row) if row else None


def create_user(
    phone: str,
    name: str,
    pass_hash: str,
    recovery: str,
) -> dict[str, Any]:
    phone = _norm_phone(phone)
    import time
    now = time.time()
    with _lock:
        with get_conn() as conn:
            existing = conn.execute(
                "SELECT id FROM users WHERE phone = ?", (phone,)
            ).fetchone()
            if existing:
                raise ValueError("exists")
            cur = conn.execute(
                """
                INSERT INTO users (phone, name, pass_hash, recovery, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (phone, name.strip(), pass_hash, recovery.strip(), now),
            )
            uid = cur.lastrowid
            row = conn.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
            return dict(row)


def update_user_password(phone: str, pass_hash: str) -> bool:
    phone = _norm_phone(phone)
    with get_conn() as conn:
        cur = conn.execute(
            "UPDATE users SET pass_hash = ? WHERE phone = ?",
            (pass_hash, phone),
        )
        return cur.rowcount > 0


def activate_user(
    phone: str,
    code: str,
    expires_at: float,
) -> bool:
    phone = _norm_phone(phone)
    code = code.strip().lower()
    import time
    now = time.time()
    with _lock:
        with get_conn() as conn:
            # check code is free
            crow = conn.execute(
                "SELECT used FROM activation_codes WHERE code = ?", (code,)
            ).fetchone()
            if not crow:
                raise ValueError("not_in_pool")
            if crow["used"]:
                raise ValueError("already_used")

            urow = conn.execute(
                "SELECT id FROM users WHERE phone = ?", (phone,)
            ).fetchone()
            if not urow:
                raise ValueError("not_found")

            conn.execute(
                """
                UPDATE activation_codes
                SET used = 1, used_by = ?, used_at = ?, expires_at = ?
                WHERE code = ? AND used = 0
                """,
                (phone, now, expires_at, code),
            )
            # verify it was updated (race protection)
            check = conn.execute(
                "SELECT used FROM activation_codes WHERE code = ?", (code,)
            ).fetchone()
            if not check or not check["used"]:
                raise ValueError("already_used")

            conn.execute(
                """
                UPDATE users
                SET activated = 1, activated_at = ?, expires_at = ?, activation_code = ?
                WHERE phone = ?
                """,
                (now, expires_at, code, phone),
            )
            return True


def set_user_expired(phone: str) -> None:
    phone = _norm_phone(phone)
    with get_conn() as conn:
        conn.execute(
            "UPDATE users SET activated = 0 WHERE phone = ?", (phone,)
        )


def code_stats() -> dict[str, int]:
    with get_conn() as conn:
        total = conn.execute("SELECT COUNT(*) FROM activation_codes").fetchone()[0]
        used = conn.execute(
            "SELECT COUNT(*) FROM activation_codes WHERE used = 1"
        ).fetchone()[0]
        return {"total": total, "used": used, "free": max(0, total - used)}


def _norm_phone(phone: str) -> str:
    return "".join(c for c in str(phone or "") if c.isdigit())
