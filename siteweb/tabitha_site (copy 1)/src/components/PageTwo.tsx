import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GALAXY_ICONS } from "../data/library";

const VORTEX_MS = 7000; // ride duration inside the star vortex
const BLEND_MS = 2600; // crossfade from vortex to galaxy

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const smooth01 = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
// Cheap gaussian-ish jitter in [-1.5, 1.5]
const jitter = (): number => Math.random() + Math.random() + Math.random() - 1.5;

const POINTS_VERT = /* glsl */ `
attribute float aSize;
attribute float aPhase;
uniform float uScale;
uniform float uTime;
varying vec3 vColor;
void main() {
  vColor = color * (0.88 + 0.12 * sin(uTime * 2.2 + aPhase));
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(aSize * (uScale / -mv.z), 56.0);
  gl_Position = projectionMatrix * mv;
}
`;

const POINTS_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uOpacity;
varying vec3 vColor;
void main() {
  float a = texture2D(uMap, gl_PointCoord).a;
  // Strong sharpening: solid bright core, almost no blurry halo.
  a = pow(a, 2.0);
  gl_FragColor = vec4(vColor, a * uOpacity);
}
`;

/** Crisp star sprite: large solid core, very fast falloff. */
function makeDotTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.22, "rgba(255,255,255,1)");
  g.addColorStop(0.34, "rgba(255,255,255,0.88)");
  g.addColorStop(0.48, "rgba(255,255,255,0.22)");
  g.addColorStop(0.65, "rgba(255,255,255,0.05)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function makeGlowTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.5)");
  g.addColorStop(0.6, "rgba(255,255,255,0.15)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function makePointsMaterial(
  map: THREE.Texture,
  opacity: number,
  scale: number
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: map },
      uOpacity: { value: opacity },
      uScale: { value: scale },
      uTime: { value: 0 },
    },
    vertexShader: POINTS_VERT,
    fragmentShader: POINTS_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
  });
}

// ---------------------------------------------------------------------------
// Crisp stars (galaxy + heart): procedural hard disk, no texture, no halo.
// Just a clean dot, slightly brighter in its center.
// ---------------------------------------------------------------------------
const CRISP_VERT = /* glsl */ `
attribute float aSize;
attribute float aPhase;
uniform float uScale;
uniform float uTime;
varying vec3 vColor;
void main() {
  vColor = color * (0.9 + 0.1 * sin(uTime * 2.2 + aPhase));
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(aSize * (uScale / -mv.z), 22.0);
  gl_Position = projectionMatrix * mv;
}
`;

const CRISP_FRAG = /* glsl */ `
uniform float uOpacity;
varying vec3 vColor;
void main() {
  vec2 uv = gl_PointCoord - vec2(0.5);
  float d = length(uv);
  // Solid core with a very short antialiased edge: no halo at all.
  float alpha = 1.0 - smoothstep(0.3, 0.46, d);
  if (alpha < 0.02) discard;
  // Slightly luminous center.
  float lum = 1.0 - smoothstep(0.0, 0.46, d);
  vec3 col = vColor * (0.85 + 0.45 * lum);
  gl_FragColor = vec4(col, alpha * uOpacity);
}
`;

function makeCrispPointsMaterial(
  opacity: number,
  scale: number
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: opacity },
      uScale: { value: scale },
      uTime: { value: 0 },
    },
    vertexShader: CRISP_VERT,
    fragmentShader: CRISP_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
  });
}

/** Classic 2D heart curve, recentered so it is vertically centered. */
function heartBase(t: number): [number, number] {
  const x = 16 * Math.pow(Math.sin(t), 3);
  const y =
    13 * Math.cos(t) -
    5 * Math.cos(2 * t) -
    2 * Math.cos(3 * t) -
    Math.cos(4 * t);
  return [x, y + 3];
}

/**
 * Arc-length sampler along the heart outline, so stars are spread evenly along
 * the edge (the bottom tip would otherwise gather far too many of them).
 * Writes [x, y, normalX, normalY] into `out`.
 */
function makeHeartOutline(steps = 900) {
  const xs = new Float32Array(steps);
  const ys = new Float32Array(steps);
  const cum = new Float32Array(steps + 1);
  for (let i = 0; i < steps; i++) {
    const [x, y] = heartBase((i / steps) * Math.PI * 2);
    xs[i] = x;
    ys[i] = y;
  }
  for (let i = 1; i <= steps; i++) {
    const p = i - 1;
    const q = i % steps;
    cum[i] = cum[i - 1] + Math.hypot(xs[q] - xs[p], ys[q] - ys[p]);
  }
  const total = cum[steps];

  return (u: number, out: Float64Array): void => {
    const target = clamp01(u) * total;
    let lo = 0;
    let hi = steps;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    const i = Math.max(1, lo);
    const p = i - 1;
    const q = i % steps;
    const dx = xs[q] - xs[p];
    const dy = ys[q] - ys[p];
    const segLen = Math.hypot(dx, dy) || 1;
    const f = (target - cum[p]) / segLen;
    out[0] = xs[p] + dx * f;
    out[1] = ys[p] + dy * f;
    // Unit normal = perpendicular of the unit tangent
    out[2] = -dy / segLen;
    out[3] = dx / segLen;
  };
}

// 3D anchors (galaxy local space) for the round photo icons.
const ICON_ANCHORS: Array<[number, number, number]> = [
  [7.5, 1.4, 1.5],
  [-6.5, 2.0, -2.5],
  [3.5, -0.6, 7.5],
  [-8.5, -0.4, 4.5],
  [0.5, 2.4, -8.5],
  [6.0, -2.0, -4.0],
  [-4.0, 3.0, 6.0],
  [2.0, 2.0, 2.0],
  [-2.0, -2.0, -2.0],
  [8.0, 0.0, -6.0],
  [-7.0, -1.5, 0.0],
  [0.0, -3.0, 5.0],
];

interface PageTwoProps {
  onOpenLibrary: () => void;
  /** True while the library (page 3) covers the galaxy. */
  dimmed?: boolean;
}

export default function PageTwo({ onOpenLibrary, dimmed }: PageTwoProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const iconRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const startRef = useRef<number>(performance.now());
  const arrivalTimer = useRef<number>(0);
  const frozenRef = useRef(false);
  const [arrived, setArrived] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);

  frozenRef.current = dimmed === true || selected !== null;

  const skipVortex = useCallback(() => {
    startRef.current = performance.now() - VORTEX_MS - 1;
    window.clearTimeout(arrivalTimer.current);
    arrivalTimer.current = window.setTimeout(() => setArrived(true), 900);
    setSkipped(true);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    startRef.current = performance.now();

    const mobile = window.innerWidth < 640;
    const VORTEX_N = mobile ? 1500 : 2600;
    const GALAXY_N = mobile ? 24000 : 60000;
    const FAR_N = mobile ? 30000 : 100000;
    const HEART_N = mobile ? 4500 : 7000;
    const BG_N = mobile ? 7000 : 20000;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setClearColor(0x000000, 1);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      96,
      container.clientWidth / container.clientHeight,
      0.1,
      600
    );
    camera.position.set(0, 0, 3);

    const dot = makeDotTexture();
    const glowTex = makeGlowTexture();
    const pointScale = (): number => 230 * renderer.getPixelRatio();

    const shaderMats: THREE.ShaderMaterial[] = [];
    const track = (m: THREE.ShaderMaterial): THREE.ShaderMaterial => {
      shaderMats.push(m);
      return m;
    };

    // ---------------------------------------------------------- VORTEX
    const vortexGroup = new THREE.Group();
    scene.add(vortexGroup);

    const vortexMat = track(makePointsMaterial(dot, 1, pointScale()));
    const vGeo = new THREE.BufferGeometry();
    const vPos = new Float32Array(VORTEX_N * 3);
    const vCol = new Float32Array(VORTEX_N * 3);
    const vSize = new Float32Array(VORTEX_N);
    const vPhase = new Float32Array(VORTEX_N);
    const vAngle = new Float32Array(VORTEX_N);
    const vRadius = new Float32Array(VORTEX_N);
    const vZ = new Float32Array(VORTEX_N);
    const vSpeed = new Float32Array(VORTEX_N);

    const vPink = new THREE.Color("#ff2e88");
    const vLight = new THREE.Color("#ffc7e3");
    const vWhite = new THREE.Color("#ffffff");
    const tmpC = new THREE.Color();

    for (let i = 0; i < VORTEX_N; i++) {
      vAngle[i] = Math.random() * Math.PI * 2;
      vRadius[i] = 0.8 + Math.pow(Math.random(), 0.65) * 7.2;
      vZ[i] = 3 - Math.random() * 78;
      vSpeed[i] = 14 + Math.random() * 14;
      vSize[i] = 0.7 + Math.random() * 1.3;
      vPhase[i] = Math.random() * Math.PI * 2;

      tmpC.copy(vPink).lerp(vLight, Math.random());
      if (Math.random() > 0.9) tmpC.lerp(vWhite, 0.8);
      tmpC.multiplyScalar(0.7 + Math.random() * 0.6);
      vCol[i * 3] = tmpC.r;
      vCol[i * 3 + 1] = tmpC.g;
      vCol[i * 3 + 2] = tmpC.b;
    }
    vGeo.setAttribute("position", new THREE.BufferAttribute(vPos, 3));
    vGeo.setAttribute("color", new THREE.BufferAttribute(vCol, 3));
    vGeo.setAttribute("aSize", new THREE.BufferAttribute(vSize, 1));
    vGeo.setAttribute("aPhase", new THREE.BufferAttribute(vPhase, 1));
    vortexGroup.add(new THREE.Points(vGeo, vortexMat));

    // Bright light at the end of the tunnel: the destination.
    const exitGlowMat = new THREE.SpriteMaterial({
      map: glowTex,
      color: "#ff5cb8",
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const exitGlow = new THREE.Sprite(exitGlowMat);
    exitGlow.position.set(0, 0, -45);
    exitGlow.scale.setScalar(16);
    vortexGroup.add(exitGlow);

    // ---------------------------------------------------------- GALAXY
    const galaxyGroup = new THREE.Group();
    galaxyGroup.visible = false;
    scene.add(galaxyGroup);

    // Spiral galaxy disc (tens of thousands of crisp stars)
    const GALAXY_R = 13;
    const galaxyMat = track(makeCrispPointsMaterial(0, pointScale()));
    const gGeo = new THREE.BufferGeometry();
    const gPos = new Float32Array(GALAXY_N * 3);
    const gCol = new Float32Array(GALAXY_N * 3);
    const gSize = new Float32Array(GALAXY_N);
    const gPhase = new Float32Array(GALAXY_N);
    const gCore = new THREE.Color("#ffe6f3");
    const gMid = new THREE.Color("#ff6fb5");
    const gEdge = new THREE.Color("#7b4dff");
    const gWhite = new THREE.Color("#ffffff");
    const branches = 3;

    for (let i = 0; i < GALAXY_N; i++) {
      let r = Math.pow(Math.random(), 1.7) * GALAXY_R;
      // Keep the middle of the galaxy darker where the heart stands, so the
      // hollow silhouette reads clearly instead of being filled with core stars.
      if (r < 4.6 && Math.random() < (r < 2.6 ? 0.94 : 0.62)) {
        r = 4.6 + Math.random() * (GALAXY_R - 4.6);
      }
      const branchAngle = ((i % branches) / branches) * Math.PI * 2;
      const spinAngle = r * 0.52;
      const spread = 0.28 + r * 0.16;
      const x =
        Math.cos(branchAngle + spinAngle) * r + jitter() * spread;
      const y = jitter() * spread * 0.55;
      const z =
        Math.sin(branchAngle + spinAngle) * r + jitter() * spread;
      gPos[i * 3] = x;
      gPos[i * 3 + 1] = y;
      gPos[i * 3 + 2] = z;

      const f = r / GALAXY_R;
      tmpC
        .copy(gCore)
        .lerp(gMid, smooth01(f / 0.45))
        .lerp(gEdge, smooth01((f - 0.45) / 0.55));
      if (Math.random() > 0.985) tmpC.lerp(gWhite, 0.7);
      tmpC.multiplyScalar(0.9 + Math.random() * 0.6);
      gCol[i * 3] = tmpC.r;
      gCol[i * 3 + 1] = tmpC.g;
      gCol[i * 3 + 2] = tmpC.b;

      gSize[i] = 0.08 + Math.random() * 0.17;
      gPhase[i] = Math.random() * Math.PI * 2;
    }
    gGeo.setAttribute("position", new THREE.BufferAttribute(gPos, 3));
    gGeo.setAttribute("color", new THREE.BufferAttribute(gCol, 3));
    gGeo.setAttribute("aSize", new THREE.BufferAttribute(gSize, 1));
    gGeo.setAttribute("aPhase", new THREE.BufferAttribute(gPhase, 1));
    galaxyGroup.add(new THREE.Points(gGeo, galaxyMat));

    // Dense far star dust: gives the impression of countless stars.
    const farMat = track(makeCrispPointsMaterial(0, pointScale()));
    const fGeo = new THREE.BufferGeometry();
    const fPos = new Float32Array(FAR_N * 3);
    const fCol = new Float32Array(FAR_N * 3);
    const fSize = new Float32Array(FAR_N);
    const fPhase = new Float32Array(FAR_N);
    const farPalette = [
      new THREE.Color("#ffffff"),
      new THREE.Color("#ffd9ec"),
      new THREE.Color("#cfe4ff"),
      new THREE.Color("#ffc7e3"),
    ];
    for (let i = 0; i < FAR_N; i++) {
      if (Math.random() < 0.7) {
        // Wide thin disc far beyond the main spiral
        const r = 15 + Math.pow(Math.random(), 1.4) * 32;
        const a = Math.random() * Math.PI * 2;
        fPos[i * 3] = Math.cos(a) * r + jitter() * 1.2;
        fPos[i * 3 + 1] = jitter() * 2.4;
        fPos[i * 3 + 2] = Math.sin(a) * r + jitter() * 1.2;
      } else {
        // Distant halo sphere
        const radius = 45 + Math.random() * 90;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        fPos[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
        fPos[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
        fPos[i * 3 + 2] = radius * Math.cos(phi);
      }
      tmpC.copy(farPalette[i % farPalette.length]);
      tmpC.multiplyScalar(0.75 + Math.random() * 0.65);
      fCol[i * 3] = tmpC.r;
      fCol[i * 3 + 1] = tmpC.g;
      fCol[i * 3 + 2] = tmpC.b;
      fSize[i] = 0.06 + Math.random() * 0.1;
      if (Math.random() > 0.992) fSize[i] += 0.22; // sparse brighter stars
      fPhase[i] = Math.random() * Math.PI * 2;
    }
    fGeo.setAttribute("position", new THREE.BufferAttribute(fPos, 3));
    fGeo.setAttribute("color", new THREE.BufferAttribute(fCol, 3));
    fGeo.setAttribute("aSize", new THREE.BufferAttribute(fSize, 1));
    fGeo.setAttribute("aPhase", new THREE.BufferAttribute(fPhase, 1));
    galaxyGroup.add(new THREE.Points(fGeo, farMat));

    // Distant background starfield
    const bgMat = track(makeCrispPointsMaterial(0, pointScale()));
    const bGeo = new THREE.BufferGeometry();
    const bPos = new Float32Array(BG_N * 3);
    const bCol = new Float32Array(BG_N * 3);
    const bSize = new Float32Array(BG_N);
    const bPhase = new Float32Array(BG_N);
    const bgPalette = [
      new THREE.Color("#ffffff"),
      new THREE.Color("#cfe4ff"),
      new THREE.Color("#ffd9ec"),
    ];
    for (let i = 0; i < BG_N; i++) {
      const radius = 60 + Math.random() * 80;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      bPos[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      bPos[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      bPos[i * 3 + 2] = radius * Math.cos(phi);
      tmpC.copy(bgPalette[i % bgPalette.length]);
      tmpC.multiplyScalar(0.6 + Math.random() * 0.55);
      bCol[i * 3] = tmpC.r;
      bCol[i * 3 + 1] = tmpC.g;
      bCol[i * 3 + 2] = tmpC.b;
      bSize[i] = 0.1 + Math.random() * 0.15;
      bPhase[i] = Math.random() * Math.PI * 2;
    }
    bGeo.setAttribute("position", new THREE.BufferAttribute(bPos, 3));
    bGeo.setAttribute("color", new THREE.BufferAttribute(bCol, 3));
    bGeo.setAttribute("aSize", new THREE.BufferAttribute(bSize, 1));
    bGeo.setAttribute("aPhase", new THREE.BufferAttribute(bPhase, 1));
    galaxyGroup.add(new THREE.Points(bGeo, bgMat));

    // ------------------------------------------- GIANT STAR HEART (3D)
    const heartGroup = new THREE.Group();
    heartGroup.rotation.x = 0.18;
    galaxyGroup.add(heartGroup);

    const HS = 0.26; // heart scale -> ~8 units wide, gigantic at the core
    // Only the outline is drawn: the inside of the heart stays empty.
    const HEART_LINE_N = Math.round(HEART_N * 0.7);
    const outlineAt = makeHeartOutline();
    const onCurve = new Float64Array(4);
    const EDGE = 0.8; // star band thickness across the edge (heart space)
    const DEPTH = 1.5; // rim depth, so the outline stays 3D while spinning

    const heartMat = track(makeCrispPointsMaterial(0, pointScale()));
    const hGeo = new THREE.BufferGeometry();
    const hPos = new Float32Array(HEART_LINE_N * 3);
    const hCol = new Float32Array(HEART_LINE_N * 3);
    const hSize = new Float32Array(HEART_LINE_N);
    const hPhase = new Float32Array(HEART_LINE_N);
    const hCore = new THREE.Color("#fff2f8");
    const hMid = new THREE.Color("#ff5cb8");
    const hEdge = new THREE.Color("#ff1f5f");
    const hGold = new THREE.Color("#ffd166");

    for (let i = 0; i < HEART_LINE_N; i++) {
      const u = (i + Math.random() * 0.9) / HEART_LINE_N;
      outlineAt(u, onCurve);
      // Offset along the curve normal keeps the silhouette crisp.
      const off = (Math.random() * 2 - 1) * EDGE;
      const x = (onCurve[0] + onCurve[2] * off) * HS;
      const y = (onCurve[1] + onCurve[3] * off) * HS;
      const z = (Math.random() * 2 - 1) * DEPTH * HS;
      hPos[i * 3] = x;
      hPos[i * 3 + 1] = y;
      hPos[i * 3 + 2] = z;

      // Vertical gradient: deep red at the tip, white-pink at the lobes.
      const h = clamp01((onCurve[1] + 17) / 29);
      tmpC
        .copy(hEdge)
        .lerp(hMid, smooth01(h / 0.6))
        .lerp(hCore, smooth01((h - 0.6) / 0.4));
      if (Math.random() > 0.96) tmpC.lerp(hGold, 0.65);
      tmpC.multiplyScalar(0.95 + Math.random() * 0.55);
      hCol[i * 3] = tmpC.r;
      hCol[i * 3 + 1] = tmpC.g;
      hCol[i * 3 + 2] = tmpC.b;

      hSize[i] = 0.18 + Math.random() * 0.22;
      if (Math.random() > 0.975) hSize[i] += 0.3; // a few brighter beads
      hPhase[i] = Math.random() * Math.PI * 2;
    }
    hGeo.setAttribute("position", new THREE.BufferAttribute(hPos, 3));
    hGeo.setAttribute("color", new THREE.BufferAttribute(hCol, 3));
    hGeo.setAttribute("aSize", new THREE.BufferAttribute(hSize, 1));
    hGeo.setAttribute("aPhase", new THREE.BufferAttribute(hPhase, 1));
    heartGroup.add(new THREE.Points(hGeo, heartMat));

    // Pulsing halo around the heart
    const haloMat = new THREE.SpriteMaterial({
      map: glowTex,
      color: "#ff2e6e",
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const halo = new THREE.Sprite(haloMat);
    halo.scale.setScalar(7);
    halo.position.z = -0.4;
    heartGroup.add(halo);

    // Faint colored nebulae for depth
    const nebulae: THREE.SpriteMaterial[] = [];
    const nebulaDefs: Array<[string, number, [number, number, number], number]> =
      [
        ["#ff2e88", 30, [-10, 3, -8], 0.13],
        ["#7b4dff", 34, [9, -4, -10], 0.12],
        ["#2bd9ff", 26, [2, 6, -14], 0.08],
        ["#ff6fb5", 24, [-3, -6, 7], 0.1],
      ];
    for (const [color, scale, pos, opacity] of nebulaDefs) {
      const m = new THREE.SpriteMaterial({
        map: glowTex,
        color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      m.userData.baseOpacity = opacity;
      const s = new THREE.Sprite(m);
      s.scale.setScalar(scale);
      s.position.set(pos[0], pos[1], pos[2]);
      galaxyGroup.add(s);
      nebulae.push(m);
    }

    // Icon anchors in galaxy local space
    const iconAnchors = ICON_ANCHORS.map(
      ([x, y, z]) => new THREE.Vector3(x, y, z)
    );

    // ---------------------------------------------------------- MOTION
    const clock = new THREE.Clock();
    const camStart = new THREE.Vector3(0, 0, 3);
    const camEnd = new THREE.Vector3(0, 5.4, 16.5);
    const lookStart = new THREE.Vector3(0, 0, -12);
    const lookEnd = new THREE.Vector3(0, 0.3, 0);
    const tmpLook = new THREE.Vector3();
    const tmpIcon = new THREE.Vector3();

    const offTarget = { x: 0, y: 0 };
    const offCur = { x: 0, y: 0 };
    let baseSpin = 0;
    let raf = 0;
    let lastFov = 96;
    let viewW = container.clientWidth;
    let viewH = container.clientHeight;

    const onPointerDown = (e: PointerEvent): void => {
      if (frozenRef.current) return;
      drag.active = true;
      drag.px = e.clientX;
      drag.py = e.clientY;
    };
    const onPointerMove = (e: PointerEvent): void => {
      if (!drag.active || frozenRef.current) return;
      const dx = e.clientX - drag.px;
      const dy = e.clientY - drag.py;
      drag.px = e.clientX;
      drag.py = e.clientY;
      offTarget.y += dx * 0.005;
      offTarget.x = Math.min(
        0.9,
        Math.max(-0.9, offTarget.x + dy * 0.003)
      );
    };
    const onPointerUp = (): void => {
      drag.active = false;
    };
    const drag = { active: false, px: 0, py: 0 };

    const el = renderer.domElement;
    el.style.display = "block";
    el.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    const onResize = (): void => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      viewW = w;
      viewH = h;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      const s = pointScale();
      for (const m of shaderMats) m.uniforms.uScale.value = s;
    };
    window.addEventListener("resize", onResize);

    const updateIcons = (k: number): void => {
      galaxyGroup.updateMatrixWorld();
      for (let i = 0; i < iconAnchors.length; i++) {
        const btn = iconRefs.current[i];
        if (!btn) continue;
        tmpIcon.copy(iconAnchors[i]).applyMatrix4(galaxyGroup.matrixWorld);
        const dist = tmpIcon.distanceTo(camera.position);
        tmpIcon.project(camera);
        const behind = tmpIcon.z > 1 || tmpIcon.z < -1;
        const x = (tmpIcon.x * 0.5 + 0.5) * viewW;
        const y = (-tmpIcon.y * 0.5 + 0.5) * viewH;
        const off =
          x < -80 || x > viewW + 80 || y < -80 || y > viewH + 80;
        const show = k > 0.4 && !behind && !off;
        const scale = Math.min(1.15, Math.max(0.65, 15 / Math.max(8, dist)));
        btn.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(
          1
        )}px) translate(-50%, -50%) scale(${scale.toFixed(2)})`;
        btn.style.opacity = show ? k.toFixed(2) : "0";
        btn.style.pointerEvents = show ? "auto" : "none";
        btn.style.visibility = show ? "visible" : "hidden";
      }
    };

    const animate = (): void => {
      raf = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;
      const elapsed = performance.now() - startRef.current;
      const k = smooth01((elapsed - VORTEX_MS) / BLEND_MS);

      // Vortex particles stream toward the camera
      if (k < 1) {
        const attr = vGeo.attributes.position as THREE.BufferAttribute;
        const arr = attr.array as Float32Array;
        for (let i = 0; i < VORTEX_N; i++) {
          vAngle[i] += dt * (1.4 + (7 - vRadius[i]) * 0.35);
          vZ[i] += dt * vSpeed[i];
          vRadius[i] -= dt * 0.35;
          if (vZ[i] > 3) {
            vZ[i] -= 78;
            vAngle[i] = Math.random() * Math.PI * 2;
            vRadius[i] = 0.8 + Math.pow(Math.random(), 0.65) * 7.2;
          }
          if (vRadius[i] < 0.35) {
            vRadius[i] = 6 + Math.random() * 2;
          }
          arr[i * 3] = Math.cos(vAngle[i]) * vRadius[i];
          arr[i * 3 + 1] = Math.sin(vAngle[i]) * vRadius[i];
          arr[i * 3 + 2] = vZ[i];
        }
        attr.needsUpdate = true;
        vortexGroup.rotation.z += dt * 0.6;
      }
      vortexGroup.visible = k < 1;
      galaxyGroup.visible = k > 0;

      vortexMat.uniforms.uOpacity.value = 1 - k;
      exitGlowMat.opacity = 0.55 * (1 - k);
      galaxyMat.uniforms.uOpacity.value = k;
      farMat.uniforms.uOpacity.value = 0.95 * k;
      bgMat.uniforms.uOpacity.value = 0.9 * k;
      heartMat.uniforms.uOpacity.value = k;
      for (const m of shaderMats) m.uniforms.uTime.value = t;
      for (const m of nebulae) {
        m.opacity = (m.userData.baseOpacity as number) * k;
      }

      // Camera: warp flight, then settle above the galaxy
      if (k < 1) {
        const e = k * k * (3 - 2 * k);
        camera.position.lerpVectors(camStart, camEnd, e);
        tmpLook.lerpVectors(lookStart, lookEnd, k);
        camera.lookAt(tmpLook);
        const fov = 62 + (1 - k) * 34;
        if (Math.abs(fov - lastFov) > 0.01) {
          camera.fov = fov;
          camera.updateProjectionMatrix();
          lastFov = fov;
        }
      } else {
        const amp = smooth01((elapsed - VORTEX_MS - BLEND_MS) / 3000);
        camera.position.set(
          Math.sin(t * 0.08) * 1.4 * amp,
          5.4 + Math.sin(t * 0.06) * 0.5 * amp,
          16.5
        );
        camera.lookAt(lookEnd);
        if (lastFov !== 62) {
          camera.fov = 62;
          camera.updateProjectionMatrix();
          lastFov = 62;
        }
      }

      // Galaxy slowly turns; the user can drag to orbit around it
      baseSpin += dt * 0.05;
      offCur.x += (offTarget.x - offCur.x) * Math.min(1, dt * 5);
      offCur.y += (offTarget.y - offCur.y) * Math.min(1, dt * 5);
      galaxyGroup.rotation.y = baseSpin + offCur.y;
      galaxyGroup.rotation.x = 0.1 + offCur.x;

      // The star heart spins on itself, floats and beats like a heart
      heartGroup.rotation.y += dt * 0.5;
      const beat =
        Math.pow(Math.max(0, Math.sin(t * 2.6)), 6) * 0.1 +
        Math.pow(Math.max(0, Math.sin(t * 2.6 + 0.9)), 10) * 0.05;
      heartGroup.scale.setScalar(1 + beat);
      heartGroup.position.y = 1.5 + Math.sin(t * 0.8) * 0.15;
      haloMat.opacity = (0.12 + beat * 0.8) * k;

      updateIcons(k);

      renderer.render(scene, camera);
    };
    animate();

    arrivalTimer.current = window.setTimeout(
      () => setArrived(true),
      VORTEX_MS + BLEND_MS
    );

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(arrivalTimer.current);
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("resize", onResize);
      scene.traverse((obj) => {
        const pts = obj as THREE.Points;
        if (pts.isPoints) {
          pts.geometry.dispose();
          const m = pts.material as THREE.Material;
          m.dispose();
        }
        const spr = obj as THREE.Sprite;
        if (spr.isSprite) {
          (spr.material as THREE.Material).dispose();
        }
      });
      dot.dispose();
      glowTex.dispose();
      renderer.dispose();
      if (el.parentElement === container) container.removeChild(el);
    };
  }, []);

  const showUi = arrived && !dimmed;

  return (
    <section className="relative h-full w-full overflow-hidden bg-black">
      <div
        ref={containerRef}
        className="absolute inset-0 touch-none cursor-grab active:cursor-grabbing"
      />

      {/* Soft vignette to focus the gaze */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%)",
        }}
      />

      {/* Round photo icons scattered over the galaxy */}
      <div className="pointer-events-none absolute inset-0 z-10">
        {GALAXY_ICONS.map((item, i) => (
          <button
            key={item.id}
            ref={(node) => {
              iconRefs.current[i] = node;
            }}
            type="button"
            onClick={() => setSelected(i)}
            aria-label={`Ouvrir ${item.title}`}
            className="galaxy-icon pointer-events-none absolute top-0 left-0 h-14 w-14 overflow-hidden rounded-full border-2 border-pink-200/90 bg-black/60 opacity-0 sm:h-20 sm:w-20"
            style={{ visibility: "hidden" }}
          >
            <img
              src={item.thumbnail}
              alt={item.title}
              className="h-full w-full object-cover"
              draggable={false}
            />
            <span className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-pink-400/40 ring-inset" />
          </button>
        ))}
      </div>

      {!arrived && (
        <div className="pointer-events-none absolute inset-x-0 bottom-10 z-20 flex flex-col items-center gap-4 px-6 sm:bottom-14">
          <p className="glow-text animate-drift-pulse text-center text-lg font-semibold tracking-[0.25em] sm:text-2xl">
            TRAVERSÉE DU VORTEX…
          </p>
          {!skipped && (
            <button
              type="button"
              onClick={skipVortex}
              className="glow-button pointer-events-auto rounded-full border border-pink-400/70 bg-pink-500/15 px-8 py-2 text-sm font-semibold tracking-widest text-pink-100 transition hover:bg-pink-500/35 active:scale-95 sm:text-base"
            >
              Passer le voyage »
            </button>
          )}
        </div>
      )}

      {arrived && (
        <div className="pointer-events-none absolute inset-x-0 top-8 z-10 flex flex-col items-center gap-3 px-6 text-center sm:top-12">
          <p
            className="animate-rise-in text-sm tracking-widest text-pink-200/80 uppercase sm:text-base"
            style={{ animationDelay: "0.6s" }}
          >
            Touchez une bulle pour voir le souvenir
          </p>
        </div>
      )}

      {/* Bottom-left button toward the library */}
      {showUi && selected === null && (
        <button
          type="button"
          onClick={onOpenLibrary}
          className="glow-button animate-rise-in absolute bottom-6 left-6 z-20 flex items-center gap-2 rounded-full border border-pink-300/80 bg-pink-500/20 px-6 py-3 text-base font-semibold tracking-widest text-pink-100 uppercase backdrop-blur-sm transition hover:bg-pink-500/40 active:scale-95 sm:bottom-8 sm:left-8 sm:text-lg"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5 fill-current"
            aria-hidden="true"
          >
            <path d="M12 21s-7.5-4.9-9.7-9.2C.7 8.6 2.6 5 6.1 5c2 0 3.4 1.1 4.2 2.4h3.4C14.5 6.1 15.9 5 17.9 5c3.5 0 5.4 3.6 3.8 6.8C19.5 16.1 12 21 12 21z" />
          </svg>
          Ma Reine
        </button>
      )}

      {/* Fullscreen reveal when a galaxy icon is touched */}
      {selected !== null && GALAXY_ICONS[selected] && (
        <div
          className="animate-fade-zoom absolute inset-0 z-30 flex flex-col items-center justify-center gap-5 bg-black/90 p-6"
          onClick={() => setSelected(null)}
        >
          <img
            src={GALAXY_ICONS[selected].src}
            alt={GALAXY_ICONS[selected].title}
            className="max-h-[75vh] max-w-full rounded-2xl border border-pink-400/60 object-contain shadow-[0_0_40px_rgba(255,20,147,0.5)]"
          />
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="glow-button rounded-full border border-pink-400/70 bg-pink-500/20 px-10 py-2 text-sm font-semibold tracking-widest text-pink-100 uppercase transition hover:bg-pink-500/40 active:scale-95 sm:text-base"
          >
            Fermer
          </button>
        </div>
      )}
    </section>
  );
}
