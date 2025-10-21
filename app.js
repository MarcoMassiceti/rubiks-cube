import { createRubiksCube } from './cube.js?v=7';

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

// ========== Turn swipe & pinch on canvas ==========
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let swipeState = null;

const activePointers = new Map(); // id -> {x,y}
let pinchActive = false;
let pinchStartDistance = 0;

function setPointerFromEvent(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  pointer.set(x, y);
}
function worldPointOnHit(e) {
  setPointerFromEvent(e);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(group.children, true);
  return hits.length ? hits[0] : null;
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
  return 6;
}
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

  const g = globeRect();
  if (e.clientX >= g.left && e.clientX <= g.right && e.clientY >= g.top && e.clientY <= g.bottom) return;

  const hit = worldPointOnHit(e);
  if (!hit) return;
  swipeState = {
    startPoint: hit.point.clone(),
    startNormal: hit.face?.normal.clone().transformDirection(hit.object.matrixWorld) || new THREE.Vector3(),
    lastPoint: hit.point.clone(),
    moved: false
  };
});

renderer.domElement.addEventListener('pointermove', (e) => {
  if (activePointers.has(e.pointerId)) activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (activePointers.size >= 2) { e.preventDefault(); updatePinchState(); swipeState = null; return; }

  if (!swipeState) return;
  const hit = worldPointOnHit(e);
  if (!hit) return;
  swipeState.moved = true;
  swipeState.lastPoint = hit.point.clone();
});

renderer.domElement.addEventListener('pointerup', async (e) => {
  activePointers.delete(e.pointerId);
  updatePinchState();
  if (pinchActive) return;

  if (!swipeState) return;
  const { startPoint, lastPoint, startNormal } = swipeState;
  swipeState = null;
  if (!startPoint || !lastPoint) return;

  const drag = lastPoint.clone().sub(startPoint);
  if (drag.length() < 0.15) return;

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

// Optional: mouse wheel zoom for desktop
renderer.domElement.addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = Math.sign(e.deltaY);
  const step = 1 + (0.08 * Math.abs(delta));
  dollyByScale(delta > 0 ? step : 1 / step);
}, { passive: false });

// === PWA service worker ===
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const params = new URLSearchParams(location.search);
    if (params.get('dev') === '1') return;
    navigator.serviceWorker.register('./sw.js?v=7').catch(() => {});
  });
}
