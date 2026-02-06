import { initGardenCanvas } from "/assets/js/garden.js";

const STORAGE = {
  theme: "cj-theme",
  sound: "cj-sound",
  intro: "cj-intro-dismissed",
};

function unlockBodyScroll() {
  document.body.classList.remove("menu-open");
}

function isInternalLink(anchor) {
  if (!(anchor instanceof HTMLAnchorElement)) return false;
  if (anchor.target && anchor.target !== "_self") return false;
  if (anchor.hasAttribute("download")) return false;
  const href = anchor.getAttribute("href") || "";
  if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return false;
  try {
    const url = new URL(anchor.href);
    return url.origin === window.location.origin;
  } catch {
    return false;
  }
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function getStored(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setStored(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function getSystemTheme() {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(theme) {
  const safe = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = safe;
  const meta = document.querySelector('meta[name="theme-color"]:not([media])');
  if (meta) meta.setAttribute("content", safe === "dark" ? "#030303" : "#e8e8e8");
  return safe;
}

function updateThemeToggleLabel(btn, theme) {
  if (!btn) return;
  const next = theme === "dark" ? "light" : "dark";
  btn.setAttribute("aria-label", `Switch to ${next} theme`);
  btn.dataset.theme = theme;
}

function renderSoundToggle(btn, enabled) {
  if (!btn) return;
  btn.dataset.sound = enabled ? "on" : "off";
  btn.setAttribute("aria-label", enabled ? "Disable sound" : "Enable sound");
}

class GardenAudio {
  constructor() {
    this.ctx = null;
    this.gain = null;
    this.noise = null;
    this.filter = null;
    this.enabled = false;
  }

  ensure() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;

    const ctx = new Ctx();
    const gain = ctx.createGain();
    gain.gain.value = 0;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 720;
    filter.Q.value = 0.6;

    // looped noise buffer
    const seconds = 2.5;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * 0.25;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start();

    this.ctx = ctx;
    this.gain = gain;
    this.noise = noise;
    this.filter = filter;
  }

  async setEnabled(nextEnabled) {
    const next = Boolean(nextEnabled);
    this.enabled = next;
    setStored(STORAGE.sound, next ? "on" : "off");

    this.ensure();
    if (!this.ctx || !this.gain) return;

    const now = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);

    if (next) {
      try {
        await this.ctx.resume();
      } catch {
        // ignore
      }
      this.gain.gain.setValueAtTime(this.gain.gain.value, now);
      this.gain.gain.linearRampToValueAtTime(0.06, now + 0.35);
    } else {
      this.gain.gain.setValueAtTime(this.gain.gain.value, now);
      this.gain.gain.linearRampToValueAtTime(0, now + 0.25);
      window.setTimeout(() => {
        if (!this.enabled && this.ctx && this.ctx.state === "running") {
          this.ctx.suspend().catch(() => {});
        }
      }, 320);
    }
  }
}

function setupIntro(audio) {
  const intro = document.querySelector("[data-intro]");
  if (!intro) return;

  const alreadyDismissed = getStored(STORAGE.intro) === "1";
  if (alreadyDismissed) {
    intro.classList.add("is-hidden");
    intro.setAttribute("hidden", "hidden");
    return;
  }

  const btnSound = intro.querySelector("[data-intro-sound]");
  const btnMuted = intro.querySelector("[data-intro-muted]");
  const soundToggleBtn = document.querySelector("[data-sound-toggle]");

  let didHide = false;
  let failSafeTimer = 0;
  const keyDismiss = new Set(["Escape", " ", "ArrowDown", "PageDown", "End"]);

  const teardown = () => {
    window.removeEventListener("wheel", onScrollIntent);
    window.removeEventListener("touchmove", onScrollIntent);
    window.removeEventListener("keydown", onKeyIntent);
    window.clearTimeout(failSafeTimer);
  };

  const hide = () => {
    if (didHide) return;
    didHide = true;
    teardown();
    intro.classList.add("is-hidden");
    setStored(STORAGE.intro, "1");
    window.setTimeout(() => {
      intro.setAttribute("hidden", "hidden");
    }, 320);
  };

  const onScrollIntent = () => hide();
  const onKeyIntent = (e) => {
    if (!keyDismiss.has(String(e.key))) return;
    hide();
  };

  if (!btnSound || !btnMuted) {
    hide();
    return;
  }

  intro.removeAttribute("hidden");

  if (btnSound) btnSound.focus();

  // If users try to scroll immediately, dismiss intro instead of blocking the page.
  window.addEventListener("wheel", onScrollIntent, { passive: true });
  window.addEventListener("touchmove", onScrollIntent, { passive: true });
  window.addEventListener("keydown", onKeyIntent);

  // Fail-safe: never keep a full-screen gate forever.
  failSafeTimer = window.setTimeout(() => hide(), 12000);

  btnSound?.addEventListener("click", async () => {
    await audio.setEnabled(true);
    renderSoundToggle(soundToggleBtn, true);
    hide();
  });

  btnMuted?.addEventListener("click", async () => {
    await audio.setEnabled(false);
    renderSoundToggle(soundToggleBtn, false);
    hide();
  });
}

function setupMenu() {
  const overlay = document.querySelector("[data-menu]");
  const toggle = document.querySelector("[data-menu-toggle]");
  if (!overlay || !toggle) return;

  let lastActive = null;

  const renderToggleLabel = (isOpen) => {
    toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    toggle.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
  };

  const getFocusable = () =>
    Array.from(
      overlay.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );

  const trapTab = (e) => {
    if (e.key !== "Tab") return;
    const focusables = getFocusable();
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;

    if (e.shiftKey) {
      if (active === first || active === overlay) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const close = () => {
    overlay.classList.remove("is-open");
    renderToggleLabel(false);
    unlockBodyScroll();
    overlay.removeEventListener("keydown", trapTab);
    try {
      if (lastActive && typeof lastActive.focus === "function") lastActive.focus();
    } catch {
      // ignore focus restoration issues
    }
  };

  const open = () => {
    lastActive = document.activeElement;
    overlay.classList.add("is-open");
    renderToggleLabel(true);
    document.body.classList.add("menu-open");
    overlay.addEventListener("keydown", trapTab);
    getFocusable()[0]?.focus?.();
  };

  renderToggleLabel(overlay.classList.contains("is-open"));

  toggle.addEventListener("click", () => {
    if (overlay.classList.contains("is-open")) close();
    else open();
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  window.addEventListener("pageshow", () => {
    overlay.classList.remove("is-open");
    renderToggleLabel(false);
    overlay.removeEventListener("keydown", trapTab);
    unlockBodyScroll();
  });

  for (const link of overlay.querySelectorAll("a")) {
    link.addEventListener("click", () => close());
  }
}

function setupPageTransitions() {
  if (prefersReducedMotion()) return;

  document.addEventListener("click", (e) => {
    if (e.defaultPrevented) return;
    if (e.button && e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target instanceof Element ? e.target.closest("a") : null;
    if (!a || !(a instanceof HTMLAnchorElement)) return;
    if (!isInternalLink(a)) return;

    const url = new URL(a.href);
    if (url.pathname === window.location.pathname && url.hash) return;

    e.preventDefault();
    unlockBodyScroll();
    document.body.classList.add("is-leaving");

    window.setTimeout(() => {
      document.body.classList.remove("is-leaving");
      unlockBodyScroll();
    }, 1800);

    window.setTimeout(() => {
      try {
        window.location.assign(a.href);
      } catch {
        window.location.href = a.href;
      }
    }, 310);
  });
}

function setupTheme(gardenController) {
  const toggle = document.querySelector("[data-theme-toggle]");
  const stored = getStored(STORAGE.theme);
  const initial = applyTheme(stored || getSystemTheme());
  updateThemeToggleLabel(toggle, initial);
  gardenController?.setTheme?.(initial);

  toggle?.addEventListener("click", () => {
    const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next);
    setStored(STORAGE.theme, next);
    updateThemeToggleLabel(toggle, next);
    gardenController?.setTheme?.(next);
  });
}

function setupSound(audio) {
  const btn = document.querySelector("[data-sound-toggle]");
  if (!btn) return;

  const stored = getStored(STORAGE.sound);
  const enabled = stored === "on";
  renderSoundToggle(btn, enabled);

  // If the user prefers sound, start on first gesture (autoplay policies).
  if (enabled) {
    const startOnce = async () => {
      window.removeEventListener("pointerdown", startOnce, { capture: true });
      window.removeEventListener("keydown", startOnce, { capture: true });
      await audio.setEnabled(true);
      renderSoundToggle(btn, true);
    };
    window.addEventListener("pointerdown", startOnce, { passive: true, capture: true, once: true });
    window.addEventListener("keydown", startOnce, { capture: true, once: true });
  }

  btn.addEventListener("click", async () => {
    const current = btn.dataset.sound === "on";
    const next = !current;
    await audio.setEnabled(next);
    renderSoundToggle(btn, next);
  });
}

function setupReveal() {
  const els = Array.from(document.querySelectorAll("[data-reveal]"));
  if (!els.length) return;

  document.documentElement.classList.add("js");

  if (!("IntersectionObserver" in window)) {
    for (const el of els) el.classList.add("is-revealed");
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-revealed");
        io.unobserve(entry.target);
      }
    },
    { threshold: 0.12 }
  );

  for (const el of els) io.observe(el);
}

function setupLiteEmbeds() {
  const nodes = Array.from(document.querySelectorAll("[data-lite-yt]"));
  if (!nodes.length) return;

  for (const node of nodes) {
    const videoId = node.getAttribute("data-lite-yt");
    const start = node.getAttribute("data-start") || "";
    const btn = node.querySelector("button");
    if (!videoId || !(btn instanceof HTMLButtonElement)) continue;

    btn.addEventListener("click", () => {
      const params = new URLSearchParams({
        autoplay: "1",
        rel: "0",
        modestbranding: "1",
      });
      if (start) params.set("start", start);

      const iframe = document.createElement("iframe");
      iframe.loading = "lazy";
      iframe.allow =
        "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
      iframe.allowFullscreen = true;
      iframe.title = "YouTube video";
      iframe.src = `https://www.youtube.com/embed/${videoId}?${params.toString()}`;

      node.innerHTML = "";
      node.appendChild(iframe);
    });
  }
}

function setupSmoothScroll() {
  if (prefersReducedMotion()) return;
  if (window.matchMedia("(pointer: coarse)").matches) return;
  const Lenis = window.Lenis;
  if (!Lenis) return;

  let lenis = null;
  try {
    // eslint-disable-next-line no-undef
    lenis = new Lenis({
      duration: 1.1,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      direction: "vertical",
      gestureDirection: "vertical",
      smooth: true,
      smoothTouch: false,
      touchMultiplier: 1.4,
    });
  } catch {
    return;
  }

  let rafId = 0;
  const raf = (time) => {
    try {
      lenis.raf(time);
      rafId = requestAnimationFrame(raf);
    } catch {
      if (rafId) cancelAnimationFrame(rafId);
      lenis?.destroy?.();
      lenis = null;
    }
  };
  rafId = requestAnimationFrame(raf);

  window.addEventListener(
    "pagehide",
    () => {
      if (rafId) cancelAnimationFrame(rafId);
      lenis?.destroy?.();
      lenis = null;
    },
    { once: true }
  );
}

function setupBackstageEasterEgg() {
  // Hint: press "b" then "g" within 1s
  let buffer = "";
  let timer = 0;
  window.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = String(e.key || "").toLowerCase();
    if (!/^[a-z]$/.test(key)) return;
    buffer += key;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => (buffer = ""), 900);
    if (buffer.endsWith("bg")) window.location.assign("/backstage/");
  });
}

function mount() {
  // Initial paint + transitions
  document.body.classList.add("is-ready");
  unlockBodyScroll();

  // WebGL-ish hero canvas
  const canvas = document.querySelector("#garden");
  const gardenController = canvas ? initGardenCanvas(canvas, { theme: getSystemTheme() }) : null;

  // Theme + Menu + Audio
  setupTheme(gardenController);

  const audio = new GardenAudio();
  setupIntro(audio);
  setupSound(audio);

  setupMenu();
  setupPageTransitions();
  setupReveal();
  setupLiteEmbeds();
  setupSmoothScroll();
  setupBackstageEasterEgg();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount);
} else {
  mount();
}
