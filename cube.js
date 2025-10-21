export function createRubiksCube(scene) {
  const size = 3;
  const cubieSize = 1;
  const gap = 0.02;
  const half = (size - 1) / 2;
  const group = new THREE.Group();
  scene.add(group);

  const COLORS = {
    1: 0xff6b6b, // +X Right  (faceId 1)
    2: 0xffe66d, // -X Left   (faceId 2)
    3: 0x4dabf7, // +Y Up     (faceId 3)
    4: 0x51cf66, // -Y Down   (faceId 4)
    5: 0xf59f00, // +Z Front  (faceId 5)
    6: 0xffffff, // -Z Back   (faceId 6)
  };

  const stickerMat = (hex) => new THREE.MeshBasicMaterial({ color: hex });
  const blackMat   = new THREE.MeshBasicMaterial({ color: 0x111111 });

  const cubies = [];
  const cubieGeo = new THREE.BoxGeometry(cubieSize, cubieSize, cubieSize);

  for (let xi = 0; xi < size; xi++) {
    for (let yi = 0; yi < size; yi++) {
      for (let zi = 0; zi < size; zi++) {
        const mesh = new THREE.Mesh(cubieGeo, [blackMat, blackMat, blackMat, blackMat, blackMat, blackMat]);
        mesh.position.set(
          (xi - half) * (cubieSize + gap),
          (yi - half) * (cubieSize + gap),
          (zi - half) * (cubieSize + gap),
        );
        mesh.userData = { xi, yi, zi };
        group.add(mesh);
        cubies.push(mesh);

        const stickerInset = 0.05;

        const addSticker = (faceId, normal) => {
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
          plane.position.copy(mesh.position.clone().addScaledVector(normal, cubieSize / 2 + 0.001));
          plane.lookAt(plane.position.clone().add(normal));
          mesh.add(plane);
        };

        addSticker(1, new THREE.Vector3( 1, 0, 0));
        addSticker(2, new THREE.Vector3(-1, 0, 0));
        addSticker(3, new THREE.Vector3( 0, 1, 0));
        addSticker(4, new THREE.Vector3( 0,-1, 0));
        addSticker(5, new THREE.Vector3( 0, 0, 1));
        addSticker(6, new THREE.Vector3( 0, 0,-1));
      }
    }
  }

  // --- Selection helpers ---
  const EPS = 1e-4;
  const extent = half*(cubieSize+gap) - cubieSize/2 - gap/2 - EPS;

  const planeMatchers = {
    1: (m) => m.getWorldPosition(new THREE.Vector3()).x >  extent,
    2: (m) => m.getWorldPosition(new THREE.Vector3()).x < -extent,
    3: (m) => m.getWorldPosition(new THREE.Vector3()).y >  extent,
    4: (m) => m.getWorldPosition(new THREE.Vector3()).y < -extent,
    5: (m) => m.getWorldPosition(new THREE.Vector3()).z >  extent,
    6: (m) => m.getWorldPosition(new THREE.Vector3()).z < -extent,
  };

  const faceAxis = {
    1: new THREE.Vector3( 1, 0, 0),
    2: new THREE.Vector3(-1, 0, 0),
    3: new THREE.Vector3( 0, 1, 0),
    4: new THREE.Vector3( 0,-1, 0),
    5: new THREE.Vector3( 0, 0, 1),
    6: new THREE.Vector3( 0, 0,-1),
  };

  let animating = false;
  function rotateFace(faceId, dir, animate = true) {
    if (animating) return Promise.resolve();

    const slice = cubies.filter(planeMatchers[faceId]);

    // Temp rotation pivot
    const rotGroup = new THREE.Group();
    group.add(rotGroup);

    // Attach slice to rotGroup while preserving world transforms
    slice.forEach(m => rotGroup.attach(m));

    const axis = faceAxis[faceId].clone().normalize();
    const angle = (dir === 'CW' ? -1 : 1) * (Math.PI / 2);
    const duration = animate ? 140 : 0;

    animating = true;
    const start = performance.now();

    return new Promise(resolve => {
      const tick = (t) => {
        const k = duration ? Math.min(1, (t - start) / duration) : 1;
        rotGroup.setRotationFromAxisAngle(axis, angle * k);
        if (k < 1) {
          requestAnimationFrame(tick);
        } else {
          // Bake transform back to main group
          slice.forEach(m => group.attach(m)); // reattach to main group preserving world transform
          group.remove(rotGroup);
          animating = false;
          resolve();
        }
      };
      requestAnimationFrame(tick);
    });
  }

  function resetSolved() {
    // Reset all cubies to initial grid-aligned transform
    group.children.forEach(m => {
      if (m.isMesh) {
        // positions already snapped during creation; easiest reset is:
        m.position.set(Math.round(m.position.x), Math.round(m.position.y), Math.round(m.position.z));
        m.rotation.set(0,0,0);
        m.updateMatrix();
      }
    });
  }

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
