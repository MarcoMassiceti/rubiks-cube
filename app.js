import { createRubiksCube } from './cube.js?v=10';

const sceneEl = document.getElementById('scene');
const globeEl = document.getElementById('globe');
const shuffleBtn = document.getElementById('shuffleBtn');
const solveBtn = document.getElementById('solveBtn');
const shuffleCount = document.getElementById('shuffleCount');

// ---------- DEV: cache-busting switch ----------
(async function devBypass() {
  const params = new URLSearchParams(location.search);
  if (params.get('dev') === '1') {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) await r.unregister();
      }
      if (window.caches && caches.keys) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      if (!sessionStorage.getItem('devReloaded')) {
        sessionStorage.setItem('devReloaded', '1');
        const url = new URL(location.href);
        url.searchParams.delete('dev');
        location.replace(url.toString());
        return;
      } else {
        sessionStorage.removeItem('devReloaded');
      }
    } catch {}
  }
})();

// === THREE scene ===
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth/window.innerHeight, 0.1, 100);
camera.position.set(7.5, 7.5, 7.5);
camera.lookAt(0,0,0);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
sceneEl.appendChild(renderer.domElement);

// Lights
const amb = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(amb);
const dir = new THREE.DirectionalLight(0xffffff, 0.6);
dir.position.set(5,8,7);
scene.add(dir);

// Cube
const { group, api } = createRubiksCube(scene);
group.rotation.set(0.3, 0.6, 0);

// -------- Camera framing & zoom helpers --------
function frameObjectToView(object, margin = 1.8) {
  const box = new THREE.Box3().setFromObject(object);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const fovRad = THREE.MathUtils.degToRad(camera.fov);
  const dist = (sphere.radius * margin) / Math.sin(fovRad / 2);
  setCameraDistance(dist);
}
function getCameraDistance() { return camera.position.length(); }
function setCameraDistance(d) {
  const min = 3.0, max = 40.0;
  const clamped = Math.max(min, Math.min(max, d));
  const dirVec = camera.position.clone().normalize();
  camera.position.copy(dirVec.multiplyScalar(clamped));
  camera.updateProjectionMatrix();
}
function dollyByScale(scale) {
  const current = getCameraDistance();
  setCameraDistance(current * scale);
}
frameObjectToView(group, 1.8);

// Render loop
function animate() { renderer.render(scene, camera); requestAnimationFrame(animate); }
animate();

// Resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (getCameraDistance() < 6.5) setCameraDistance(6.5);
}, { passive: true });

// ========== Globe drag (1-finger) ==========
let globeDragging = false;
let lastGlobe = null;
const globeRect = () => globeEl.getBoundingClientRect();
function onGlobeStart(x, y) { globeDragging = true; lastGlobe = { x, y }; }
function onGlobeMove(x, y) {
  if (!globeDragging || !lastGlobe) return;
  const dx = x - lastGlobe.x, dy = y - lastGlobe.y;
  group.rotation.y += dx * 0.005;
  group.rotation.x += dy * 0.005;
  lastGlobe = { x, y };
}
function onGlobeEnd() { globeDragging = false; lastGlobe = null; }

globeEl.addEventListener('pointerdown', (e) => { e.preventDefault(); globeEl.setPointerCapture(e.pointerId); onGlobeStart(e.clientX, e.clientY); });
globeEl.addEventListener('pointermove', (e) => { if (!globeDragging) return; e.preventDefault(); onGlobeMove(e.clientX, e.clientY); });
globeEl.addEventListener('pointerup', () => onGlobeEnd());
globeEl.addEventListener('pointercancel', () => onGlobeEnd());

// ========== Edge-strip swipe logic using 3-cubie validation ==========
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

const activePointers = new Map(); // id -> {x,y}
let pinchActive = false;
let pinchStartDistance = 0;

// World axes of the cube group (update as needed)
function cubeWorldAxes() {
  return {
    ex: new THREE.Vector3().setFromMatrixColumn(group.matrixWorld, 0).normalize(), // +X
    ey: new THREE.Vector3().setFromMatrixColumn(group.matrixWorld, 1).normalize(), // +Y
    ez: new THREE.Vector3().setFromMatrixColumn(group.matrixWorld, 2).normalize(), // +Z
  };
}

