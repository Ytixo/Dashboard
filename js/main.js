import { hideDocs, showDocs } from "./docs.js?v=20260509-2";
import { hideMusic, initMusic, refreshMusicDock, showMusic } from "./music.js?v=20260509-2";

function getElement(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Element #${id} introuvable.`);
  }
  return element;
}

const bg = getElement("bg");
const video = getElement("fond1");
const backBtn = getElement("backBtn");
const musicBtn = getElement("musicBtn");
const docsBtn = getElement("docsBtn");
const videoLoader = getElement("videoLoader");

function activeVideo() {
  return video.style.display === "block" ? video : bg;
}

function showMainButtons(isVisible) {
  musicBtn.style.display = isVisible ? "inline-flex" : "none";
  docsBtn.style.display = isVisible ? "inline-flex" : "none";
}

function showVideoLoader() {
  videoLoader.classList.remove("hidden");
}

function hideVideoLoader() {
  videoLoader.classList.add("hidden");
}

function setLoadingVideo(target = activeVideo()) {
  target.readyState >= 2 ? hideVideoLoader() : showVideoLoader();
}

function watchVideoLoad(target) {
  ["loadstart", "waiting", "stalled"].forEach((eventName) => {
    target.addEventListener(eventName, () => target === activeVideo() && showVideoLoader());
  });

  ["loadeddata", "canplay", "playing", "error"].forEach((eventName) => {
    target.addEventListener(eventName, () => target === activeVideo() && hideVideoLoader());
  });
}

function openMusic() {
  bg.style.display = "none";
  video.style.display = "block";
  backBtn.style.display = "inline-flex";
  showMainButtons(false);
  hideDocs();
  showMusic();
  setLoadingVideo(video);
  video.play().then(hideVideoLoader).catch(hideVideoLoader);
}

function openDocs() {
  bg.style.display = "block";
  video.pause();
  video.style.display = "none";
  backBtn.style.display = "inline-flex";
  showMainButtons(false);
  hideMusic();
  showDocs();
  setLoadingVideo(bg);
}

function closePanel() {
  bg.style.display = "block";
  video.pause();
  video.style.display = "none";
  backBtn.style.display = "none";
  showMainButtons(true);
  hideMusic();
  hideDocs();
  setLoadingVideo(bg);
}

let started = false;

export function initMain() {
  if (started) {
    return;
  }
  started = true;
  window.dashboardMainReady = true;
  initMusic();
  musicBtn.addEventListener("click", openMusic);
  docsBtn.addEventListener("click", openDocs);
  backBtn.addEventListener("click", closePanel);
  [bg, video].forEach(watchVideoLoad);
  setLoadingVideo(bg);
  refreshMusicDock();
}
