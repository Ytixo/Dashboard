from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import sqlite3
import time
from pathlib import Path
from typing import Any

DB_PATH = Path(os.getenv("DASHBOARD_DB", Path(__file__).resolve().parent / "dashboard.sqlite3"))
SESSION_TTL_SECONDS = 60 * 60 * 24 * 30
PASSWORD_ITERATIONS = 390_000
DEVICE_ACTIVE_SECONDS = 90
COMMAND_TTL_SECONDS = 600


def now_ts() -> int:
    return int(time.time())


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS youtube_tokens (
                user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                auth_json TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS music_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                video_id TEXT NOT NULL,
                title TEXT NOT NULL,
                artist TEXT NOT NULL,
                thumbnail TEXT NOT NULL,
                duration TEXT NOT NULL,
                duration_seconds INTEGER,
                played_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS music_devices (
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                device_id TEXT NOT NULL,
                name TEXT NOT NULL,
                current_track_json TEXT,
                is_playing INTEGER NOT NULL DEFAULT 0,
                volume REAL NOT NULL DEFAULT 0.5,
                last_seen INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (user_id, device_id)
            );

            CREATE TABLE IF NOT EXISTS music_remote_commands (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                target_device_id TEXT NOT NULL,
                action TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
            CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
            CREATE INDEX IF NOT EXISTS idx_music_history_user_id ON music_history(user_id, played_at DESC);
            CREATE INDEX IF NOT EXISTS idx_music_devices_user_seen ON music_devices(user_id, last_seen DESC);
            CREATE INDEX IF NOT EXISTS idx_music_commands_target ON music_remote_commands(user_id, target_device_id, id);
            """
        )


def normalize_username(username: str) -> str:
    return username.strip().lower()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS)
    return f"pbkdf2_sha256${PASSWORD_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        algorithm, iterations, salt_hex, digest_hex = stored_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            bytes.fromhex(salt_hex),
            int(iterations),
        )
        return hmac.compare_digest(digest.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def public_user(row: sqlite3.Row | dict[str, Any], youtube_connected: bool = False) -> dict[str, Any]:
    return {
        "id": row["id"],
        "username": row["username"],
        "display_name": row["display_name"],
        "youtube_connected": youtube_connected,
    }


def create_user(username: str, password: str) -> dict[str, Any]:
    clean_username = normalize_username(username)
    display_name = username.strip()
    if len(clean_username) < 2:
        raise ValueError("Nom d'utilisateur trop court.")
    if len(password) < 6:
        raise ValueError("Le mot de passe doit contenir au moins 6 caractères.")

    with connect() as conn:
        try:
            cursor = conn.execute(
                """
                INSERT INTO users (username, display_name, password_hash, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (clean_username, display_name, hash_password(password), now_ts()),
            )
        except sqlite3.IntegrityError as exc:
            raise ValueError("Ce nom d'utilisateur existe déjà.") from exc

        row = conn.execute("SELECT * FROM users WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return dict(row)


def authenticate_user(username: str, password: str) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE username = ?", (normalize_username(username),)).fetchone()
        if row and verify_password(password, row["password_hash"]):
            return dict(row)
    return None


def create_session(user_id: int) -> tuple[str, int]:
    token = secrets.token_urlsafe(48)
    expires_at = now_ts() + SESSION_TTL_SECONDS
    with connect() as conn:
        conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (now_ts(),))
        conn.execute(
            """
            INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
            VALUES (?, ?, ?, ?)
            """,
            (hash_token(token), user_id, now_ts(), expires_at),
        )
    return token, expires_at


def delete_session(token: str) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (hash_token(token),))


def get_user_by_session(token: str) -> dict[str, Any] | None:
    with connect() as conn:
        conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (now_ts(),))
        row = conn.execute(
            """
            SELECT users.*
            FROM sessions
            JOIN users ON users.id = sessions.user_id
            WHERE sessions.token_hash = ? AND sessions.expires_at > ?
            """,
            (hash_token(token), now_ts()),
        ).fetchone()
        return dict(row) if row else None


