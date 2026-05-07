const audio = document.getElementById("audio2");
const video = document.getElementById("fond1");
const bg = document.getElementById("bg");
const backBtn = document.getElementById("backBtn");
const musicBtn = document.getElementById("musicBtn");
const overlayMusic = document.getElementById("overlay");
const volume = document.getElementById("volume");
const labelArtiste = document.getElementById("artist");
const labelTrack = document.getElementById("track");
const musicStop = document.getElementById("musicStop");

musicBtn.onclick = () => {
  jsmediatags.read(audio.src, {
    onSuccess: (tag) => {
      const tags = tag.tags;
      labelTrack.innerText = tags.title || "Titre inconnu";
      labelArtiste.innerText = tags.artist || "Artiste inconnu";
    },
    onError: (err) => {
      console.error("Erreur lecture tags :", err);
      labelTrack.innerText = "Titre inconnu";
      labelArtiste.innerText = "Artiste inconnu";
    }
  });
  bg.style.display = "none";
  backBtn.style.display = "block";
  musicBtn.style.display = "none"
  overlayMusic.style.display = "flex";
  audio.play();
  audioCtx.resume();
  video.style.display = "block";
  video.play();
  playing = true;
};

backBtn.onclick = () => {
    bg.style.display = "block";
    video.pause();
    video.style.display = "none";
    backBtn.style.display = "none";
    musicBtn.style.display = "block"
}

musicStop.onclick = () => {
  audio.pause();
  overlayMusic.style.display = "none";
}

// volume
volume.value = 0.5;
audio.volume = 0.5;

volume.oninput = () => {
  audio.volume = volume.value;
};