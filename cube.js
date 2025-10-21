// cube.js
// - Local-space stickers (no z-fighting)
// - Robust face turns with snapping (no float drift)
// - Slice selection uses snapped local coords (won't grab 2 rows)

export function createRubiksCube(scene) {
  // ---- Layout constants ----
  const SIZE = 3;
  const CUBIE = 1;
  const GAP = 0.02;
  const STEP = CUBIE + GAP;               // distance between cubie centers
  const HALF = (SIZE - 1) / 2;
  const EDGE = HALF * STEP;               // coordinate of outer layer centers

  const group = new THREE.Group();
  scene.add(group);

  // Face IDs (global frame):
  // 1:+X (R)  2:-X (L)  3:+Y (U)  4:-Y (D)  5:+Z (F)  6:-Z (B)
  const COLORS = {
    1: 0xff6b6b, // Right
    2: 0xffe66d, // Left
    3: 0x4dabf7, // Up
    4: 0x51cf66, // Down
    5: 0xf59f00, // Front
    6: 0xffffff, // Back
  };

  // Materials
  const blackMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
  const stickerMat = (hex) =>
    new THREE.MeshBasicMaterial({
      color: hex,
      polygonOffset: true,          // prevent z-fighting with the base cube
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    });

  // Cubies + stickers
  const cubies = [];
  const baseGeo = new THREE.BoxGeometry(CUBIE, CUBIE, CUBIE);
  const STICKER_INSET = 0.05;
  const STICKER_OFFSET = CUBIE / 2 + 0.001;

  // Helper to add one sticker to a cubie (LOCAL space!)
  function addStickerLocal(parentMesh, faceId, normalVec3) {
    const isOuter =
      (faceId === 1 && parentMesh.userData.xi === SIZE - 1) ||
      (faceId === 2 && parentMesh.userData.xi === 0) ||
      (faceId === 3 && parentMesh.userData.yi === SIZE - 1) ||
      (faceId === 4 && parentMesh.userData.yi === 0) ||
      (faceId === 5 && parentMesh.userData.zi === SIZE - 1) ||
      (faceId === 6 && parentMesh.userData.zi === 0);

    if (!isOuter) return;

    const planeGeo = new THREE.PlaneGeometry(
      CUBIE - 2 * STICKER_INSET,
      CUBIE - 2 * STICKER_INSET
    );
    const plane = new THREE.Mesh(planeGeo, stickerMat(COLORS[faceId]));

    // Position in the cubie's LOCAL space
    plane.position.set(
      normalVec3.x * STICKER_OFFSET,
      normalVec3.y * STICKER_OFFSET,
      normalVec3.z * STICKER_OFFSET
    );
    // Orient to face outward (local)
    const look = normalVec3.clone().normalize();
    const target = plane.position.clone().add(look);
    plane.lookAt(target);

    parentMesh.add(plane);
  }

  // Build 27 cubies (keeping the center for simplicity)
  for (let xi = 0; xi < SIZE; xi++) {
    for (let yi = 0; yi < SIZE; yi++) {
      for (let zi = 0; zi < SIZE; zi++) {
        const m = new THREE.Mesh(baseGeo, [
          blackMat, blackMat, blackMat, blackMat, blackMat, blackMat
        ]);

        const px = (xi - HALF) * STEP;
        const py = (yi - HALF) * STEP;
        const pz = (zi - HALF) * STEP;
        m.position.set(px, py, pz);

        // Save logical indices and original position for "Solve"
        m.userData = {
          xi, yi, zi,
          origin: new THREE.Vector3(px, py, pz)
        };

        group.add(m);
        cubies.push(m);

        // Stickers in LOCAL space (no world-position math!)
        addStickerLocal(m, 1, new THREE.Vector3( 1, 0, 0)); // +X
        addStickerLocal(m, 2, new THREE.Vector3(-1, 0, 0)); // -X
        addStickerLocal(m, 3, new THREE.Vector3( 0, 1, 0)); // +Y
        addStickerLocal(m, 4, new THREE.Vector3( 0,-1, 0)); // -Y
        addStickerLocal(m, 5, new THREE.Vector3( 0, 0, 1)); // +Z
        addStickerLocal(m, 6, new THREE.Vector3( 0, 0,-1)); // -Z
      }
    }
  }

  // ---- Slice selection on snapped local positions ----
  // After each turn we snap positions to the exact grid, so we can select by equality with tolerance.
  const TOL = 1e-4;
  const isAt = (val, target) => Math.abs(val - target) < TOL;

  const matchers = {
    1: (m) => isAt(m.position.x, +EDGE),
    2: (m) => isAt(m.position.x, -EDGE),
    3: (m) => isAt(m.position.y, +EDGE),
    4: (m) => isAt(m.position.y, -EDGE),
    5: (m) => isAt(m.position.z, +EDGE),
    6: (m) => isAt(m.position.z, -EDGE),
  };

  // ---- Rotation axes in GLOBAL coordinates ----
  const faceAxis = {
    1: new THREE.Vector3( 1, 0, 0),
    2: new THREE.Vector3(-1, 0, 0),
    3: new THREE.Vector3( 0, 1, 0),
    4: new THREE.Vector3( 0,-1, 0),
    5: new THREE.Vector3( 0, 0, 1),
    6: new THREE.Vector3( 0, 0,-1),
  };

  // ---- Snapping helpers (positions & rotations) ----

  // Round a number to the nearest of [-EDGE, 0, +EDGE]
  function snapCoord(v) {
    if (v >  (+EDGE + 0) / 2) return +EDGE;
    if (v <  (-EDGE - 0) / 2) return -EDGE;
    return 0;
  }

  // Snap an object's rotation matrix to the nearest 90° orthonormal basis.
  function snapRotation(obj) {
    // Extract the object's rotation matrix in world, convert to local since parent is axis-aligned.
    const m = obj.matrix.clone();
    m.extractRotation(obj.matrix);

    // Take basis vectors and round each component to {-1,0,1} then re-orthonormalize.
    const x = new THREE.Vector3().setFromMatrixColumn(obj.matrix, 0);
    const y = new THREE.Vector3().setFromMatrixColumn(obj.matrix, 1);
    const z = new THREE.Vector3().setFromMatrixColumn(obj.matrix, 2);

    const roundAxis = (v) => {
      const r = new THREE.Vector3(
        Math.round(v.x),
        Math.round(v.y),
        Math.round(v.z)
      );
      // If vector rounded to zero length (rare), fallback to original axis rounded by sign
      if (r.lengthSq() === 0) {
        r.set(Math.sign(v.x), Math.sign(v.y), Math.sign(v.z));
      }
      return r.normalize();
    };

    const xr = roundAxis(x);
    // Make y orthogonal to xr but close to original y
    let yr = roundAxis(y);
    // If not orthogonal, recompute via z and x
    const zr = roundAxis(z);
    // Ensure right-handed orthonormal basis
    // Compute yr as zr x xr to guarantee orthogonality/right-handedness
    yr = new THREE.Vector3().crossVectors(zr, xr).normalize();

    // Rebuild rotation matrix
    const R = new THREE.Matrix4().makeBasis(xr, yr, zr);
    const q = new THREE.Quaternion().setFromRotationMatrix(R);
    obj.quaternion.copy(q);
  }

  // Snap cubie to exact grid after a turn
  function snapCubie(c) {
    c.position.set(
      snapCoord(c.position.x),
      snapCoord(c.position.y),
      snapCoord(c.position.z)
    );
    snapRotation(c);
    c.updateMatrix();
  }

  // ---- Face rotation (single entry point) ----
  let animating = false;

  function rotateFace(faceId, dir, animate = true) {
    if (animating) return Promise.resolve();

    // Select the slice using current (already snapped) local coordinates
    const slice = cubies.filter(matchers[faceId]);

    // Create a temporary pivot at the origin; rotate in world axes.
    const pivot = new THREE.Group();
    group.add(pivot);

    // Attach slice to pivot (preserves world transforms)
    slice.forEach((m) => pivot.attach(m));

    const axis = faceAxis[faceId].clone().normalize();
    const angle = (dir === 'CW' ? -1 : 1) * (Math.PI / 2);
    const duration = animate ? 140 : 0;

    animating = true;
    const start = performance.now();

    return new Promise((resolve) => {
      const tick = (t) => {
        const k = duration ? Math.min(1, (t - start) / duration) : 1;
        pivot.setRotationFromAxisAngle(axis, angle * k);

        if (k < 1) {
          requestAnimationFrame(tick);
        } else {
          // Bake transform back to main group and SNAP every moved cubie
          slice.forEach((m) => {
            group.attach(m);
            snapCubie(m);
          });
          group.remove(pivot);
          animating = false;
          resolve();
        }
      };
      requestAnimationFrame(tick);
    });
  }

  // ---- Public helpers ----

  function resetSolved() {
    cubies.forEach((m) => {
      m.position.copy(m.userData.origin);
      m.quaternion.identity();
      m.updateMatrix();
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
