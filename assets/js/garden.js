const DPR_CAP = 2;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function makeGradient(ctx, width, height, theme) {
  const g = ctx.createLinearGradient(0, 0, 0, height);
  if (theme === "dark") {
    g.addColorStop(0, "rgba(255,255,255,0.06)");
    g.addColorStop(0.6, "rgba(255,255,255,0.02)");
    g.addColorStop(1, "rgba(0,0,0,0)");
  } else {
    g.addColorStop(0, "rgba(3,3,3,0.06)");
    g.addColorStop(0.6, "rgba(3,3,3,0.03)");
    g.addColorStop(1, "rgba(0,0,0,0)");
  }
  return g;
}

function buildBlades(width, count) {
  const blades = [];
  for (let i = 0; i < count; i += 1) {
    const x = (i + Math.random() * 0.4) * (width / count);
    const height = (0.25 + Math.random() * 0.75) * 220;
    const phase = Math.random() * Math.PI * 2;
    const thickness = 0.6 + Math.random() * 1.2;
    blades.push({ x, height, phase, thickness });
  }
  return blades;
}

export function initGardenCanvas(canvas, { theme = "light" } = {}) {
  if (!(canvas instanceof HTMLCanvasElement)) return null;

  const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
  if (!ctx) return null;

  const mediaReduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reduceMotion = mediaReduce.matches;

  let rafId = 0;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let blades = [];
  let gradient = null;

  const pointer = { x: 0, y: 0, active: false };

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, Math.floor(rect.width));
    height = Math.max(1, Math.floor(rect.height));

    dpr = clamp(window.devicePixelRatio || 1, 1, DPR_CAP);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const bladeCount = clamp(Math.round(width / 10), 70, 240);
    blades = buildBlades(width, bladeCount);
    gradient = makeGradient(ctx, width, height, theme);

    draw(performance.now());
  }

  function draw(now) {
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = gradient || makeGradient(ctx, width, height, theme);
    ctx.fillRect(0, 0, width, height);

    const t = now * 0.001;
    const baseY = height * 0.86;

    const strokeBase =
      theme === "dark" ? "rgba(255,255,255,0.18)" : "rgba(3,3,3,0.18)";
    const strokeThin =
      theme === "dark" ? "rgba(255,255,255,0.09)" : "rgba(3,3,3,0.09)";

    for (const blade of blades) {
      const x = blade.x;
      const swayBase =
        Math.sin(t * 0.85 + blade.phase) * 10 +
        Math.sin(t * 0.35 + x * 0.008) * 12;

      let sway = swayBase;
      if (pointer.active) {
        const dist = Math.abs(pointer.x - x);
        const influence = Math.pow(1 - clamp(dist / (width * 0.45), 0, 1), 2);
        const push = (pointer.x - x) * 0.03;
        sway += push * influence;
      }

      const h = blade.height * (0.7 + 0.3 * Math.sin(t * 0.2 + blade.phase));
      const tipX = x + sway;
      const tipY = baseY - h;
      const ctrlX = x + sway * 0.25;
      const ctrlY = baseY - h * 0.55;

      ctx.beginPath();
      ctx.moveTo(x, baseY);
      ctx.quadraticCurveTo(ctrlX, ctrlY, tipX, tipY);
      ctx.lineWidth = blade.thickness;
      ctx.strokeStyle = blade.thickness > 1.15 ? strokeBase : strokeThin;
      ctx.stroke();
    }

    // small drifting seeds
    const seedCount = reduceMotion ? 0 : 16;
    if (seedCount) {
      ctx.fillStyle =
        theme === "dark" ? "rgba(255,255,255,0.12)" : "rgba(3,3,3,0.10)";
      for (let i = 0; i < seedCount; i += 1) {
        const sx = (Math.sin(t * 0.3 + i * 9.1) * 0.5 + 0.5) * width;
        const sy = (Math.sin(t * 0.4 + i * 3.7) * 0.5 + 0.5) * (height * 0.6);
        ctx.beginPath();
        ctx.arc(sx, sy, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function frame(now) {
    draw(now);
    rafId = requestAnimationFrame(frame);
  }

  function onPointerMove(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = e.clientX - rect.left;
    pointer.y = e.clientY - rect.top;
    pointer.active = true;
  }

  function onPointerLeave() {
    pointer.active = false;
  }

  function setTheme(nextTheme) {
    theme = nextTheme === "dark" ? "dark" : "light";
    gradient = makeGradient(ctx, width, height, theme);
    draw(performance.now());
  }

  function setReduceMotion(next) {
    reduceMotion = Boolean(next);
    draw(performance.now());
  }

  function start() {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  const onReduceChange = () => setReduceMotion(mediaReduce.matches);
  if (mediaReduce.addEventListener) mediaReduce.addEventListener("change", onReduceChange);
  else mediaReduce.addListener(onReduceChange);

  canvas.addEventListener("pointermove", onPointerMove, { passive: true });
  canvas.addEventListener("pointerleave", onPointerLeave, { passive: true });

  resize();
  if (!reduceMotion) start();

  return {
    setTheme,
    destroy() {
      stop();
      ro.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      if (mediaReduce.removeEventListener) mediaReduce.removeEventListener("change", onReduceChange);
      else mediaReduce.removeListener(onReduceChange);
    },
  };
}

