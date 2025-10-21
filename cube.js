// cube.js
export function createRubiksCube(scene) {
  const size = 3;
  const cubieSize = 1;
  const gap = 0.02;
  const half = (size - 1) / 2;
  const group = new THREE.Group();
  scene.add(group);

  // Colors per face: R, L, U, D, F, B (conventional scheme)
  const COLORS = {
    1: 0xff6b6b, // +X Right -> red
    2: 0xffe66d, // -X Left  -> yellow
    3: 0x4dabf7, // +Y Up    -> blue
    4: 0x51cf66, // -Y Down  -> green
    5: 0xf59f00, // +Z Front -> orange
    6: 0xffffff, // -Z Back  -> white
  };

  // Materials quick map per normal direction
  const stickerMat = (hex) => new THREE.MeshBasicMaterial({ color: hex });
  const blackMat = new THREE.MeshBasicMaterial({ color: 0x111111 });

  // Create 26 visible cubies with sticker planes
  const cubies = [];
  const cubieGeo = new THREE.BoxGeometry(cubieSize, cubieSize, cubieSize);

  for (let xi = 0; xi < size; xi++) {
    for (let yi = 0; yi < size; yi++) {
      for (let zi = 0; zi < size; zi++) {
        // Skip core? In Three we can keep all 27; doesn't matter much here.
        const mesh = new THREE.Mesh(cubieGeo, [
          blackMat, blackMat, blackMat, blackMat, blackMat, blackMat
        ]);
        mesh.position.set(
          (xi - half) * (cubieSize + gap),
          (yi - half) * (cubieSize + gap),
          (zi - half) * (cubieSize + gap),
        );
        // Tag logical indices
        mesh.userData = { xi, yi, zi };
        group.add(mesh);
        cubies.push(mesh);

        // Add sticker quads (thin planes) on outer faces
        const stickerThickness = 0.001;
        const stickerInset = 0.05;

        const addSticker = (faceId, normal, axis, coord, posGetter) => {
          // Only add if on outside for that normal
          const maxIndex = size - 1;
          const atOutside =
            (faceId === 1 && xi === maxIndex) ||
            (faceId === 2 && xi === 0) ||
            (faceId === 3 && yi === maxIndex) ||
            (faceId === 4 && yi === 0) ||
            (faceId === 5 && zi === maxIndex) ||
            (faceId === 6 && zi === 0);

          if (!atOutside) return;

          const planeGeo = new THREE.PlaneGeometry(
            cubieSize - 2 * stickerInset,
            cubieSize - 2 * stickerInset
          );
          const plane = new THREE.Mesh(planeGeo, stickerMat(COLORS[faceId]));
          const p = posGetter();
          plane.position.copy(p.clone().addScaledVector(normal, cubieSize / 2 + 0.001));
          // orient plane to face outward
          plane.lookAt(plane.position.clone().add(normal));
          mesh.add(plane);
        };

        // For each of 6 faces
        addSticker(1, new THREE.Vector3(1,0,0), 'x', xi, () => mesh.position.clone());
        addSticker(2, new THREE.Vector3(-1,0,0), 'x', xi, () => mesh.position.clone());
        addSticker(3, new THREE.Vector3(0,1,0), 'y', yi, () => mesh.position.clone());
        addSticker(4, new THREE.Vector3(0,-1,0), 'y', yi, () => mesh.position.clone());
        addSticker(5, new THREE.Vector3(0,0,1), 'z', zi, () => mesh.position.clone());
        addSticker(6, new THREE.Vector3(0,0,-1), 'z', zi, () => mesh.position.clone());
      }
    }
  }

  // === Logical state ===
  // We’ll update positions/rotations of cubies directly and consider them truth.
  // Helper: pick a “slice” by a plane in global coordinates
  const EPS = 1e-4;
  const planeMatchers = {
    1: (m) => m.getWorldPosition(new THREE.Vector3()).x > (half*(cubieSize+gap) - cubieSize/2 - gap/2 - EPS),
    2: (m) => m.getWorldPosition(new THREE.Vector3()).x < -(half*(cubieSize+gap) - cubieSize/2 - gap/2 - EPS),
    3: (m) => m.getWorldPosition(new THREE.Vector3()).y > (half*(cubieSize+gap) - cubieSize/2 - gap/2 - EPS),
    4: (m) => m.getWorldPosition(new THREE.Vector3()).y < -(half*(cubieSize+gap) - cubieSize/2 - gap/2 - EPS),
    5: (m) => m.getWorldPosition(new THREE.Vector3()).z > (half*(cubieSize+gap) - cubieSize/2 - gap/2 - EPS),
    6: (m) => m.getWorldPosition(new THREE.Vector3()).z < -(half*(cubieSize+gap) - cubieSize/2 - gap/2 - EPS),
  };

  // Rotation axes per face in GLOBAL coordinates:
  const faceAxis = {
    1: new THREE.Vector3(1,0,0),
    2: new THREE.Vector3(-1,0,0),
    3: new THREE.Vector3(0,1,0),
    4: new THREE.Vector3(0,-1,0),
    5: new THREE.Vector3(0,0,1),
    6: new THREE.Vector3(0,0,-1),
  };

  // Animate a face turn 90°
  let animating = false;
  function rotateFace(faceId, dir, animate = true) {
    if (animating) return Promise.resolve(); // serialize
    const slice = cubies.filter(planeMatchers[faceId]);
    const rotGroup = new THREE.Group();
    group.add(rotGroup);
    slice.forEach(m => {
      THREE.SceneUtils.attach(m, group, rotGroup);
    });

    const axis = faceAxis[faceId].clone().normalize();
    const angle = (dir === 'CW' ? -1 : 1) * (Math.PI / 2); // right-hand rule (viewing from outside)
    const duration = animate ? 140 : 0;

    animating = true;
    const start = performance.now();

    return new Promise(resolve => {
      const tick = (t) => {
        let k = duration ? Math.min(1, (t - start) / duration) : 1;
        rotGroup.setRotationFromAxisAngle(axis, angle * k);
        if (k < 1) {
          requestAnimationFrame(tick);
        } else {
          // Bake transform back to cubies
          slice.forEach(m => {
            m.updateMatrixWorld();
            THREE.SceneUtils.detach(m, rotGroup, group);
          });
          group.remove(rotGroup);
          animating = false;
          resolve();
        }
      };
      requestAnimationFrame(tick);
    });
  }

  function resetSolved() {
    // Quick reset by clearing all transforms
    group.children.forEach(m => { m.position.round(); m.rotation.set(0,0,0); m.updateMatrix(); });
  }

  // Random legal move: pick face 1..6 and CW/CCW
  async function randomTurn() {
    const faceId = 1 + Math.floor(Math.random() * 6);
    const dir = Math.random() < 0.5 ? 'CW' : 'CCW';
    await rotateFace(faceId, dir, true);
    return { faceId, dir };
  }

  async function shuffle(n = 25) {
    for (let i = 0; i < n; i++) {
      await randomTurn();
    }
  }

  return {
    group,
    api: { rotateFace, resetSolved, randomTurn, shuffle, faceAxis }
  };
}