// Toggle this if positive edge motion feels inverted globally
const CW_IF_POSITIVE_ALONG_EDGE = true;

function setPointerFromEvent(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  pointer.set(x, y);
}
function rayHit(e) {
  setPointerFromEvent(e);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(group.children, true);
  return hits.length ? hits[0] : null;
}

function faceIdFromNormal(n) {
  const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
  if (ax >= ay && ax >= az) return n.x >= 0 ? 1 : 2;
  if (ay >= ax && ay >= az) return n.y >= 0 ? 3 : 4;
  return n.z >= 0 ? 5 : 6;
}
function faceNormalFromId(fid) {
  const { ex, ey, ez } = cubeWorldAxes();
  switch (fid) {
    case 1: return ex.clone();
    case 2: return ex.clone().multiplyScalar(-1);
    case 3: return ey.clone();
    case 4: return ey.clone().multiplyScalar(-1);
    case 5: return ez.clone();
    case 6: return ez.clone().multiplyScalar(-1);
    default: return new THREE.Vector3(0,0,1);
  }
}

// Determine which top-level cubie mesh was hit (stickers are children)
function topCubie(mesh) {
  let m = mesh;
  while (m && m.parent !== group) m = m.parent;
  return (m && m.parent === group) ? m : null;
}

// Convert a local coordinate to 0|1|2 index (strict)
function idxFromCoord(coord, step) {
  if (coord >  0.5*step) return 2;
  if (coord < -0.5*step) return 0;
  return 1;
}

// We discover STEP/EDGE from the model so this stays robust
let STEP = 0, EDGE = 0;
(function computeStepEdge() {
  const xs = new Set(), ys = new Set(), zs = new Set();
  for (const c of group.children) if (c.isMesh) {
    xs.add(c.position.x.toFixed(3));
    ys.add(c.position.y.toFixed(3));
    zs.add(c.position.z.toFixed(3));
  }
  const toArr = (s) => Array.from(s).map(Number).sort((a,b)=>a-b);
  const ax = toArr(xs), ay = toArr(ys), az = toArr(zs);
  const diffs = (arr) => arr.slice(1).map((v,i)=>Math.abs(v-arr[i])).filter(Boolean);
  const allDiffs = [...diffs(ax), ...diffs(ay), ...diffs(az)].filter(d=>d>0.001);
  STEP = Math.min(...allDiffs);
  EDGE = Math.max(Math.max(...ax.map(Math.abs)), Math.max(...ay.map(Math.abs)), Math.max(...az.map(Math.abs)));
})();

// Swipe state with cubie tracking
let swipeState = null;

// Pinch helpers
function screenDistance(p1, p2) { return Math.hypot(p1.x - p2.x, p1.y - p2.y); }
function updatePinchState() {
  const points = Array.from(activePointers.values());
  if (points.length === 2) {
    const d = screenDistance(points[0], points[1]);
    if (!pinchActive) { pinchActive = true; pinchStartDistance = d; }
    else if (pinchStartDistance > 0) {
      const adjusted = d / pinchStartDistance;
      dollyByScale(1 / adjusted);
      pinchStartDistance = d;
    }
  } else { pinchActive = false; pinchStartDistance = 0; }
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (activePointers.size >= 2) { updatePinchState(); return; }

  // ignore globe area
  const g = globeRect();
  if (e.clientX >= g.left && e.clientX <= g.right && e.clientY >= g.top && e.clientY <= g.bottom) return;

  const hit = rayHit(e);
  if (!hit) return;

  // Touched face normal + id
  const Ns = hit.face?.normal.clone().transformDirection(hit.object.matrixWorld).normalize() || new THREE.Vector3(0,0,1);
  const touchedFaceId = faceIdFromNormal(Ns);

  swipeState = {
    Ns, touchedFaceId,
    cubies: new Map(), // key "x-y-z" -> {xi,yi,zi}
    pathWorldDelta: new THREE.Vector3(), // accumulate world motion
    lastScreen: { x: e.clientX, y: e.clientY },
    moved: false
  };

  // record first cubie
  const c = topCubie(hit.object);
  if (c) {
    const { xi, yi, zi } = c.userData;
    swipeState.cubies.set(`${xi}-${yi}-${zi}`, { xi, yi, zi });
  }
});

