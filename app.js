import { createRubiksCube } from './cube.js?v=8';

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

// ========== Deterministic turn swipe & pinch on canvas ==========
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

const activePointers = new Map(); // id -> {x,y}
let pinchActive = false;
let pinchStartDistance = 0;

// Derive STEP and EDGE from the cube (so we can compute xi/yi/zi robustly)
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
  STEP = Math.min(...allDiffs); // nearest neighbor spacing
  EDGE = Math.max(Math.max(...ax.map(Math.abs)), Math.max(...ay.map(Math.abs)), Math.max(...az.map(Math.abs)));
})();

// Helpers
function setPointerFromEvent(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  pointer.set(x, y);
}
function worldRaycastHit(e) {
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
function idxFromCoord(coord) {
  // convert local coord to index 0,1,2 using STEP
  if (coord >  0.5*STEP) return 2;
  if (coord < -0.5*STEP) return 0;
  return 1;
}

// ---- SwipeState with locked plane and accumulators ----
let swipeState = null;

// Pinch helpers
function screenDistance(p1, p2) { return Math.hypot(p1.x - p2.x, p1.y - p2.y); }
function updatePinchState() {
  const points = Array.from(activePointers.values());
  if (points.length === 2) {
    const d = screenDistance(points[0], points[1]);
    if (!pinchActive) { pinchActive = true; pinchStartDistance = d; }
    else if (pinchStartDistance > 0) {
      const adjusted = d / pinchStartDistance;           // >1 fingers apart
      dollyByScale(1 / adjusted);                        // spread => zoom out
      pinchStartDistance = d;
    }
  } else { pinchActive = false; pinchStartDistance = 0; }
}

// MAPPING TABLE: tune this to decide which face/direction turns
// Inputs: (touchedFaceId 1..6, xi, yi, zi in {0,1,2}, dominant 'U'|'V', sign -1|+1)
// Return: { faceId: 1..6, dir: 'CW'|'CCW' } or null to ignore
function mapSwipeToTurn(touchedFaceId, xi, yi, zi, dominant, sign) {
  const CW='CW', CCW='CCW';
  const dirBySign = (s, cwIfPos=true) => (s >= 0 ? (cwIfPos?CW:CCW) : (cwIfPos?CCW:CW));

  // ✅ START HERE to tune: change faceId and cwIfPos booleans
  switch (touchedFaceId) {
    case 5: // Front (+Z)
      // U = "horizontal-ish" movement across the front plane, V = "vertical-ish"
      if (dominant === 'U') {
        // Example: swiping along U rotates the Up face (3)
        return { faceId: 3, dir: dirBySign(sign, /*cwIfPos*/ true) };
      } else {
        // Swiping along V rotates the Right face (1)
        return { faceId: 1, dir: dirBySign(sign, /*cwIfPos*/ true) };
      }

    case 6: // Back (-Z)
      if (dominant === 'U') {
        return { faceId: 4, dir: dirBySign(sign, true) }; // Down
      } else {
        return { faceId: 2, dir: dirBySign(sign, true) }; // Left
      }

    case 3: // Up (+Y)
      if (dominant === 'U') {
        return { faceId: 1, dir: dirBySign(sign, true) }; // Right
      } else {
        return { faceId: 5, dir: dirBySign(sign, true) }; // Front
      }

    case 4: // Down (-Y)
      if (dominant === 'U') {
        return { faceId: 2, dir: dirBySign(sign, true) }; // Left
      } else {
        return { faceId: 6, dir: dirBySign(sign, true) }; // Back
      }

    case 1: // Right (+X)
      if (dominant === 'U') {
        return { faceId: 3, dir: dirBySign(sign, true) }; // Up
      } else {
        return { faceId: 5, dir: dirBySign(sign, true) }; // Front
      }

    case 2: // Left (-X)
      if (dominant === 'U') {
        return { faceId: 4, dir: dirBySign(sign, true) }; // Down
      } else {
        return { faceId: 6, dir: dirBySign(sign, true) }; // Back
      }

    default:
      return null;
  }

  // 🔧 OPTIONAL per-row overrides example:
  // if (touchedFaceId === 5 && dominant === 'U' && yi === 2) {
  //   return { faceId: 3, dir: dirBySign(sign, false) }; // flip only top row
  // }
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (activePointers.size >= 2) { updatePinchState(); return; }

  // Ignore globe area
  const g = globeRect();
  if (e.clientX >= g.left && e.clientX <= g.right && e.clientY >= g.top && e.clientY <= g.bottom) return;

  const hit = worldRaycastHit(e);
  if (!hit) return;

  const n = hit.face?.normal.clone().transformDirection(hit.object.matrixWorld).normalize() || new THREE.Vector3(0,0,1);
  const touchedFaceId = faceIdFromNormal(n);

  // Build a stable tangent basis (u,v) for this face normal
  const worldUp = new THREE.Vector3(0,1,0);
  const alt = Math.abs(n.dot(worldUp)) > 0.9 ? new THREE.Vector3(1,0,0) : worldUp.clone();
  const u = new THREE.Vector3().crossVectors(alt, n).normalize();   // first tangent
  const v = new THREE.Vector3().crossVectors(n, u).normalize();     // second tangent

  // Compute row/col indices by converting the hit point into cube local space
  const localHit = group.worldToLocal(hit.point.clone());
  const xi = idxFromCoord(localHit.x);
  const yi = idxFromCoord(localHit.y);
  const zi = idxFromCoord(localHit.z);

  swipeState = {
    startNormal: n, u, v,
    touchedFaceId, xi, yi, zi,
    accU: 0, accV: 0,
    lastScreen: { x: e.clientX, y: e.clientY },
    moved: false
  };
});

