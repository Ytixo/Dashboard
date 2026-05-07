from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

from . import db, music_service

SESSION_COOKIE = "dashboard_session"
FRONTEND_DIR = Path(__file__).resolve().parents[1]

app = FastAPI(title="Dashboard Music API")


class Credentials(BaseModel):
    username: str
    password: str


class YoutubeAuthPayload(BaseModel):
    cookie: str | None = None
    auth_headers: dict[str, Any] | None = None
    auth_user: str = "0"
    user_agent: str | None = None


class HistoryTrack(BaseModel):
    video_id: str
    title: str = "Titre inconnu"
    artist: str = ""
    thumbnail: str = ""
    duration: str = ""
    duration_seconds: int | None = None


class DeviceHeartbeat(BaseModel):
    device_id: str
    name: str = "Dashboard"
    current_track: dict[str, Any] | None = None
    is_playing: bool = False
    volume: float = 0.5


class RemoteCommand(BaseModel):
    target_device_id: str
    action: str
    payload: dict[str, Any] = Field(default_factory=dict)


def set_session_cookie(response: Response, token: str, expires_at: int) -> None:
    max_age = max(1, expires_at - db.now_ts())
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=max_age,
        httponly=True,
        samesite="lax",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, httponly=True, samesite="lax")


async def current_user(request: Request) -> dict[str, Any]:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="Session requise.")
    user = db.get_user_by_session(token)
    if not user:
        raise HTTPException(status_code=401, detail="Session expirée.")
    return user


def user_payload(user: dict[str, Any]) -> dict[str, Any]:
    return db.public_user(user, youtube_connected=db.has_youtube_auth(user["id"]))


def device_payload(device: dict[str, Any]) -> dict[str, Any]:
    track = None
    if device.get("current_track_json"):
        try:
            track = json.loads(device["current_track_json"])
        except json.JSONDecodeError:
            track = None

    return {
        "device_id": device["device_id"],
        "name": device["name"],
        "current_track": track,
        "is_playing": device["is_playing"],
        "volume": device["volume"],
        "last_seen": device["last_seen"],
    }


def active_devices(user_id: int) -> list[dict[str, Any]]:
    return [device_payload(device) for device in db.list_music_devices(user_id)]


