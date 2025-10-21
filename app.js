import { createRubiksCube } from './cube.js';

const sceneEl = document.getElementById('scene');
const globeEl = document.getElementById('globe');
const shuffleBtn = document.getElementById('shuffleBtn');
const solveBtn = document.getElementById('solveBtn');
const shuffleCount = document.getElementById('shuffleCount');

// === THREE scene ===
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth/window.innerHeight, 0.1, 100);
// Start farther out; we will also auto-frame after the cube is built.
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

// Subtle base rotation
group.rotation.set(0.3, 0.6, 0);

// -------- Camera framing & zoom helpers --------
function frameObjectToView(object, margin = 1.6) {
  // Compute bounding sphere of the object and set camera distance accordingly
  const box = new THREE.Box3().setFromObject(object);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  // distance so that the object fits vertically in view, with some margin
  const fovRad = THREE.MathUtils.degToRad(camera.fov);
  const dist = (sphere.radius * margin) / Math.sin(fovRad / 2);
  setCameraDistance(dist);
}

function getCameraDistance() {
  // Distance from camera to origin (we always look at 0,0,0)
  return camera.position.length();
}

function setCameraDistance(d) {
  const min = 3.0;      // clamp to avoid clipping in
  const max = 40.0;     // clamp to avoid zooming too far
  const clamped = Math.max(min, Math.min(max, d));
  const dirVec = camera.position.clone().normalize();
  camera.position.copy(dirVec.multiplyScalar(clamped));
  camera.updateProjectionMatrix();
}

function dollyByScale(scale) {
  // scale > 1 => zoom out; scale < 1 => zoom in
  const current = getCameraDistance();
  setCameraDistance(current * scale);
}

// Auto-frame once on load (after cube exists)
frameObjectToView(group, 1.8);

// Render loop
function animate() {
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

// Resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  // keep object nicely framed when orientation changes
  // (don’t snap brutally; just ensure we aren’t too close)
  const minSuggested = 6.5;
  if (getCameraDistance() < minSuggested) setCameraDistance(minSuggested);
}, { passive: true });

// ========== Globe drag (1-finger) to rotate the cube in place ==========
let globeDragging = false;
let lastGlobe = null;

const globeRect = () => globeEl.getBoundingClientRect();

function onGlobeStart(clientX, clientY) {
  globeDragging = true;
  lastGlobe = { x: clientX, y: clientY };
}
function onGlobeMove(clientX, clientY) {
  if (!globeDragging || !lastGlobe) return;
  const dx = clientX - lastGlobe.x;
  const dy = clientY - lastGlobe.y;
  group.rotation.y += dx * 0.005;
  group.rotation.x += dy * 0.005;
  lastGlobe = { x: clientX, y: clientY };
}
function onGlobeEnd() { globeDragging = false; lastGlobe = null; }

// Pointer wiring for globe
globeEl.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  globeEl.setPointerCapture(e.pointerId);
  onGlobeStart(e.clientX, e.clientY);
});
globeEl.addEventListener('pointermove', (e) => {
  if (!globeDragging) return;
  e.preventDefault();
  onGlobeMove(e.clientX, e.clientY);
});
globeEl.addEventListener('pointerup', () => { onGlobeEnd(); });
globeEl.addEventListener('pointercancel', () => { onGlobeEnd(); });

// ========== Turn swipe everywhere else (not on globe) ==========
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let swipeState = null;

// Keep track of active pointers to detect pinch
const activePointers = new Map(); // id -> {x,y}
let pinchActive = false;
let pinchStartDistance = 0;

function setPointerFromEvent(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  const x = ( (e.clientX - rect.left) / rect.width ) * 2 - 1;
  const y = -( (e.clientY - rect.top) / rect.height ) * 2 + 1;
  pointer.set(x, y);
}

function worldPointOnHit(e) {
  setPointerFromEvent(e);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(group.children, true);
  if (hits.length) return hits[0];
  return null;
}

function principalAxis(v) {
  const mags = [Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)];
  const i = mags.indexOf(Math.max(...mags));
  if (i === 0) return new THREE.Vector3(Math.sign(v.x) || 1, 0, 0);
  if (i === 1) return new THREE.Vector3(0, Math.sign(v.y) || 1, 0);
  return new THREE.Vector3(0, 0, Math.sign(v.z) || 1);
}

