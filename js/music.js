import { initVisualizer } from "./music-visualizer.js";

const audio = document.getElementById("audioPlayer");
const overlayMusic = document.getElementById("overlay");
const volume = document.getElementById("volume");
const labelArtiste = document.getElementById("artist");
const labelTrack = document.getElementById("track");
const musicStop = document.getElementById("musicStop");
const sessionBadge = document.getElementById("sessionBadge");

const authPanel = document.getElementById("authPanel");
const accountPanel = document.getElementById("accountPanel");
const accountName = document.getElementById("accountName");
const youtubeState = document.getElementById("youtubeState");
const youtubeAuthPanel = document.getElementById("youtubeAuthPanel");
const libraryPanel = document.getElementById("libraryPanel");
const historyPanel = document.getElementById("historyPanel");
const username = document.getElementById("username");
const password = document.getElementById("password");
const registerBtn = document.getElementById("registerBtn");
const logoutBtn = document.getElementById("logoutBtn");
const cookieInput = document.getElementById("cookieInput");
const saveCookieBtn = document.getElementById("saveCookieBtn");
const copyCookieScriptBtn = document.getElementById("copyCookieScriptBtn");
const refreshPlaylistsBtn = document.getElementById("refreshPlaylistsBtn");
const playlistList = document.getElementById("playlistList");
const historyList = document.getElementById("historyList");
const searchForm = document.getElementById("searchForm");
const musicSearchInput = document.getElementById("musicSearchInput");
const musicStatus = document.getElementById("musicStatus");
const musicResults = document.getElementById("musicResults");
const filterTabs = document.querySelectorAll(".filter-tab");
const nowThumb = document.getElementById("nowThumb");
const playerDock = document.getElementById("playerDock");
const playPauseBtn = document.getElementById("playPauseBtn");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const shuffleBtn = document.getElementById("shuffleBtn");
const repeatBtn = document.getElementById("repeatBtn");
const remoteControl = document.getElementById("remoteControl");
const deviceSelect = document.getElementById("deviceSelect");

const DEVICE_ID_KEY = "dashboard_music_device_id";
const DEVICE_NAME_KEY = "dashboard_music_device_name";
const TARGET_DEVICE_KEY = "dashboard_music_target_device_id";
const REMOTE_LAST_ID_KEY = "dashboard_music_remote_last_id";

function makeDeviceId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = makeDeviceId();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function getDeviceName() {
  let name = localStorage.getItem(DEVICE_NAME_KEY);
  if (!name) {
    const platform = navigator.platform || "Navigateur";
    name = `${platform} ${getDeviceId().slice(0, 4)}`;
    localStorage.setItem(DEVICE_NAME_KEY, name);
  }
  return name;
}

const state = {
  user: null,
  activeFilter: "songs",
  lastResults: [],
  history: [],
  queue: [],
  queueIndex: -1,
  currentTrack: null,
  playerMode: "youtube",
  isPlaying: false,
  shuffle: false,
  repeatOne: false,
  deviceId: getDeviceId(),
  deviceName: getDeviceName(),
  devices: [],
  targetDeviceId: localStorage.getItem(TARGET_DEVICE_KEY) || getDeviceId(),
  lastCommandId: Number(localStorage.getItem(`${REMOTE_LAST_ID_KEY}_${getDeviceId()}`) || 0),
  heartbeatTimer: null,
  pollTimer: null,
};

let youtubePlayer = null;
let youtubePlayerReady = null;
let resolveYoutubePlayer = null;

function ensureYouTubePlayer() {
  if (youtubePlayerReady) {
    return youtubePlayerReady;
  }

  youtubePlayerReady = new Promise((resolve) => {
    resolveYoutubePlayer = resolve;
  });

  window.onYouTubeIframeAPIReady = () => {
    youtubePlayer = new YT.Player("youtubePlayer", {
      width: "220",
      height: "124",
      playerVars: {
        autoplay: 0,
        controls: 0,
        disablekb: 1,
        modestbranding: 1,
        rel: 0,
        playsinline: 1,
      },
      events: {
        onReady: () => resolveYoutubePlayer(youtubePlayer),
        onStateChange: handleYouTubeState,
      },
    });
  };

  if (!window.YT?.Player) {
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
  } else {
    window.onYouTubeIframeAPIReady();
  }

  return youtubePlayerReady;
}