renderer.domElement.addEventListener('pointermove', (e) => {
  if (activePointers.has(e.pointerId)) activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (activePointers.size >= 2) { e.preventDefault(); updatePinchState(); swipeState = null; return; }
  if (!swipeState) return;

  const dx = e.clientX - swipeState.lastScreen.x;
  const dy = e.clientY - swipeState.lastScreen.y;
  swipeState.lastScreen = { x: e.clientX, y: e.clientY };
  if (dx === 0 && dy === 0) return;

  // Convert screen delta to world delta using camera right/up
  const camRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  const camUp    = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  const k = 0.01; // sensitivity (tune to taste)
  let worldDelta = camRight.multiplyScalar(dx * k).add(camUp.multiplyScalar(-dy * k));

  // Project onto the locked face plane
  const n = swipeState.startNormal;
  worldDelta = worldDelta.sub(n.clone().multiplyScalar(worldDelta.dot(n)));

  // Accumulate along the locked u,v basis
  swipeState.accU += worldDelta.dot(swipeState.u);
  swipeState.accV += worldDelta.dot(swipeState.v);
  swipeState.moved = true;
});

renderer.domElement.addEventListener('pointerup', async (e) => {
  activePointers.delete(e.pointerId);
  updatePinchState();
  if (pinchActive) return;
  if (!swipeState || !swipeState.moved) { swipeState = null; return; }

  const { accU, accV, touchedFaceId, xi, yi, zi } = swipeState;
  swipeState = null;

  const mag = Math.hypot(accU, accV);
  if (mag < 0.12) return; // minimum swipe distance in world units

  const dominant = Math.abs(accU) >= Math.abs(accV) ? 'U' : 'V';
  const sign = dominant === 'U' ? Math.sign(accU) : Math.sign(accV);

  const mapping = mapSwipeToTurn(touchedFaceId, xi, yi, zi, dominant, sign);
  if (!mapping) return;

  await api.rotateFace(mapping.faceId, mapping.dir, true);
}, { passive: false });

renderer.domElement.addEventListener('pointercancel', (e) => {
  activePointers.delete(e.pointerId);
  updatePinchState();
  swipeState = null;
});

// Optional: mouse wheel zoom for desktop
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
    navigator.serviceWorker.register('./sw.js?v=8').catch(() => {});
  });
}
