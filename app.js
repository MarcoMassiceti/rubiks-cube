import { createRubiksCube } from './cube.js?v=9';

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

// ========== Adjacent-edge swipe logic (camera/cube invariant) ==========
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

const activePointers = new Map(); // id -> {x,y}
let pinchActive = false;
let pinchStartDistance = 0;

// Derive STEP and EDGE from the cube (so we can compute indices robustly)
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

// Map world normal to faceId 1..6 consistently
function faceIdFromNormal(n) {
  const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
  if (ax >= ay && ax >= az) return n.x >= 0 ? 1 : 2;
  if (ay >= ax && ay >= az) return n.y >= 0 ? 3 : 4;
  return n.z >= 0 ? 5 : 6;
}
// Map faceId back to world unit normal using cube's world axes (in case needed)
function faceNormalFromId(fid) {
  // cube local axes in world:
  const ex = new THREE.Vector3().setFromMatrixColumn(group.matrixWorld, 0).normalize(); // +X
  const ey = new THREE.Vector3().setFromMatrixColumn(group.matrixWorld, 1).normalize(); // +Y
  const ez = new THREE.Vector3().setFromMatrixColumn(group.matrixWorld, 2).normalize(); // +Z
  switch (fid) {
    case 1: return ex.clone();
    case 2: return ex.clone().multiplyScalar(-1);
    case 3: return ey.clone();
    case 4: return ey.clone().multiplyScalar(-1);
    case 5: return ez.clone();
    case 6: return ez.clone().multiplyScalar(-1);
  }
  return new THREE.Vector3(0,0,1);
}

// Helpers to pick the nearest border (edge) on the touched face
function nearestEdgeOnFace(touchFaceId, localPoint) {
  // Determine which two local axes lie in the touched face
  // and which coordinate hits which border (±EDGE).
  // For touched face:
  // ±X face => plane axes: Y,Z; borders at y=±EDGE or z=±EDGE
  // ±Y face => plane axes: X,Z; borders at x=±EDGE or z=±EDGE
  // ±Z face => plane axes: X,Y; borders at x=±EDGE or y=±EDGE

  const cand = [];
  const push = (adjAxis, sign, dist) => cand.push({ adjAxis, sign, dist }); // adjAxis: 'X'|'Y'|'Z', sign: +1|-1

  const dxp = Math.abs(localPoint.x - (+EDGE));
  const dxn = Math.abs(localPoint.x - (-EDGE));
  const dyp = Math.abs(localPoint.y - (+EDGE));
  const dyn = Math.abs(localPoint.y - (-EDGE));
  const dzp = Math.abs(localPoint.z - (+EDGE));
  const dzn = Math.abs(localPoint.z - (-EDGE));

  switch (touchFaceId) {
    case 1: // +X (plane YZ)
    case 2: // -X
      push('Y', +1, dyp); push('Y', -1, dyn);
      push('Z', +1, dzp); push('Z', -1, dzn);
      break;
    case 3: // +Y (plane XZ)
    case 4: // -Y
      push('X', +1, dxp); push('X', -1, dxn);
      push('Z', +1, dzp); push('Z', -1, dzn);
      break;
    case 5: // +Z (plane XY)
    case 6: // -Z
      push('X', +1, dxp); push('X', -1, dxn);
      push('Y', +1, dyp); push('Y', -1, dyn);
      break;
  }

  // Pick the closest border among the four candidates
  cand.sort((a,b)=>a.dist-b.dist);
  return cand[0]; // {adjAxis:'X'|'Y'|'Z', sign:+1|-1}
}

// Build world unit vectors for the cube's +X/+Y/+Z axes
function cubeWorldAxes() {
  return {
    ex: new THREE.Vector3().setFromMatrixColumn(group.matrixWorld, 0).normalize(),
    ey: new THREE.Vector3().setFromMatrixColumn(group.matrixWorld, 1).normalize(),
    ez: new THREE.Vector3().setFromMatrixColumn(group.matrixWorld, 2).normalize(),
  };
}

// Toggle this if the swipe → CW/CCW feeling is globally inverted
const CW_IF_POSITIVE_ALONG_EDGE = true;

// ---- Swipe state (locked at pointerdown) ----
let swipeState = null;