function handleYouTubeState(event) {
  if (state.playerMode !== "youtube") {
    return;
  }

  if (event.data === YT.PlayerState.ENDED) {
    state.isPlaying = false;
    updatePlayIcon();
    playNextLocal(true);
    return;
  }

  if (event.data === YT.PlayerState.PLAYING) {
    state.isPlaying = true;
    updatePlayIcon();
    heartbeat();
    return;
  }

  if (event.data === YT.PlayerState.PAUSED || event.data === YT.PlayerState.CUED) {
    state.isPlaying = false;
    updatePlayIcon();
    heartbeat();
  }
}

async function api(path, options = {}) {
  const init = {
    credentials: "include",
    ...options,
    headers: {
      ...(options.headers || {}),
    },
  };

  if (init.body && typeof init.body !== "string" && !(init.body instanceof FormData)) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(init.body);
  }

  const response = await fetch(path, init);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.detail || `Erreur ${response.status}`);
  }
  return data;
}

function setStatus(message = "", isError = false) {
  musicStatus.textContent = message;
  musicStatus.classList.toggle("error", isError);
}

function isCurrentDeviceTarget() {
  return state.targetDeviceId === state.deviceId;
}

function selectedDevice() {
  return state.devices.find((device) => device.device_id === state.targetDeviceId) || null;
}

function selectedDeviceTrack() {
  if (isCurrentDeviceTarget()) {
    return state.currentTrack;
  }
  return selectedDevice()?.current_track || null;
}

function updateDockVisibility() {
  const shouldShow = overlayMusic.style.display === "flex" || Boolean(selectedDeviceTrack());
  playerDock.classList.toggle("dock-hidden", !shouldShow);
}

function updateModeButtons() {
  shuffleBtn.classList.toggle("active", state.shuffle);
  repeatBtn.classList.toggle("active", state.repeatOne);
}

function shuffleQueue(queue, currentIndex = 0) {
  const copy = [...queue];
  const current = copy[currentIndex];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
  }
  if (current) {
    const newIndex = copy.findIndex((track) => track.video_id === current.video_id);
    if (newIndex > 0) {
      [copy[0], copy[newIndex]] = [copy[newIndex], copy[0]];
    }
  }
  return copy;
}

function clearElement(element) {
  element.replaceChildren();
}

function textNode(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text || "";
  return element;
}

function thumb(src, alt = "") {
  const image = document.createElement("img");
  image.alt = alt;
  if (src) {
    image.src = src;
  }
  image.loading = "lazy";
  return image;
}

function extractPlaylistId(value) {
  try {
    const url = new URL(value);
    return url.searchParams.get("list");
  } catch {
    const match = value.match(/\blist=([A-Za-z0-9_-]+)/);
    return match ? match[1] : null;
  }
}

export function showMusic() {
  overlayMusic.style.display = "flex";
  updateDockVisibility();
}

export function hideMusic() {
  overlayMusic.style.display = "none";
  updateDockVisibility();
}

export function refreshMusicDock() {
  updateDockVisibility();
}

async function sendRemoteCommand(action, payload = {}, targetDeviceId = state.targetDeviceId) {
  if (!state.user || targetDeviceId === state.deviceId) {
    return null;
  }
  return api("/api/music/remote/commands", {
    method: "POST",
    body: {
      target_device_id: targetDeviceId,
      action,
      payload,
    },
  });
}

async function heartbeat() {
  if (!state.user) {
    return;
  }

  try {
    const data = await api("/api/music/devices/heartbeat", {
      method: "POST",
      body: {
        device_id: state.deviceId,
        name: state.deviceName,
        current_track: state.currentTrack,
        is_playing: state.isPlaying,
        volume: Number(volume.value),
      },
    });
    renderDevices(data.devices || []);
  } catch {}
}

