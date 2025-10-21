// app.js
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
camera.position.set(5, 5, 5);
camera.lookAt(0,0,0);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace; // crisp colors
sceneEl.appendChild(renderer.domElement);

// Lights
const amb = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(amb);
const dir = new THREE.DirectionalLight(0xffffff, 0.6);
dir.position.set(5,8,7);
scene.add(dir);

// Cube
const { group, api } = createRubiksCube(scene);

// Subtle base rotation so it’s not axis-aligned flat
group.rotation.set(0.3, 0.6, 0);

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
}, { passive: true });

// === Globe drag (1-finger) to rotate the cube in place ===
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
  // Rotate group around world Y and X
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
globeEl.addEventListener('pointerup', (e) => { onGlobeEnd(); });
globeEl.addEventListener('pointercancel', () => { onGlobeEnd(); });

// === Turn swipe everywhere else (not on globe) ===
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let swipeState = null;

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
  const ax = new THREE.Vector3(Math.sign(v.x), 0, 0).multiplyScalar(Math.abs(v.x));
  const ay = new THREE.Vector3(0, Math.sign(v.y), 0).multiplyScalar(Math.abs(v.y));
  const az = new THREE.Vector3(0, 0, Math.sign(v.z)).multiplyScalar(Math.abs(v.z));
  const mags = [Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)];
  const i = mags.indexOf(Math.max(...mags));
  return [ax, ay, az][i].clone().normalize(); // ± unit axis
}

// Map world normal to faceId 1..6
function faceIdFromNormal(n) {
  const a = principalAxis(n);
  if (a.x > 0) return 1;
  if (a.x < 0) return 2;
  if (a.y > 0) return 3;
  if (a.y < 0) return 4;
  if (a.z > 0) return 5;
  return 6; // a.z < 0
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  // ignore globe area
  const g = globeRect();
  if (e.clientX >= g.left && e.clientX <= g.right && e.clientY >= g.top && e.clientY <= g.bottom) return;

  const hit = worldPointOnHit(e);
  if (!hit) return;
  swipeState = {
    startEvent: e,
    startHit: hit, // contains .face, .object, .point
    startPoint: hit.point.clone(),
    startNormal: hit.face?.normal.clone().transformDirection(hit.object.matrixWorld) || new THREE.Vector3(),
    lastPoint: hit.point.clone(),
    moved: false
  };
});

renderer.domElement.addEventListener('pointermove', (e) => {
  if (!swipeState) return;
  const hit = worldPointOnHit(e);
  if (!hit) return;
  swipeState.moved = true;
  swipeState.lastPoint = hit.point.clone();
});

renderer.domElement.addEventListener('pointerup', async (e) => {
  if (!swipeState) return;
  const { startPoint, lastPoint, startNormal } = swipeState;
  swipeState = null;

  if (!startPoint || !lastPoint) return;

  const drag = lastPoint.clone().sub(startPoint);
  const dragLen = drag.length();
  const MIN = 0.15; // min world distance to count as a turn swipe
  if (dragLen < MIN) return;

  // Project drag onto plane tangent to touched face
  const n = startNormal.clone().normalize();
  const tangential = drag.clone().sub(n.clone().multiplyScalar(drag.dot(n)));

  // Determine rotation axis (global principal axis most aligned with tangential)
  const axis = principalAxis(tangential);
  // Determine target face: must be orthogonal to touched normal and consistent with axis × n
  const cross = new THREE.Vector3().crossVectors(axis, n).normalize();
  // cross points toward the face normal we want to rotate (global)
  const faceId = faceIdFromNormal(cross);

  // Direction via right-hand rule: if swipe aligns with +axis when looking from outside target face, that's CCW or CW depending on mapping.
  // We’ll evaluate sign by checking orientation between tangential and axis.
  const sameDir = tangential.dot(axis) >= 0;
  // For our mapping, if sameDir is true, use CW for some faces to keep consistency.
  // Quick rule: CW when (sameDir XOR faceNegNormal)
  const faceNeg = (faceId === 2 || faceId === 4 || faceId === 6);
  const dir = (sameDir ^ faceNeg) ? 'CW' : 'CCW';

  await api.rotateFace(faceId, dir, true);
}, { passive: false });

// === Buttons ===
shuffleBtn.addEventListener('click', async () => {
  const n = Math.max(1, Math.min(200, Number(shuffleCount.value) || 25));
  shuffleBtn.disabled = solveBtn.disabled = true;
  await api.shuffle(n);
  shuffleBtn.disabled = solveBtn.disabled = false;
});

solveBtn.addEventListener('click', async () => {
  // For now: reset to solved pose (not an algorithmic solver)
  // (You can replace with a true solver later.)
  await api.rotateFace(1, 'CW', false); // noopish tiny to flush anim queue
  api.resetSolved();
});

// === PWA service worker ===
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
