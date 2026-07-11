/* ============================================================
   Light Archive — reel engine
   - Builds the reel + collections from images/manifest.json
   - WebGL (Three.js) displacement dissolve between photos,
     driven by scroll; Ken Burns drift on the active photo
   - Sets --accent from each photo's dominant hue
   - Falls back to plain sticky images if WebGL is unavailable
     or prefers-reduced-motion is set
   ============================================================ */

import * as THREE from "three";

const supportsWebP = document.createElement("canvas")
  .toDataURL("image/webp").startsWith("data:image/webp");
const ext = supportsWebP ? "webp" : "jpg";
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const state = { reel: [], sections: [], active: -1, progress: 0 };

init();

async function init() {
  const res = await fetch("images/manifest.json");
  const manifest = await res.json();
  state.reel = manifest.reel;

  buildReel(manifest.reel);
  buildCollections(manifest.collections);
  document.getElementById("year").textContent = new Date().getFullYear();

  if (!reducedMotion && webglAvailable()) {
    startGL().catch(() => {/* leave DOM fallback visible */});
  }
  observeReel();
}

/* ---------- DOM construction ---------- */

function buildReel(items) {
  const reel = document.getElementById("reel");
  const idx = document.createElement("p");
  idx.className = "reel-index";
  idx.innerHTML = `<span class="n">01</span> / ${String(items.length).padStart(2, "0")}`;
  document.body.appendChild(idx);

  items.forEach((item, i) => {
    const fig = document.createElement("figure");
    fig.className = "reel-item";
    fig.dataset.index = i;
    fig.innerHTML = `
      <img src="images/full/${item.slug}.${ext}" alt="${escapeHtml(item.alt)}"
           ${i > 1 ? 'loading="lazy"' : ""} crossorigin="anonymous">
      <div class="reel-caption">
        <h3>${item.title}</h3>
        <p>${item.region} — Photograph by Ulana Rey</p>
      </div>`;
    reel.appendChild(fig);
  });
}

function buildCollections(groups) {
  const wrap = document.querySelector(".collections-groups");
  groups.forEach((g) => {
    const div = document.createElement("div");
    div.className = "col-group";
    div.innerHTML = `<h3>${g.group}</h3>`;
    const grid = document.createElement("div");
    grid.className = "col-grid";
    g.items.forEach((it) => {
      const alt = it.alt || altFromReel(it.slug);
      grid.innerHTML += `
        <figure>
          <img src="images/full/${it.slug}.${ext}" alt="${escapeHtml(alt)}" loading="lazy">
          <figcaption>${it.title}</figcaption>
        </figure>`;
    });
    div.appendChild(grid);
    wrap.appendChild(div);
  });
}

function altFromReel(slug) {
  const hit = state.reel.find((r) => r.slug === slug);
  return hit ? hit.alt : "Travel photograph by Ulana Rey PharmD";
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

/* ---------- Active-photo tracking + accent ---------- */

function observeReel() {
  state.sections = [...document.querySelectorAll(".reel-item")];
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) setActive(+e.target.dataset.index);
        e.target.classList.toggle("is-active", e.isIntersecting);
      });
    },
    { threshold: 0.45 }
  );
  state.sections.forEach((s) => io.observe(s));

  const reelBounds = new IntersectionObserver(
    (entries) => document.body.classList.toggle("in-reel", entries[0].isIntersecting),
    { threshold: 0.02 }
  );
  reelBounds.observe(document.getElementById("reel"));
}

function setActive(i) {
  if (i === state.active) return;
  state.active = i;
  const item = state.reel[i];
  document.documentElement.style.setProperty("--accent", item.accent);
  const n = document.querySelector(".reel-index .n");
  if (n) n.textContent = String(i + 1).padStart(2, "0");
}

/* ---------- WebGL displacement reel ---------- */

function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch { return false; }
}

async function startGL() {
  const canvas = document.getElementById("gl");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const loader = new THREE.TextureLoader();
  const textures = await Promise.all(
    state.reel.map(
      (item) =>
        new Promise((resolve, reject) =>
          loader.load(`images/full/${item.slug}.${ext}`, (t) => {
            t.minFilter = THREE.LinearFilter;
            t.generateMipmaps = false;
            resolve(t);
          }, undefined, reject)
        )
    )
  );

  const uniforms = {
    uTexA: { value: textures[0] },
    uTexB: { value: textures[0] },
    uSizeA: { value: texSize(textures[0]) },
    uSizeB: { value: texSize(textures[0]) },
    uMix: { value: 0 },
    uDrift: { value: 0 },
    uRes: { value: new THREE.Vector2(innerWidth, innerHeight) },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uTexA, uTexB;
      uniform vec2 uSizeA, uSizeB, uRes;
      uniform float uMix, uDrift;

      /* cover-fit uv for a texture of size s in viewport uRes, with slow Ken Burns drift */
      vec2 cover(vec2 uv, vec2 s, float drift) {
        float ra = uRes.x / uRes.y, rt = s.x / s.y;
        vec2 scale = (ra > rt) ? vec2(1.0, rt / ra) : vec2(ra / rt, 1.0);
        vec2 c = (uv - 0.5) * scale * (1.0 - 0.06 * drift) + 0.5;
        c.x += 0.015 * drift;
        return c;
      }

      /* simple value noise for the displacement field */
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
                   mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }

      void main() {
        float n = noise(vUv * 6.0);
        float t = uMix;
        /* displacement pushes A out and pulls B in along the noise field */
        vec2 dispA = vec2(n - 0.5) * 0.22 * t;
        vec2 dispB = vec2(n - 0.5) * 0.22 * (1.0 - t);
        vec4 a = texture2D(uTexA, cover(vUv + dispA, uSizeA, uDrift));
        vec4 b = texture2D(uTexB, cover(vUv + dispB, uSizeB, uDrift));
        float m = smoothstep(0.15, 0.85, t + (n - 0.5) * 0.35);
        gl_FragColor = mix(a, b, m);
      }`,
  });

  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  document.body.classList.add("gl-on");

  addEventListener("resize", () => {
    renderer.setSize(innerWidth, innerHeight);
    uniforms.uRes.value.set(innerWidth, innerHeight);
  });

  const reelEl = document.getElementById("reel");
  let smooth = 0;

  function frame(time) {
    const rect = reelEl.getBoundingClientRect();
    const total = rect.height - innerHeight;
    const raw = Math.min(Math.max(-rect.top / Math.max(total, 1), 0), 1);
    smooth += (raw - smooth) * 0.08;

    const seg = smooth * (state.reel.length - 1);
    const i = Math.min(Math.floor(seg), state.reel.length - 2);
    const local = seg - i;

    uniforms.uTexA.value = textures[Math.max(i, 0)];
    uniforms.uTexB.value = textures[Math.min(i + 1, textures.length - 1)];
    uniforms.uSizeA.value = texSize(uniforms.uTexA.value);
    uniforms.uSizeB.value = texSize(uniforms.uTexB.value);
    uniforms.uMix.value = easeInOut(local);
    uniforms.uDrift.value = (Math.sin(time * 0.00012) + 1) / 2;

    /* only render while the reel is on screen */
    if (rect.bottom > 0 && rect.top < innerHeight) renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function texSize(t) {
  return new THREE.Vector2(t.image.naturalWidth || t.image.width, t.image.naturalHeight || t.image.height);
}

function easeInOut(t) { return t * t * (3 - 2 * t); }
