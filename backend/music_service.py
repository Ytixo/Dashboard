from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from hashlib import sha256
from typing import Any

import requests
import yt_dlp
from ytmusicapi import YTMusic
from ytmusicapi.exceptions import YTMusicError, YTMusicUserError

DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0 Safari/537.36"
)
YOUTUBE_MUSIC_ORIGIN = "https://music.youtube.com"
VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{6,}$")
VIEW_COUNTER_WORDS = ("lecture", "lectures", "vue", "vues", "views", "view")
CACHE_TTL_SECONDS = 60
_CACHE: dict[tuple[Any, ...], tuple[float, Any]] = {}

YTDL_SINGLE = {
    "format": "bestaudio/best",
    "noplaylist": True,
    "nocheckcertificate": True,
    "ignoreerrors": True,
    "quiet": True,
    "no_warnings": True,
    "default_search": "ytsearch",
    "source_address": "0.0.0.0",
    "skip_download": True,
    "geo_bypass": True,
    "extractor_args": {"youtube": {"skip": ["dash", "hls"], "player_skip": ["js"]}},
}


@dataclass
class ResolvedStream:
    url: str
    headers: dict[str, str]
    media_type: str


def build_browser_auth(
    cookie: str,
    auth_user: str = "0",
    user_agent: str | None = None,
    extra_headers: dict[str, Any] | None = None,
) -> dict[str, str]:
    cookie = cookie.strip()
    if "__Secure-3PAPISID=" not in cookie:
        sapisid = re.search(r"(?:^|;\s*)SAPISID=([^;]+)", cookie)
        if not sapisid:
            raise ValueError("Le cookie doit contenir __Secure-3PAPISID.")
        cookie = f"{cookie}; __Secure-3PAPISID={sapisid.group(1)}"

    headers = {str(k).lower(): str(v) for k, v in (extra_headers or {}).items() if v is not None}
    headers["cookie"] = cookie
    headers["x-goog-authuser"] = str(auth_user or headers.get("x-goog-authuser") or "0")
    headers["origin"] = headers.get("origin") or headers.get("x-origin") or YOUTUBE_MUSIC_ORIGIN
    headers["x-origin"] = headers["origin"]
    headers["authorization"] = headers.get("authorization") or "SAPISIDHASH 0_0"
    headers["user-agent"] = user_agent or headers.get("user-agent") or DEFAULT_USER_AGENT
    headers["accept"] = headers.get("accept") or "*/*"
    headers["content-type"] = headers.get("content-type") or "application/json"

    for ignored in ("host", "content-length", "accept-encoding", "connection"):
        headers.pop(ignored, None)

    return headers


def parse_auth_json(auth_json: str | None) -> dict[str, str] | None:
    if not auth_json:
        return None
    data = json.loads(auth_json)
    return {str(k): str(v) for k, v in data.items()}


def create_client(auth_json: str | None = None) -> YTMusic:
    auth = parse_auth_json(auth_json)
    return YTMusic(auth=auth, language="fr", location="FR")


def auth_cache_key(auth_json: str | None) -> str:
    if not auth_json:
        return "public"
    return sha256(auth_json.encode("utf-8")).hexdigest()


def cached(key: tuple[Any, ...]) -> Any | None:
    entry = _CACHE.get(key)
    if not entry:
        return None
    expires_at, value = entry
    if expires_at < time.time():
        _CACHE.pop(key, None)
        return None
    return value


def remember(key: tuple[Any, ...], value: Any) -> Any:
    if len(_CACHE) > 128:
        now = time.time()
        for cache_key, (expires_at, _) in list(_CACHE.items()):
            if expires_at < now:
                _CACHE.pop(cache_key, None)
        if len(_CACHE) > 128:
            _CACHE.pop(next(iter(_CACHE)))
    _CACHE[key] = (time.time() + CACHE_TTL_SECONDS, value)
    return value


def validate_auth(auth_headers: dict[str, str]) -> None:
    client = YTMusic(auth=auth_headers, language="fr", location="FR")
    client.get_library_playlists(limit=1)


def best_thumbnail(item: dict[str, Any]) -> str:
    thumbnails = item.get("thumbnails") or []
    if not thumbnails:
        return ""
    best = max(thumbnails, key=lambda thumb: int(thumb.get("width") or 0))
    return str(best.get("url") or "")


def artist_text(artists: Any, fallback: str = "") -> str:
    names: list[str] = []
    if isinstance(artists, list):
        for artist in artists:
            if not isinstance(artist, dict):
                continue
            name = str(artist.get("name") or "").strip()
            if not name:
                continue
            lower = name.lower()
            if artist.get("id") is None and any(word in lower for word in VIEW_COUNTER_WORDS):
                continue
            names.append(name)
    return ", ".join(names) or fallback


def normalize_track(item: dict[str, Any]) -> dict[str, Any] | None:
    video_id = item.get("videoId") or item.get("video_id")
    if not video_id:
        return None

    return {
        "kind": "track",
        "video_id": str(video_id),
        "title": str(item.get("title") or "Titre inconnu"),
        "artist": artist_text(item.get("artists"), str(item.get("author") or "")),
        "album": (item.get("album") or {}).get("name") if isinstance(item.get("album"), dict) else item.get("album"),
        "duration": str(item.get("duration") or ""),
        "duration_seconds": item.get("duration_seconds"),
        "thumbnail": best_thumbnail(item),
        "result_type": str(item.get("resultType") or item.get("videoType") or "song"),
        "is_available": item.get("isAvailable", True),
        "source": "youtube_music",
    }


