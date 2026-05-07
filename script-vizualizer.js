const canvas = document.getElementById("visualizer");
const ctx = canvas.getContext("2d");
const visualizedAudio = window.musicAudioElement;

let audioCtx = null;
let analyser = null;
let dataArray = null;
let bufferLength = 0;
let animationId = null;

function setupVisualizer() {
  if (audioCtx || !visualizedAudio) {
    return;
  }

  audioCtx = new AudioContext();
  const source = audioCtx.createMediaElementSource(visualizedAudio);
  analyser = audioCtx.createAnalyser();

  source.connect(analyser);
  analyser.connect(audioCtx.destination);

  analyser.fftSize = 256;
  bufferLength = analyser.frequencyBinCount;
  dataArray = new Uint8Array(bufferLength);
}

function draw() {
  if (!analyser || !dataArray || visualizedAudio.paused) {
    animationId = null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  analyser.getByteFrequencyData(dataArray);

  const barWidth = canvas.width / bufferLength;
  dataArray.forEach((value, i) => {
    const barHeight = (value / 255) * canvas.height;
    const x = i * barWidth;
    ctx.fillStyle = "rgba(255, 255, 255, 0.82)";
    ctx.fillRect(x, canvas.height - barHeight, Math.max(1, barWidth - 2), barHeight);
  });

  animationId = requestAnimationFrame(draw);
}

window.resumeMusicVisualizer = function resumeMusicVisualizer() {
  setupVisualizer();
  if (audioCtx?.state === "suspended") {
    audioCtx.resume();
  }
  if (!animationId) {
    animationId = requestAnimationFrame(draw);
  }
};
