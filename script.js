const audio = document.getElementById("audio");
const player = document.getElementById("player")
const video = document.getElementById("bg");
const volume = document.getElementById("volume");
const labelArtiste = document.getElementById("artist");
const labelTrack = document.getElementById("track");

let playing = false;

player.onclick = () => {
  if (!playing) {
    labelTrack.innerText = audio.src 
    audio.play();
    video.play();
    playing = true;
    console.log();
  } else {
    audio.pause();
    playing = false;
  }
};



// volume
volume.value = 0.5;
audio.volume = 0.5;

volume.oninput = () => {
  audio.volume = volume.value;
};