async function pollRemoteCommands() {
  if (!state.user) {
    return;
  }

  try {
    const params = new URLSearchParams({
      device_id: state.deviceId,
      after_id: String(state.lastCommandId),
    });
    const data = await api(`/api/music/remote/commands?${params.toString()}`);
    for (const command of data.commands || []) {
      state.lastCommandId = Math.max(state.lastCommandId, command.id);
      localStorage.setItem(`${REMOTE_LAST_ID_KEY}_${state.deviceId}`, String(state.lastCommandId));
      await applyRemoteCommand(command);
    }
  } catch {}
}

function startRemoteSync() {
  stopRemoteSync();
  heartbeat();
  pollRemoteCommands();
  state.heartbeatTimer = window.setInterval(heartbeat, 7000);
  state.pollTimer = window.setInterval(pollRemoteCommands, 2200);
}

function stopRemoteSync() {
  if (state.heartbeatTimer) {
    window.clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = null;
  }
  if (state.pollTimer) {
    window.clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

function renderDevices(devices) {
  state.devices = devices;
  remoteControl.classList.toggle("hidden", !state.user);
  if (!state.user) {
    return;
  }

  const knownIds = new Set(devices.map((device) => device.device_id));
  if (!knownIds.has(state.targetDeviceId)) {
    state.targetDeviceId = state.deviceId;
    localStorage.setItem(TARGET_DEVICE_KEY, state.targetDeviceId);
  }

  clearElement(deviceSelect);
  devices.forEach((device) => {
    const option = document.createElement("option");
    option.value = device.device_id;
    const suffix = device.device_id === state.deviceId ? "ici" : device.is_playing ? "play" : "idle";
    option.textContent = `${device.name} · ${suffix}`;
    deviceSelect.appendChild(option);
  });
  deviceSelect.value = state.targetDeviceId;
  updateNowPlaying();
  updatePlayIcon();
  updateDockVisibility();
}

async function applyRemoteCommand(command) {
  const payload = command.payload || {};

  if (command.action === "play_track") {
    state.shuffle = Boolean(payload.shuffle);
    state.repeatOne = Boolean(payload.repeat_one);
    updateModeButtons();
    await playTrack(payload.track, payload.queue || [payload.track], payload.index || 0);
    return;
  }

  if (command.action === "toggle") {
    await togglePlaybackLocal();
  } else if (command.action === "play") {
    await playLocal();
  } else if (command.action === "pause") {
    pauseLocal();
  } else if (command.action === "stop") {
    stopMusicLocal();
  } else if (command.action === "next") {
    playNextLocal(false);
  } else if (command.action === "previous") {
    playPreviousLocal();
  } else if (command.action === "volume") {
    setVolumeLocal(payload.volume);
  } else if (command.action === "shuffle") {
    state.shuffle = Boolean(payload.enabled);
    updateModeButtons();
  } else if (command.action === "repeat_one") {
    state.repeatOne = Boolean(payload.enabled);
    updateModeButtons();
  }
}

function updateAuthUI() {
  const isLogged = Boolean(state.user);
  authPanel.classList.toggle("hidden", isLogged);
  accountPanel.classList.toggle("hidden", !isLogged);
  libraryPanel.classList.toggle("hidden", !isLogged);
  historyPanel.classList.toggle("hidden", !isLogged);
  logoutBtn.classList.toggle("hidden", !isLogged);
  remoteControl.classList.toggle("hidden", !isLogged);
  sessionBadge.style.display = isLogged ? "inline-flex" : "none";

  if (!isLogged) {
    sessionBadge.textContent = "";
    accountName.textContent = "";
    setStatus("Connecte-toi au dashboard pour isoler ta session Music.");
    clearElement(playlistList);
    clearElement(historyList);
    clearElement(deviceSelect);
    renderEmptyResults("Connexion requise.");
    stopRemoteSync();
    updateDockVisibility();
    return;
  }

  accountName.textContent = state.user.display_name || state.user.username;
  sessionBadge.textContent = `@${state.user.username}`;
  youtubeState.textContent = state.user.youtube_connected ? "YouTube lié" : "YouTube libre";
  youtubeState.classList.toggle("connected", state.user.youtube_connected);
  youtubeAuthPanel.classList.toggle("hidden", state.user.youtube_connected);
  setStatus(state.user.youtube_connected ? "Playlists YouTube Music disponibles." : "Recherche publique active. Ajoute tes cookies pour tes playlists.");
}

async function loadMe() {
  try {
    const data = await api("/api/auth/me");
    state.user = data.user;
  } catch {
    state.user = null;
  }
  updateAuthUI();

  if (state.user) {
    startRemoteSync();
    await Promise.all([loadHistory(), state.user.youtube_connected ? loadPlaylists() : Promise.resolve()]);
  }
}

async function authenticate(endpoint) {
  try {
    const data = await api(endpoint, {
      method: "POST",
      body: {
        username: username.value,
        password: password.value,
      },
    });
    state.user = data.user;
    password.value = "";
    updateAuthUI();
    startRemoteSync();
    await Promise.all([loadHistory(), state.user.youtube_connected ? loadPlaylists() : Promise.resolve()]);
  } catch (error) {
    setStatus(error.message, true);
  }
}

function parseCookiePayload(rawValue) {
  const raw = rawValue.trim();
  if (!raw) {
    throw new Error("Colle d'abord les cookies YouTube Music.");
  }

  if (!raw.startsWith("{")) {
    return { cookie: raw };
  }

  const parsed = JSON.parse(raw);
  const headers = parsed.auth_headers || parsed.headers || parsed;
  return {
    cookie: parsed.cookie || headers.cookie || headers.Cookie,
    auth_headers: headers,
    auth_user: parsed.auth_user || parsed.authUser || headers["x-goog-authuser"] || headers["X-Goog-AuthUser"] || "0",
    user_agent: parsed.user_agent || parsed.userAgent || headers["user-agent"] || headers["User-Agent"] || navigator.userAgent,
  };
}

async function saveYoutubeCookie() {
  try {
    const payload = parseCookiePayload(cookieInput.value);
    const data = await api("/api/music/youtube-auth", {
      method: "PUT",
      body: payload,
    });
    state.user.youtube_connected = data.youtube_connected;
    cookieInput.value = "";
    updateAuthUI();
    await loadPlaylists();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function copyCookieScript() {
  const fallback = `(() => {
  const payload = {
    cookie: document.cookie,
    auth_user: "0",
    user_agent: navigator.userAgent,
    origin: location.origin
  };
  copy(JSON.stringify(payload, null, 2));
  console.log("Cookies YouTube Music copiés. Colle le JSON dans le dashboard.");
})();`;

  try {
    const response = await fetch("/youtube-music-cookie-helper.js");
    const script = response.ok ? await response.text() : fallback;
    await navigator.clipboard.writeText(script);
    setStatus("Script copié. Lance-le dans la console de music.youtube.com.");
  } catch {
    await navigator.clipboard.writeText(fallback);
    setStatus("Script copié. Lance-le dans la console de music.youtube.com.");
  }
}

async function loadPlaylists() {
  if (!state.user?.youtube_connected) {
    return;
  }

  try {
    const data = await api("/api/music/playlists?limit=50");
    renderPlaylists(data.items || []);
  } catch (error) {
    setStatus(error.message, true);
  }
}

function renderPlaylists(playlists) {
  clearElement(playlistList);
  if (!playlists.length) {
    playlistList.appendChild(textNode("div", "empty-state", "Aucune playlist trouvée."));
    return;
  }

  playlists.forEach((playlist) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "playlist-item";
    button.dataset.playlistId = playlist.playlist_id;
    button.appendChild(thumb(playlist.thumbnail, playlist.title));

    const meta = document.createElement("div");
    meta.appendChild(textNode("div", "item-title", playlist.title));
    meta.appendChild(textNode("div", "item-subtitle", playlist.item_count || playlist.author || ""));
    button.appendChild(meta);
    playlistList.appendChild(button);
  });
}

async function loadHistory() {
  if (!state.user) {
    return;
  }
  try {
    const data = await api("/api/music/history?limit=10");
    state.history = data.items || [];
    renderHistory(state.history);
  } catch {
    state.history = [];
    clearElement(historyList);
  }
}

function renderHistory(items) {
  clearElement(historyList);
  if (!items.length) {
    historyList.appendChild(textNode("div", "empty-state", "Rien pour l'instant."));
    return;
  }

  items.forEach((item) => {
    item.kind = "track";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "compact-item";
    button.dataset.videoId = item.video_id;
    button.appendChild(thumb(item.thumbnail, item.title));

    const meta = document.createElement("div");
    meta.appendChild(textNode("div", "item-title", item.title));
    meta.appendChild(textNode("div", "item-subtitle", item.artist || item.duration || ""));
    button.appendChild(meta);
    historyList.appendChild(button);
  });
}

async function runSearch() {
  if (!state.user) {
    setStatus("Connecte-toi avant de chercher.", true);
    return;
  }

  const query = musicSearchInput.value.trim();
  if (!query) {
    return;
  }

  const playlistId = extractPlaylistId(query);
  if (playlistId) {
    await loadPlaylist(playlistId);
    return;
  }

  setStatus("Recherche en cours...");
  try {
    const params = new URLSearchParams({
      q: query,
      filter: state.activeFilter,
      limit: "24",
    });
    const data = await api(`/api/music/search?${params.toString()}`);
    state.lastResults = data.items || [];
    renderResults(state.lastResults);
    setStatus(`${state.lastResults.length} résultat(s).`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function loadPlaylist(playlistId) {
  setStatus("Chargement de la playlist...");
  try {
    const data = await api(`/api/music/playlists/${encodeURIComponent(playlistId)}?limit=100`);
    state.lastResults = data.tracks || [];
    renderResults(state.lastResults);
    const title = data.playlist?.title || "Playlist";
    setStatus(`${title} • ${state.lastResults.length} titre(s).`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

function renderEmptyResults(message) {
  clearElement(musicResults);
  musicResults.appendChild(textNode("div", "empty-state", message));
}

function renderResults(items) {
  clearElement(musicResults);
  if (!items.length) {
    renderEmptyResults("Aucun résultat.");
    return;
  }

  items.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "result-item";
    row.dataset.index = String(index);
    row.dataset.kind = item.kind;
    row.appendChild(thumb(item.thumbnail, item.title));

    const meta = document.createElement("div");
    meta.appendChild(textNode("div", "result-title", item.title));
    const subtitle = item.kind === "playlist"
      ? [item.author, item.item_count].filter(Boolean).join(" • ")
      : [item.artist, item.album, item.duration].filter(Boolean).join(" • ");
    meta.appendChild(textNode("div", "result-subtitle", subtitle));
    row.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "result-actions";

    if (item.kind === "playlist") {
      const open = document.createElement("button");
      open.type = "button";
      open.className = "primary-btn";
      open.dataset.action = "open-playlist";
      open.innerHTML = '<i class="fa-solid fa-list"></i> Ouvrir';
      actions.appendChild(open);
    } else {
      const play = document.createElement("button");
      play.type = "button";
      play.className = "primary-btn";
      play.dataset.action = "play";
      play.innerHTML = '<i class="fa-solid fa-play"></i> Play';
      actions.appendChild(play);

      const queue = document.createElement("button");
      queue.type = "button";
      queue.className = "icon-btn";
      queue.dataset.action = "queue";
      queue.title = "Ajouter à la queue";
      queue.innerHTML = '<i class="fa-solid fa-plus"></i>';
      actions.appendChild(queue);
    }

    row.appendChild(actions);
    musicResults.appendChild(row);
  });
}

function playableResults() {
  return state.lastResults.filter((item) => item.kind === "track" && item.video_id);
}

async function playTrack(track, queue = null, index = 0) {
  if (!track?.video_id) {
    return;
  }

  const baseQueue = queue || [track];
  state.queue = [...baseQueue];
  const nextIndex = state.queue.findIndex((item) => item.video_id === track.video_id);
  state.queueIndex = nextIndex >= 0 ? nextIndex : Math.max(0, index);
  state.currentTrack = track;
  state.playerMode = "youtube";
  updateNowPlaying();
  updateDockVisibility();
  heartbeat();

  try {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();

    const player = await ensureYouTubePlayer();
    player.setVolume(Math.round(Number(volume.value) * 100));
    player.loadVideoById(track.video_id);
    player.playVideo();
    state.isPlaying = true;
    updatePlayIcon();
    heartbeat();
    api("/api/music/history", { method: "POST", body: track }).then(loadHistory).catch(() => {});
  } catch (error) {
    state.isPlaying = false;
    updatePlayIcon();
    setStatus("Lecture bloquée par le navigateur.", true);
  }
}

async function playTrackOnTarget(track, queue = null, index = 0) {
  let nextQueue = queue || [track];
  let nextIndex = index;
  if (state.shuffle && nextQueue.length > 1) {
    nextQueue = shuffleQueue(nextQueue, index);
    nextIndex = 0;
  }

  if (isCurrentDeviceTarget()) {
    await playTrack(nextQueue[nextIndex] || track, nextQueue, nextIndex);
    return;
  }

  await sendRemoteCommand("play_track", {
    track: nextQueue[nextIndex] || track,
    queue: nextQueue,
    index: nextIndex,
    shuffle: state.shuffle,
    repeat_one: state.repeatOne,
  });
  setStatus(`Lecture envoyée vers ${selectedDeviceName()}.`);
}

function addToQueue(track) {
  if (!track?.video_id) {
    return;
  }
  if (!isCurrentDeviceTarget()) {
    sendRemoteCommand("play_track", {
      track,
      queue: [track],
      index: 0,
      shuffle: state.shuffle,
      repeat_one: state.repeatOne,
    }).then(() => setStatus(`Lecture envoyée vers ${selectedDeviceName()}.`)).catch((error) => setStatus(error.message, true));
    return;
  }
  state.queue.push(track);
  if (!state.currentTrack) {
    playTrack(track, state.queue, 0);
    return;
  }
  setStatus(`Ajouté à la queue : ${track.title}`);
}

function nextQueueIndex() {
  if (state.queue.length <= 1) {
    return -1;
  }
  if (state.shuffle) {
    let index = state.queueIndex;
    while (index === state.queueIndex) {
      index = Math.floor(Math.random() * state.queue.length);
    }
    return index;
  }
  return state.queueIndex + 1 < state.queue.length ? state.queueIndex + 1 : -1;
}

function playNextLocal(fromEnded = false) {
  if (state.repeatOne && fromEnded && state.currentTrack) {
    playTrack(state.currentTrack, state.queue, state.queueIndex);
    return;
  }

  const index = nextQueueIndex();
  if (index < 0) {
    state.isPlaying = false;
    updatePlayIcon();
    heartbeat();
    return;
  }
  playTrack(state.queue[index], state.queue, index);
}

async function playNext() {
  if (isCurrentDeviceTarget()) {
    playNextLocal(false);
    return;
  }
  await sendRemoteCommand("next").catch((error) => setStatus(error.message, true));
}

function playPreviousLocal() {
  if (state.queueIndex <= 0) {
    if (state.playerMode === "youtube" && youtubePlayer?.seekTo) {
      youtubePlayer.seekTo(0, true);
      youtubePlayer.playVideo();
      state.isPlaying = true;
      updatePlayIcon();
      heartbeat();
    } else {
      audio.currentTime = 0;
    }
    return;
  }
  playTrack(state.queue[state.queueIndex - 1], state.queue, state.queueIndex - 1);
}

async function playPrevious() {
  if (isCurrentDeviceTarget()) {
    playPreviousLocal();
    return;
  }
  await sendRemoteCommand("previous").catch((error) => setStatus(error.message, true));
}

function updateNowPlaying() {
  const track = selectedDeviceTrack();
  labelTrack.textContent = track?.title || "Aucun titre";
  const deviceNote = isCurrentDeviceTarget() ? "" : `${selectedDeviceName()} • `;
  labelArtiste.textContent = track
    ? `${deviceNote}${track.artist || track.duration || "YouTube Music"}`
    : "Connecte ton compte et lance une recherche";
  if (track?.thumbnail) {
    nowThumb.src = track.thumbnail;
  } else {
    nowThumb.removeAttribute("src");
  }
  nowThumb.alt = track?.title || "";
}

function updatePlayIcon() {
  const remoteDevice = selectedDevice();
  const isPlaying = isCurrentDeviceTarget()
    ? (state.playerMode === "youtube" ? state.isPlaying : !audio.paused)
    : Boolean(remoteDevice?.is_playing);
  playPauseBtn.innerHTML = isPlaying
    ? '<i class="fa-solid fa-pause"></i>'
    : '<i class="fa-solid fa-play"></i>';
}

function stopMusicLocal() {
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  if (youtubePlayer?.stopVideo) {
    youtubePlayer.stopVideo();
  }
  state.currentTrack = null;
  state.queueIndex = -1;
  state.isPlaying = false;
  updateNowPlaying();
  updatePlayIcon();
  updateDockVisibility();
  heartbeat();
}

async function stopMusic() {
  if (isCurrentDeviceTarget()) {
    stopMusicLocal();
    return;
  }
  await sendRemoteCommand("stop").catch((error) => setStatus(error.message, true));
}

function selectedDeviceName() {
  return state.devices.find((device) => device.device_id === state.targetDeviceId)?.name || "l'appareil choisi";
}

async function playLocal() {
  if (!state.currentTrack) {
    return;
  }
  if (state.playerMode === "youtube") {
    const player = await ensureYouTubePlayer();
    player.playVideo();
    state.isPlaying = true;
  } else if (audio.paused) {
    await audio.play().catch(() => setStatus("Lecture bloquée par le navigateur.", true));
  }
  updatePlayIcon();
  heartbeat();
}

function pauseLocal() {
  if (state.playerMode === "youtube" && youtubePlayer?.pauseVideo) {
    youtubePlayer.pauseVideo();
  } else {
    audio.pause();
  }
  state.isPlaying = false;
  updatePlayIcon();
  heartbeat();
}

async function togglePlaybackLocal() {
  if (!state.currentTrack) {
    return;
  }
  if (state.isPlaying) {
    pauseLocal();
  } else {
    await playLocal();
  }
}

function setVolumeLocal(value) {
  const nextVolume = Math.min(1, Math.max(0, Number(value)));
  volume.value = String(nextVolume);
  audio.volume = nextVolume;
  if (youtubePlayer?.setVolume) {
    youtubePlayer.setVolume(Math.round(nextVolume * 100));
  }
  heartbeat();
}

authPanel.addEventListener("submit", (event) => {
  event.preventDefault();
  authenticate("/api/auth/login");
});

registerBtn.addEventListener("click", () => authenticate("/api/auth/register"));

logoutBtn.addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" }).catch(() => {});
  state.user = null;
  stopMusicLocal();
  updateAuthUI();
});

saveCookieBtn.addEventListener("click", saveYoutubeCookie);
copyCookieScriptBtn.addEventListener("click", copyCookieScript);
refreshPlaylistsBtn.addEventListener("click", loadPlaylists);

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  runSearch();
});

filterTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    filterTabs.forEach((item) => item.classList.remove("active"));
    tab.classList.add("active");
    state.activeFilter = tab.dataset.filter;
    if (musicSearchInput.value.trim()) {
      runSearch();
    }
  });
});