@app.on_event("startup")
def startup() -> None:
    db.init_db()


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/auth/register")
async def register(payload: Credentials, response: Response) -> dict[str, Any]:
    try:
        user = db.create_user(payload.username, payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    token, expires_at = db.create_session(user["id"])
    set_session_cookie(response, token, expires_at)
    return {"user": user_payload(user)}


@app.post("/api/auth/login")
async def login(payload: Credentials, response: Response) -> dict[str, Any]:
    user = db.authenticate_user(payload.username, payload.password)
    if not user:
        raise HTTPException(status_code=401, detail="Identifiants invalides.")

    token, expires_at = db.create_session(user["id"])
    set_session_cookie(response, token, expires_at)
    return {"user": user_payload(user)}


@app.post("/api/auth/logout")
async def logout(request: Request, response: Response) -> dict[str, bool]:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        db.delete_session(token)
    clear_session_cookie(response)
    return {"ok": True}


@app.get("/api/auth/me")
async def me(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return {"user": user_payload(user)}


@app.put("/api/music/youtube-auth")
async def save_youtube_auth(
    payload: YoutubeAuthPayload,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    raw_headers = payload.auth_headers or {}
    cookie = payload.cookie or raw_headers.get("cookie") or raw_headers.get("Cookie")
    if not cookie:
        raise HTTPException(status_code=400, detail="Cookie YouTube Music manquant.")

    try:
        auth_headers = music_service.build_browser_auth(
            cookie=str(cookie),
            auth_user=payload.auth_user,
            user_agent=payload.user_agent,
            extra_headers=raw_headers,
        )
        await asyncio.to_thread(music_service.validate_auth, auth_headers)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=music_service.ytmusic_error_message(exc)) from exc

    db.set_youtube_auth(user["id"], json.dumps(auth_headers, ensure_ascii=True))
    return {"youtube_connected": True}


@app.delete("/api/music/youtube-auth")
async def delete_youtube_auth(user: dict[str, Any] = Depends(current_user)) -> dict[str, bool]:
    db.clear_youtube_auth(user["id"])
    return {"youtube_connected": False}


@app.get("/api/music/search")
async def search_music(
    q: str = Query(min_length=1, max_length=120),
    filter: str = Query(default="songs"),
    limit: int = Query(default=20, ge=1, le=50),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    auth_json = db.get_youtube_auth(user["id"])
    try:
        return await asyncio.to_thread(music_service.search, auth_json, q, filter, limit)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=music_service.ytmusic_error_message(exc)) from exc


@app.get("/api/music/playlists")
async def playlists(
    limit: int = Query(default=50, ge=1, le=100),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    auth_json = db.get_youtube_auth(user["id"])
    if not auth_json:
        raise HTTPException(status_code=409, detail="Compte YouTube Music non connecté.")
    try:
        items = await asyncio.to_thread(music_service.library_playlists, auth_json, limit)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=music_service.ytmusic_error_message(exc)) from exc
    return {"items": items}


@app.get("/api/music/playlists/{playlist_id}")
async def playlist_tracks(
    playlist_id: str,
    limit: int = Query(default=100, ge=1, le=200),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    auth_json = db.get_youtube_auth(user["id"])
    try:
        return await asyncio.to_thread(music_service.playlist, auth_json, playlist_id, limit)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=music_service.ytmusic_error_message(exc)) from exc


@app.post("/api/music/history")
async def add_history(track: HistoryTrack, user: dict[str, Any] = Depends(current_user)) -> dict[str, bool]:
    db.add_history(user["id"], track.model_dump())
    return {"ok": True}


@app.get("/api/music/history")
async def history(
    limit: int = Query(default=25, ge=1, le=100),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    return {"items": db.list_history(user["id"], limit)}


@app.post("/api/music/devices/heartbeat")
async def device_heartbeat(
    payload: DeviceHeartbeat,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    if not payload.device_id.strip():
        raise HTTPException(status_code=400, detail="device_id manquant.")

    current_track_json = None
    if payload.current_track:
        current_track_json = json.dumps(payload.current_track, ensure_ascii=True)[:5000]

    db.upsert_music_device(
        user_id=user["id"],
        device_id=payload.device_id,
        name=payload.name,
        current_track_json=current_track_json,
        is_playing=payload.is_playing,
        volume=payload.volume,
    )
    return {"devices": active_devices(user["id"])}


@app.get("/api/music/devices")
async def get_devices(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return {"devices": active_devices(user["id"])}


@app.post("/api/music/remote/commands")
async def send_remote_command(
    payload: RemoteCommand,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    allowed_actions = {
        "play_track",
        "toggle",
        "play",
        "pause",
        "stop",
        "next",
        "previous",
        "volume",
        "shuffle",
        "repeat_one",
    }
    if payload.action not in allowed_actions:
        raise HTTPException(status_code=400, detail="Commande remote invalide.")

    command_id = db.add_remote_command(
        user_id=user["id"],
        target_device_id=payload.target_device_id,
        action=payload.action,
        payload_json=json.dumps(payload.payload, ensure_ascii=True),
    )
    return {"id": command_id}


@app.get("/api/music/remote/commands")
async def poll_remote_commands(
    device_id: str = Query(min_length=1, max_length=128),
    after_id: int = Query(default=0, ge=0),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    commands = []
    for command in db.list_remote_commands(user["id"], device_id, after_id):
        try:
            payload = json.loads(command["payload_json"])
        except json.JSONDecodeError:
            payload = {}
        commands.append(
            {
                "id": command["id"],
                "action": command["action"],
                "payload": payload,
                "created_at": command["created_at"],
            }
        )
    return {"commands": commands}


@app.get("/api/music/stream/{video_id}")
async def stream(
    video_id: str,
    request: Request,
    user: dict[str, Any] = Depends(current_user),
) -> StreamingResponse:
    auth_json = db.get_youtube_auth(user["id"])
    try:
        resolved = await asyncio.to_thread(music_service.resolve_stream, video_id, auth_json)
        upstream = await asyncio.to_thread(
            music_service.stream_upstream,
            resolved,
            request.headers.get("range"),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Impossible de charger le flux audio.") from exc

    response_headers = {
        "Cache-Control": "no-store",
        "Accept-Ranges": upstream.headers.get("accept-ranges", "bytes"),
    }
    for source, target in (
        ("content-length", "Content-Length"),
        ("content-range", "Content-Range"),
        ("content-type", "Content-Type"),
    ):
        value = upstream.headers.get(source)
        if value:
            response_headers[target] = value

    def iter_audio():
        for chunk in upstream.iter_content(chunk_size=256 * 1024):
            if chunk:
                yield chunk

    return StreamingResponse(
        iter_audio(),
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type") or resolved.media_type,
        headers=response_headers,
        background=BackgroundTask(upstream.close),
    )


app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="dashboard")