renderer.domElement.addEventListener('pointermove', (e) => {
  if (activePointers.has(e.pointerId)) activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (activePointers.size >= 2) { e.preventDefault(); updatePinchState(); swipeState = null; return; }
  if (!swipeState) return;

  const dx = e.clientX - swipeState.lastScreen.x;
  const dy = e.clientY - swipeState.lastScreen.y;
  swipeState.lastScreen = { x: e.clientX, y: e.clientY };

  // Accumulate world delta from screen delta
  const camRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  const camUp    = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  const k = 0.01; // sensitivity
  const worldDelta = camRight.multiplyScalar(dx * k).add(camUp.multiplyScalar(-dy * k));
  swipeState.pathWorldDelta.add(worldDelta);
  swipeState.moved = true;

  // Also collect which cubies were traversed
  const hit = rayHit(e);
  if (hit) {
    // Only accept hits on the SAME face we started on (same world normal sign)
    const nNow = hit.face?.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
    if (nNow && Math.sign(nNow.x) === Math.sign(swipeState.Ns.x)
            && Math.sign(nNow.y) === Math.sign(swipeState.Ns.y)
            && Math.sign(nNow.z) === Math.sign(swipeState.Ns.z)) {
      const c = topCubie(hit.object);
      if (c) {
        const { xi, yi, zi } = c.userData;
        swipeState.cubies.set(`${xi}-${yi}-${zi}`, { xi, yi, zi });
      }
    }
  }
});

