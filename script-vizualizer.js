const canvas = document.getElementById("visualizer");
const ctx = canvas.getContext("2d");

// Brancher l'audio sur l'analyser
const audioCtx = new AudioContext();
const source = audioCtx.createMediaElementSource(audio);
const analyser = audioCtx.createAnalyser();

source.connect(analyser);
analyser.connect(audioCtx.destination); // ⚠️ sinon le son est coupé

analyser.fftSize = 256; // nombre de barres (divisé par 2)
const bufferLength = analyser.frequencyBinCount; // 128 barres
const dataArray = new Uint8Array(bufferLength);

function draw() {
  requestAnimationFrame(draw);

  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;

  analyser.getByteFrequencyData(dataArray);

  const barWidth = canvas.width / bufferLength;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  dataArray.forEach((value, i) => {
    const barHeight = (value / 255) * canvas.height;
    const x = i * barWidth;

    ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
    ctx.fillRect(x, canvas.height - barHeight, barWidth - 2, barHeight);
  });
}

draw();