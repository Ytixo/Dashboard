export function initVisualizer(audio) {
  const canvas = document.getElementById("visualizer");
  const ctx = canvas.getContext("2d");
  let audioCtx = null;
  let analyser = null;
  let dataArray = null;
  let animationId = null;

  function setup() {
    if (audioCtx || !audio) {
      return;
    }
    audioCtx = new AudioContext();
    analyser = audioCtx.createAnalyser();
    audioCtx.createMediaElementSource(audio).connect(analyser);
    analyser.connect(audioCtx.destination);
    analyser.fftSize = 256;
    dataArray = new Uint8Array(analyser.frequencyBinCount);
  }

  function draw() {
    if (!analyser || !dataArray || audio.paused) {
      animationId = null;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    analyser.getByteFrequencyData(dataArray);

    const barWidth = canvas.width / dataArray.length;
    dataArray.forEach((value, index) => {
      const barHeight = (value / 255) * canvas.height;
      ctx.fillStyle = "rgba(255, 255, 255, 0.82)";
      ctx.fillRect(index * barWidth, canvas.height - barHeight, Math.max(1, barWidth - 2), barHeight);
    });

    animationId = requestAnimationFrame(draw);
  }

  window.resumeMusicVisualizer = () => {
    setup();
    if (audioCtx?.state === "suspended") {
      audioCtx.resume();
    }
    if (!animationId) {
      animationId = requestAnimationFrame(draw);
    }
  };
}