def normalize_playlist(item: dict[str, Any]) -> dict[str, Any] | None:
    playlist_id = item.get("playlistId") or item.get("browseId") or item.get("id")
    if not playlist_id:
        return None
    if str(playlist_id).startswith("MPSP"):
        return None

    return {
        "kind": "playlist",
        "playlist_id": str(playlist_id),
        "title": str(item.get("title") or "Playlist"),
        "author": str(item.get("author") or ""),
        "item_count": item.get("trackCount") or item.get("itemCount") or "",
        "duration": str(item.get("duration") or ""),
        "thumbnail": best_thumbnail(item),
    }


def search(auth_json: str | None, query: str, filter_name: str, limit: int = 20) -> dict[str, Any]:
    cache_key = ("search", auth_cache_key(auth_json), query.strip().lower(), filter_name, limit)
    cached_value = cached(cache_key)
    if cached_value is not None:
        return cached_value

    client = create_client(auth_json)
    filter_arg = filter_name if filter_name in {"songs", "videos", "playlists"} else None
    results = client.search(query, filter=filter_arg, limit=max(1, min(limit, 50)))

    items: list[dict[str, Any]] = []
    for result in results:
        if filter_arg == "playlists" or result.get("resultType") == "playlist":
            normalized_playlist = normalize_playlist(result)
            if normalized_playlist:
                items.append(normalized_playlist)
            continue
        normalized_track = normalize_track(result)
        if normalized_track:
            items.append(normalized_track)

    return remember(cache_key, {"items": items[: max(1, min(limit, 50))], "query": query, "filter": filter_name})


def library_playlists(auth_json: str, limit: int = 50) -> list[dict[str, Any]]:
    cache_key = ("library_playlists", auth_cache_key(auth_json), limit)
    cached_value = cached(cache_key)
    if cached_value is not None:
        return cached_value

    client = create_client(auth_json)
    playlists = client.get_library_playlists(limit=max(1, min(limit, 100)))
    return remember(cache_key, [playlist for playlist in (normalize_playlist(item) for item in playlists) if playlist])


def playlist(auth_json: str | None, playlist_id: str, limit: int = 100) -> dict[str, Any]:
    cache_key = ("playlist", auth_cache_key(auth_json), playlist_id, limit)
    cached_value = cached(cache_key)
    if cached_value is not None:
        return cached_value

    client = create_client(auth_json)
    data = client.get_playlist(playlist_id, limit=max(1, min(limit, 200)))
    tracks = [track for track in (normalize_track(item) for item in data.get("tracks", [])) if track]
    sliced_tracks = tracks[: max(1, min(limit, 200))]
    return remember(cache_key, {
        "playlist": normalize_playlist(data) or {
            "kind": "playlist",
            "playlist_id": playlist_id,
            "title": str(data.get("title") or "Playlist"),
            "author": str(data.get("author") or ""),
            "item_count": data.get("trackCount") or len(sliced_tracks),
            "duration": str(data.get("duration") or ""),
            "thumbnail": best_thumbnail(data),
        },
        "tracks": sliced_tracks,
    })


def _select_info_entry(info: dict[str, Any] | None) -> dict[str, Any] | None:
    if not info:
        return None
    if "entries" in info:
        for entry in info.get("entries") or []:
            if entry:
                return entry
        return None
    return info


def resolve_stream(video_id: str, auth_json: str | None = None) -> ResolvedStream:
    if not VIDEO_ID_RE.match(video_id):
        raise ValueError("Identifiant vidéo invalide.")

    options = YTDL_SINGLE.copy()
    auth_headers = parse_auth_json(auth_json)
    if auth_headers:
        options["http_headers"] = {
            "Cookie": auth_headers.get("cookie", ""),
            "User-Agent": auth_headers.get("user-agent", DEFAULT_USER_AGENT),
        }

    url = f"https://music.youtube.com/watch?v={video_id}"
    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(url, download=False)

    entry = _select_info_entry(info)
    if not entry or not entry.get("url"):
        raise LookupError("Impossible de résoudre le flux audio.")

    media_type = "audio/webm" if entry.get("ext") == "webm" else "audio/mp4"
    return ResolvedStream(
        url=str(entry["url"]),
        headers={str(k): str(v) for k, v in (entry.get("http_headers") or {}).items()},
        media_type=media_type,
    )


def stream_upstream(resolved: ResolvedStream, range_header: str | None) -> requests.Response:
    headers = {
        "User-Agent": resolved.headers.get("User-Agent") or DEFAULT_USER_AGENT,
        "Accept": "*/*",
    }
    if range_header:
        headers["Range"] = range_header
    response = requests.get(resolved.url, headers=headers, stream=True, timeout=20)
    response.raise_for_status()
    return response


def ytmusic_error_message(exc: Exception) -> str:
    if isinstance(exc, (YTMusicError, YTMusicUserError)):
        return str(exc)
    return "YouTube Music n'a pas répondu correctement."