function faceIdFromNormal(n) {
  const a = principalAxis(n);
  if (a.x > 0) return 1;
  if (a.x < 0) return 2;
  if (a.y > 0) return 3;
  if (a.y < 0) return 4;
  if (a.z > 0) return 5;
  return 6; // a.z < 0
}

// ---------- Pinch helpers ----------
function screenDistance(p1, p2) {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.hypot(dx, dy);
}

function updatePinchState() {
  const points = Array.from(activePointers.values());
  if (points.length === 2) {
    const d = screenDistance(points[0], points[1]);
    if (!pinchActive) {
      pinchActive = true;
      pinchStartDistance = d;
    } else if (pinchStartDistance > 0) {
      // scale factor: >1 = fingers moved apart => zoom out
      const scale = pinchStartDistance > 0 ? (pinchStartDistance / d) : 1;
      // invert so spreading fingers (d bigger) => scale < 1 => zoom in (more natural)
      // We'll use the reciprocal to make spreading zoom OUT less aggressively.
      const adjusted = d / pinchStartDistance;
      dollyByScale(1 / adjusted);
      pinchStartDistance = d; // incremental
    }
  } else {
    pinchActive = false;
    pinchStartDistance = 0;
  }
}

// Canvas pointer listeners (handle pinch + turn-swipe)
renderer.domElement.addEventListener('pointerdown', (e) => {
  // track pointer for possible pinch
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  // if starting a pinch (now 2 pointers), don't start swipe
  if (activePointers.size >= 2) {
    updatePinchState();
    return;
  }

  // ignore globe area for swipe
  const g = globeRect();
  if (e.clientX >= g.left && e.clientX <= g.right && e.clientY >= g.top && e.clientY <= g.bottom) return;

  const hit = worldPointOnHit(e);
  if (!hit) return;
  swipeState = {
    startEvent: e,
    startHit: hit,
    startPoint: hit.point.clone(),
    startNormal: hit.face?.normal.clone().transformDirection(hit.object.matrixWorld) || new THREE.Vector3(),
    lastPoint: hit.point.clone(),
    moved: false
  };
});

renderer.domElement.addEventListener('pointermove', (e) => {
  // update pointer positions
  if (activePointers.has(e.pointerId)) {
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }

  // handle pinch first
  if (activePointers.size >= 2) {
    e.preventDefault();
    updatePinchState();
    // while pinching, cancel any swipe in progress
    swipeState = null;
    return;
  }

  // otherwise, standard swipe tracking
  if (!swipeState) return;
  const hit = worldPointOnHit(e);
  if (!hit) return;
  swipeState.moved = true;
  swipeState.lastPoint = hit.point.clone();
});

renderer.domElement.addEventListener('pointerup', async (e) => {
  // remove from active pointers
  activePointers.delete(e.pointerId);
  updatePinchState(); // may end pinch

  // If a pinch just ended or is active, don't interpret as a swipe
  if (pinchActive) return;

  if (!swipeState) return;
  const { startPoint, lastPoint, startNormal } = swipeState;
  swipeState = null;

  if (!startPoint || !lastPoint) return;

  const drag = lastPoint.clone().sub(startPoint);
  const dragLen = drag.length();
  const MIN = 0.15;
  if (dragLen < MIN) return;

  const n = startNormal.clone().normalize();
  const tangential = drag.clone().sub(n.clone().multiplyScalar(drag.dot(n)));

  const axis = principalAxis(tangential);
  const cross = new THREE.Vector3().crossVectors(axis, n).normalize();
  const faceId = faceIdFromNormal(cross);

  const sameDir = tangential.dot(axis) >= 0;
  const faceNeg = (faceId === 2 || faceId === 4 || faceId === 6);
  const dirTurn = (sameDir ^ faceNeg) ? 'CW' : 'CCW';

  await api.rotateFace(faceId, dirTurn, true);
}, { passive: false });

renderer.domElement.addEventListener('pointercancel', (e) => {
  activePointers.delete(e.pointerId);
  updatePinchState();
  swipeState = null;
});

// Optional: mouse wheel zoom for desktop (ignored on iPhone)
renderer.domElement.addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = Math.sign(e.deltaY);
  // delta > 0 => scroll down => zoom out slightly
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
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