playlistList.addEventListener("click", (event) => {
  const item = event.target.closest(".playlist-item");
  if (item?.dataset.playlistId) {
    loadPlaylist(item.dataset.playlistId);
  }
});

historyList.addEventListener("click", (event) => {
  const item = event.target.closest(".compact-item");
  if (!item?.dataset.videoId) {
    return;
  }
  const historyTrack = [...historyList.querySelectorAll(".compact-item")].indexOf(item);
  const track = state.history[historyTrack];
  if (track) {
    track.kind = "track";
    playTrackOnTarget(track);
  }
});

musicResults.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  const row = event.target.closest(".result-item");
  if (!button || !row) {
    return;
  }

  const item = state.lastResults[Number(row.dataset.index)];
  if (!item) {
    return;
  }

  if (button.dataset.action === "open-playlist") {
    loadPlaylist(item.playlist_id);
    return;
  }

  if (button.dataset.action === "queue") {
    addToQueue(item);
    return;
  }

  const queue = playableResults();
  const index = queue.findIndex((track) => track.video_id === item.video_id);
  playTrackOnTarget(item, queue, index >= 0 ? index : 0);
});

playPauseBtn.addEventListener("click", async () => {
  if (!state.currentTrack) {
    if (!isCurrentDeviceTarget()) {
      await sendRemoteCommand("toggle").catch((error) => setStatus(error.message, true));
    }
    return;
  }

  if (!isCurrentDeviceTarget()) {
    await sendRemoteCommand("toggle").catch((error) => setStatus(error.message, true));
    return;
  }

  await togglePlaybackLocal();
});