renderer.domElement.addEventListener('pointerup', async (e) => {
  activePointers.delete(e.pointerId);
  updatePinchState();
  if (pinchActive) return;
  if (!swipeState || !swipeState.moved) { swipeState = null; return; }

  const { Ns, touchedFaceId, cubies, pathWorldDelta } = swipeState;
  swipeState = null;

  // Must touch at least 3 unique cubies
  const touched = Array.from(cubies.values());
  if (touched.length < 3) return;

  // Check they lie on ONE face strip at the EDGE (index 0 or 2), and are aligned along one axis with all three indices present.
  // For each touchedFaceId, two indices vary across the plane; one index is fixed to the face's EDGE.
  function isEdgeStripAndWhich(tface, list) {
    // returns { ok, fixedAxis:'X'|'Y'|'Z', fixedIndex:0|2, varying:'X'|'Y'|'Z' }
    const xs = list.map(p=>p.xi), ys = list.map(p=>p.yi), zs = list.map(p=>p.zi);
    const uniq = arr => Array.from(new Set(arr));
    const ux = uniq(xs), uy = uniq(ys), uz = uniq(zs);

    // Helper to verify that along the varying axis we covered 3 indices (0,1,2) in any order
    const covered012 = arr => {
      const s = new Set(arr);
      return s.has(0) && s.has(1) && s.has(2);
    };

    switch (tface) {
      case 1: // +X face -> xi must be 2; vary yi or zi fully
        if (ux.length === 1 && ux[0] === 2) {
          if (covered012(ys) && new Set(zs).size === 1) return { ok:true, fixedAxis:'X', fixedIndex:2, varying:'Y' };
          if (covered012(zs) && new Set(ys).size === 1) return { ok:true, fixedAxis:'X', fixedIndex:2, varying:'Z' };
        }
        return { ok:false };
      case 2: // -X face -> xi must be 0
        if (ux.length === 1 && ux[0] === 0) {
          if (covered012(ys) && new Set(zs).size === 1) return { ok:true, fixedAxis:'X', fixedIndex:0, varying:'Y' };
          if (covered012(zs) && new Set(ys).size === 1) return { ok:true, fixedAxis:'X', fixedIndex:0, varying:'Z' };
        }
        return { ok:false };
      case 3: // +Y face -> yi must be 2
        if (uy.length === 1 && uy[0] === 2) {
          if (covered012(xs) && new Set(zs).size === 1) return { ok:true, fixedAxis:'Y', fixedIndex:2, varying:'X' };
          if (covered012(zs) && new Set(xs).size === 1) return { ok:true, fixedAxis:'Y', fixedIndex:2, varying:'Z' };
        }
        return { ok:false };
      case 4: // -Y face -> yi must be 0
        if (uy.length === 1 && uy[0] === 0) {
          if (covered012(xs) && new Set(zs).size === 1) return { ok:true, fixedAxis:'Y', fixedIndex:0, varying:'X' };
          if (covered012(zs) && new Set(xs).size === 1) return { ok:true, fixedAxis:'Y', fixedIndex:0, varying:'Z' };
        }
        return { ok:false };
      case 5: // +Z face -> zi must be 2
        if (uz.length === 1 && uz[0] === 2) {
          if (covered012(xs) && new Set(ys).size === 1) return { ok:true, fixedAxis:'Z', fixedIndex:2, varying:'X' };
          if (covered012(ys) && new Set(xs).size === 1) return { ok:true, fixedAxis:'Z', fixedIndex:2, varying:'Y' };
        }
        return { ok:false };
      case 6: // -Z face -> zi must be 0
        if (uz.length === 1 && uz[0] === 0) {
          if (covered012(xs) && new Set(ys).size === 1) return { ok:true, fixedAxis:'Z', fixedIndex:0, varying:'X' };
          if (covered012(ys) && new Set(xs).size === 1) return { ok:true, fixedAxis:'Z', fixedIndex:0, varying:'Y' };
        }
        return { ok:false };
    }
    return { ok:false };
  }

  const strip = isEdgeStripAndWhich(touchedFaceId, touched);
  if (!strip.ok) return; // not a valid 3-cubie edge strip; ignore

  // Determine adjacent face (Nt) from which EDGE we’re on:
  // If we are on +Z face and fixedAxis is Y with fixedIndex 2 => adjacent is +Y
  // If fixedIndex 0 => adjacent is -Axis
  function adjacentFaceFromEdge(tface, fixedAxis, fixedIndex) {
    const pos = fixedIndex === 2; // true => +axis, false => -axis
    // Adjacent face is the ± fixedAxis
    switch (fixedAxis) {
      case 'X': return pos ? 1 : 2;
      case 'Y': return pos ? 3 : 4;
      case 'Z': return pos ? 5 : 6;
    }
    return null;
  }

  const targetFaceId = adjacentFaceFromEdge(touchedFaceId, strip.fixedAxis, strip.fixedIndex);
  if (!targetFaceId) return;

  // Compute edge direction: edgeDir = Nt × Ns
  const Nt = faceNormalFromId(targetFaceId).normalize();
  const edgeDir = new THREE.Vector3().crossVectors(Nt, Ns).normalize();

  // Project net motion onto edgeDir to decide CW/CCW
  const along = pathWorldDelta.dot(edgeDir);
  if (Math.abs(along) < 0.05) return; // too small

  const dir = (along >= 0)
    ? (CW_IF_POSITIVE_ALONG_EDGE ? 'CW' : 'CCW')
    : (CW_IF_POSITIVE_ALONG_EDGE ? 'CCW' : 'CW');

  await api.rotateFace(targetFaceId, dir, true);
}, { passive: false });

renderer.domElement.addEventListener('pointercancel', (e) => {
  activePointers.delete(e.pointerId);
  updatePinchState();
  swipeState = null;
});

// Pinch-to-zoom (same as before)
renderer.domElement.addEventListener('pointerdown', (e) => {
  // already handled above; here only to track active pointers
  if (!activePointers.has(e.pointerId)) activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
});
renderer.domElement.addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = Math.sign(e.deltaY);
  const step = 1 + (0.08 * Math.abs(delta));
  dollyByScale(delta > 0 ? step : 1 / step);
}, { passive: false });

// === Buttons ===
shuffleBtn.addEventListener('click', async () => {
  const n = Math.max(1, Math.min(200, Number(shuffleCount.value) || 25));
  shuffleBtn.disabled = solveBtn.disabled = true;
  await api.shuffle(n);
  shuffleBtn.disabled = solveBtn.disabled = false;
});

solveBtn.addEventListener('click', async () => {
  await api.rotateFace(1, 'CW', false); // flush anim queue
  api.resetSolved();
});

// === PWA service worker ===
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const params = new URLSearchParams(location.search);
    if (params.get('dev') === '1') return;
    navigator.serviceWorker.register('./sw.js?v=10').catch(() => {});
  });
}