def set_youtube_auth(user_id: int, auth_json: str) -> None:
    timestamp = now_ts()
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO youtube_tokens (user_id, auth_json, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                auth_json = excluded.auth_json,
                updated_at = excluded.updated_at
            """,
            (user_id, auth_json, timestamp, timestamp),
        )


def get_youtube_auth(user_id: int) -> str | None:
    with connect() as conn:
        row = conn.execute("SELECT auth_json FROM youtube_tokens WHERE user_id = ?", (user_id,)).fetchone()
        return row["auth_json"] if row else None


def clear_youtube_auth(user_id: int) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM youtube_tokens WHERE user_id = ?", (user_id,))


def has_youtube_auth(user_id: int) -> bool:
    return get_youtube_auth(user_id) is not None


def add_history(user_id: int, track: dict[str, Any]) -> None:
    if not track.get("video_id"):
        return
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO music_history
                (user_id, video_id, title, artist, thumbnail, duration, duration_seconds, played_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user_id,
                str(track.get("video_id", "")),
                str(track.get("title", "Titre inconnu"))[:300],
                str(track.get("artist", ""))[:300],
                str(track.get("thumbnail", ""))[:1000],
                str(track.get("duration", ""))[:32],
                track.get("duration_seconds"),
                now_ts(),
            ),
        )
        conn.execute(
            """
            DELETE FROM music_history
            WHERE user_id = ?
              AND id NOT IN (
                SELECT id FROM music_history
                WHERE user_id = ?
                ORDER BY played_at DESC
                LIMIT 100
              )
            """,
            (user_id, user_id),
        )


def list_history(user_id: int, limit: int = 25) -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT video_id, title, artist, thumbnail, duration, duration_seconds, played_at
            FROM music_history
            WHERE user_id = ?
            ORDER BY played_at DESC
            LIMIT ?
            """,
            (user_id, max(1, min(limit, 100))),
        ).fetchall()
        return [dict(row) for row in rows]


def upsert_music_device(
    user_id: int,
    device_id: str,
    name: str,
    current_track_json: str | None,
    is_playing: bool,
    volume: float,
) -> None:
    timestamp = now_ts()
    clean_device_id = device_id.strip()[:128]
    clean_name = (name.strip() or "Appareil")[:80]
    bounded_volume = min(1.0, max(0.0, float(volume)))

    with connect() as conn:
        conn.execute(
            """
            INSERT INTO music_devices
                (user_id, device_id, name, current_track_json, is_playing, volume, last_seen, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, device_id) DO UPDATE SET
                name = excluded.name,
                current_track_json = excluded.current_track_json,
                is_playing = excluded.is_playing,
                volume = excluded.volume,
                last_seen = excluded.last_seen
            """,
            (
                user_id,
                clean_device_id,
                clean_name,
                current_track_json,
                1 if is_playing else 0,
                bounded_volume,
                timestamp,
                timestamp,
            ),
        )
        conn.execute("DELETE FROM music_devices WHERE last_seen < ?", (timestamp - 60 * 60 * 24,))
        conn.execute("DELETE FROM music_remote_commands WHERE created_at < ?", (timestamp - COMMAND_TTL_SECONDS,))


def list_music_devices(user_id: int) -> list[dict[str, Any]]:
    cutoff = now_ts() - DEVICE_ACTIVE_SECONDS
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT device_id, name, current_track_json, is_playing, volume, last_seen
            FROM music_devices
            WHERE user_id = ? AND last_seen >= ?
            ORDER BY last_seen DESC, name COLLATE NOCASE
            """,
            (user_id, cutoff),
        ).fetchall()
        devices = []
        for row in rows:
            devices.append(
                {
                    "device_id": row["device_id"],
                    "name": row["name"],
                    "current_track_json": row["current_track_json"],
                    "is_playing": bool(row["is_playing"]),
                    "volume": row["volume"],
                    "last_seen": row["last_seen"],
                }
            )
        return devices


def add_remote_command(
    user_id: int,
    target_device_id: str,
    action: str,
    payload_json: str,
) -> int:
    timestamp = now_ts()
    with connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO music_remote_commands (user_id, target_device_id, action, payload_json, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (user_id, target_device_id.strip()[:128], action.strip()[:40], payload_json, timestamp),
        )
        conn.execute("DELETE FROM music_remote_commands WHERE created_at < ?", (timestamp - COMMAND_TTL_SECONDS,))
        return int(cursor.lastrowid)


def list_remote_commands(user_id: int, device_id: str, after_id: int = 0) -> list[dict[str, Any]]:
    cutoff = now_ts() - COMMAND_TTL_SECONDS
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT id, action, payload_json, created_at
            FROM music_remote_commands
            WHERE user_id = ?
              AND target_device_id = ?
              AND id > ?
              AND created_at >= ?
            ORDER BY id ASC
            LIMIT 50
            """,
            (user_id, device_id.strip()[:128], max(0, after_id), cutoff),
        ).fetchall()
        return [dict(row) for row in rows]