prevBtn.addEventListener("click", playPrevious);
nextBtn.addEventListener("click", playNext);
musicStop.addEventListener("click", stopMusic);

shuffleBtn.addEventListener("click", async () => {
  state.shuffle = !state.shuffle;
  updateModeButtons();
  if (!isCurrentDeviceTarget()) {
    await sendRemoteCommand("shuffle", { enabled: state.shuffle }).catch((error) => setStatus(error.message, true));
  }
});

repeatBtn.addEventListener("click", async () => {
  state.repeatOne = !state.repeatOne;
  updateModeButtons();
  if (!isCurrentDeviceTarget()) {
    await sendRemoteCommand("repeat_one", { enabled: state.repeatOne }).catch((error) => setStatus(error.message, true));
  }
});

deviceSelect.addEventListener("change", () => {
  state.targetDeviceId = deviceSelect.value || state.deviceId;
  localStorage.setItem(TARGET_DEVICE_KEY, state.targetDeviceId);
  const device = selectedDevice();
  if (!isCurrentDeviceTarget() && typeof device?.volume === "number") {
    volume.value = String(device.volume);
  }
  updateNowPlaying();
  updatePlayIcon();
  updateDockVisibility();
  setStatus(isCurrentDeviceTarget() ? "Lecture sur cet appareil." : `Remote vers ${selectedDeviceName()}.`);
});

volume.value = "0.5";
audio.volume = Number(volume.value);
volume.addEventListener("input", () => {
  if (isCurrentDeviceTarget()) {
    setVolumeLocal(volume.value);
    return;
  }
  sendRemoteCommand("volume", { volume: Number(volume.value) }).catch((error) => setStatus(error.message, true));
});

audio.addEventListener("play", () => {
  if (state.playerMode === "audio") {
    updatePlayIcon();
  }
});
audio.addEventListener("pause", () => {
  if (state.playerMode === "audio") {
    updatePlayIcon();
  }
});
audio.addEventListener("ended", () => {
  if (state.playerMode === "audio") {
    playNextLocal(true);
  }
});

initVisualizer(audio);
updateModeButtons();
updateDockVisibility();
loadMe();