// Pinch helpers
function screenDistance(p1, p2) { return Math.hypot(p1.x - p2.x, p1.y - p2.y); }
function updatePinchState() {
  const points = Array.from(activePointers.values());
  if (points.length === 2) {
    const d = screenDistance(points[0], points[1]);
    if (!pinchActive) { pinchActive = true; pinchStartDistance = d; }
    else if (pinchStartDistance > 0) {
      const adjusted = d / pinchStartDistance; // >1 means spreading fingers
      dollyByScale(1 / adjusted);
      pinchStartDistance = d;
    }
  } else { pinchActive = false; pinchStartDistance = 0; }
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (activePointers.size >= 2) { updatePinchState(); return; }

  // Ignore globe area
  const g = globeRect();
  if (e.clientX >= g.left && e.clientX <= g.right && e.clientY >= g.top && e.clientY <= g.bottom) return;

  // Raycast once
  setPointerFromEvent(e);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(group.children, true)[0];
  if (!hit) return;

  // Touched face world normal
  const Ns = hit.face?.normal.clone().transformDirection(hit.object.matrixWorld).normalize() || new THREE.Vector3(0,0,1);
  const touchedFaceId = faceIdFromNormal(Ns);

  // Convert hit point into cube local space
  const localHit = group.worldToLocal(hit.point.clone());

  // Pick the nearest border on that face → determines adjacent face normal Nt
  const border = nearestEdgeOnFace(touchedFaceId, localHit); // {adjAxis, sign}
  const { ex, ey, ez } = cubeWorldAxes();

  let Nt;
  if (border.adjAxis === 'X') Nt = (border.sign > 0 ? ex : ex.clone().multiplyScalar(-1));
  if (border.adjAxis === 'Y') Nt = (border.sign > 0 ? ey : ey.clone().multiplyScalar(-1));
  if (border.adjAxis === 'Z') Nt = (border.sign > 0 ? ez : ez.clone().multiplyScalar(-1));

  // Direction of the shared edge line (consistent orientation)
  // edgeDir lies in both planes; using Nt × Ns keeps a consistent right-hand order.
  const edgeDir = new THREE.Vector3().crossVectors(Nt, Ns).normalize();

  // Build a stable tangent basis for the touched plane (for accumulation)
  // Use cube-local axes to make it orientation invariant
  // Choose a u axis in the plane most aligned with edgeDir to improve SNR
  const candidates = [ex, ey, ez].filter(v => Math.abs(v.dot(Ns)) < 0.5); // axes roughly in plane
  let u = candidates[0] || ex;
  if (candidates.length === 2) {
    u = (candidates[0].dot(edgeDir) > candidates[1].dot(edgeDir)) ? candidates[0].clone() : candidates[1].clone();
  } else {
    // fallback: project ex into plane
    u = ex.clone().sub(Ns.clone().multiplyScalar(ex.dot(Ns))).normalize();
  }
  const v = new THREE.Vector3().crossVectors(Ns, u).normalize();

  swipeState = {
    Ns, Nt, edgeDir, touchedFaceId,
    accAlongEdge: 0,
    lastScreen: { x: e.clientX, y: e.clientY },
    u, v,
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
  const k = 0.01; // sensitivity
  let worldDelta = camRight.multiplyScalar(dx * k).add(camUp.multiplyScalar(-dy * k));

  // Project onto the touched face plane
  worldDelta = worldDelta.sub(swipeState.Ns.clone().multiplyScalar(worldDelta.dot(swipeState.Ns)));

  // Accumulate **along the edge line**
  swipeState.accAlongEdge += worldDelta.dot(swipeState.edgeDir);
  swipeState.moved = true;
});

renderer.domElement.addEventListener('pointerup', async (e) => {
  activePointers.delete(e.pointerId);
  updatePinchState();
  if (pinchActive) return;
  if (!swipeState || !swipeState.moved) { swipeState = null; return; }

  const { Nt, accAlongEdge } = swipeState;
  swipeState = null;

  const MAG_MIN = 0.10; // world units threshold
  if (Math.abs(accAlongEdge) < MAG_MIN) return;

  // Determine target faceId from Nt
  const faceId = faceIdFromNormal(Nt);

  // Map sign of swipe along edge to CW/CCW (globally toggle-able)
  const positive = accAlongEdge >= 0;
  const dir = (positive
    ? (CW_IF_POSITIVE_ALONG_EDGE ? 'CW' : 'CCW')
    : (CW_IF_POSITIVE_ALONG_EDGE ? 'CCW' : 'CW'));

  await api.rotateFace(faceId, dir, true);
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
    navigator.serviceWorker.register('./sw.js?v=9').catch(() => {});
  });
}
