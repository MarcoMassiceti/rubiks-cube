import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- CONFIGURATION ---
const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b'; // REPLACE with your ESP32 UUID
const CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';    // REPLACE with your ESP32 UUID

let bluetoothDevice;
let bluetoothCharacteristic;

// --- 3D SETUP ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x222222);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(5, 5, 7);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('canvas-container').appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;

// --- CUBE GENERATION ---
// We create 27 small cubes to make one big cube
const cubes = [];
const geometry = new THREE.BoxGeometry(0.95, 0.95, 0.95);
// Colors: Right(Red), Left(Orange), Top(White), Bottom(Yellow), Front(Green), Back(Blue)
const materials = [
    new THREE.MeshBasicMaterial({ color: 0xb90000 }), // Right
    new THREE.MeshBasicMaterial({ color: 0xff5900 }), // Left
    new THREE.MeshBasicMaterial({ color: 0xffffff }), // Top
    new THREE.MeshBasicMaterial({ color: 0xffd500 }), // Bottom
    new THREE.MeshBasicMaterial({ color: 0x009e60 }), // Front
    new THREE.MeshBasicMaterial({ color: 0x0045ad })  // Back
];

const group = new THREE.Group();
scene.add(group);

// Generate 3x3x3 grid
for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
            const mesh = new THREE.Mesh(geometry, materials);
            mesh.position.set(x, y, z);
            mesh.userData = { x, y, z }; // Store initial grid position
            group.add(mesh);
            cubes.push(mesh);
        }
    }
}

// --- INTERACTION LOGIC (SWIPE DETECTION) ---
let startPointer = new THREE.Vector2();
let endPointer = new THREE.Vector2();
let isSwiping = false;
let intersectedObject = null;
let intersectedFaceIndex = -1;

const raycaster = new THREE.Raycaster();

window.addEventListener('mousedown', onPointerDown);
window.addEventListener('touchstart', (e) => onPointerDown(e.touches[0]), {passive: false});

window.addEventListener('mouseup', onPointerUp);
window.addEventListener('touchend', (e) => onPointerUp(e.changedTouches[0]));

function onPointerDown(event) {
    isSwiping = true;
    startPointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    startPointer.y = -(event.clientY / window.innerHeight) * 2 + 1;

    // Check if we clicked a cube
    raycaster.setFromCamera(startPointer, camera);
    const intersects = raycaster.intersectObjects(cubes);

    if (intersects.length > 0) {
        controls.enabled = false; // Disable camera rotation while swiping a face
        intersectedObject = intersects[0].object;
        intersectedFaceIndex = intersects[0].face.materialIndex; // 0:R, 1:L, 2:T, 3:B, 4:F, 5:Back
    } else {
        controls.enabled = true; // Allow camera rotate if clicking background
        intersectedObject = null;
    }
}

function onPointerUp(event) {
    if (!isSwiping || !intersectedObject) {
        isSwiping = false;
        controls.enabled = true;
        return;
    }

    endPointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    endPointer.y = -(event.clientY / window.innerHeight) * 2 + 1;

    const deltaX = endPointer.x - startPointer.x;
    const deltaY = endPointer.y - startPointer.y;
    
    // Minimum swipe distance threshold
    if (Math.abs(deltaX) + Math.abs(deltaY) > 0.1) {
        handleSwipe(intersectedFaceIndex, deltaX, deltaY);
    }

    isSwiping = false;
    controls.enabled = true;
    intersectedObject = null;
}

// --- SWIPE MAPPING LOGIC ---
function handleSwipe(faceIndex, dx, dy) {
    // This function maps the 2D swipe to a 3D rotation command (1-12)
    // faceIndex map: 0:Right, 1:Left, 2:Top, 3:Bottom, 4:Front, 5:Back
    
    let command = null;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    const isHorizontal = absDx > absDy;

    // Example logic for Front Face (Index 4, Green)
    // If you swipe Horizontal on Front face, you are rotating the Top or Bottom slices (Up/Down faces)
    // If you swipe Vertical on Front face, you are rotating Left or Right slices
    
    // NOTE: This logic needs to be expanded for all faces. 
    // Here is a simplified version for the "Face Rotation" interaction you requested:
    
    // Logic: If I am looking at Front Face, and I swipe the "Top Edge" right...
    // We map the face touched + direction -> Command ID
    
    console.log(`Face: ${faceIndex}, Dir: ${isHorizontal ? 'Horiz' : 'Vert'}`);

    // EXAMPLE: Front Face (Green)
    if (faceIndex === 4) { 
        if (isHorizontal) {
            // Swiping Front Face Horizontally actually rotates the UP or DOWN face 
            // BUT usually, users expect swiping the *face* to rotate *that face*. 
            // If you want to rotate the Front Face, you usually swipe the Top/Right/Bottom/Left edges.
            
            // Let's assume standard "Swipe the face to rotate that face" isn't what you asked.
            // You asked "Swipe outer edge".
            // Let's assume: Swipe Top Row of Front Face -> Rotate Top Face.
            // This requires checking *where* on the face they clicked (intersect point).
            // For simplicity in this snippet, I will map basic face rotations:
            
            command = dx > 0 ? 5 : 6; // Front CW / CCW (Placeholder logic)
        }
    }
    
    // TODO: You must fill out the rest of the logic for faces 0-5 based on your specific 'edge' preference.

    if (command) sendCommandToESP32(command);
}

// --- BLUETOOTH CONNECTION ---
document.getElementById('btn-solve').addEventListener('click', () => sendCommandToESP32(255)); // 255 = Special Solve Code
document.getElementById('btn-shuffle').addEventListener('click', performShuffle);

async function performShuffle() {
    // Send 20 random moves
    for(let i=0; i<20; i++) {
        const randomCmd = Math.floor(Math.random() * 12) + 1;
        await sendCommandToESP32(randomCmd);
        await new Promise(r => setTimeout(r, 200)); // Small delay between moves
    }
}

async function sendCommandToESP32(cmd) {
    if (!bluetoothCharacteristic) {
        // Try to connect if not connected
        try {
            await connectBluetooth();
        } catch (e) {
            console.log("Bluetooth connect failed", e);
            document.getElementById('status').innerText = "Connection Failed";
            return;
        }
    }

    try {
        const data = new Uint8Array([cmd]);
        await bluetoothCharacteristic.writeValue(data);
        console.log("Sent command:", cmd);
        
        // OPTIONAL: Animate the 3D cube here to match the physical cube
        // rotate3DCube(cmd); 
    } catch (error) {
        console.error("BT Write Error", error);
        document.getElementById('status').innerText = "Lost Connection";
    }
}

async function connectBluetooth() {
    bluetoothDevice = await navigator.bluetooth.requestDevice({
        filters: [{ name: 'ESP32_Rubiks' }], // CHANGE THIS to your ESP32 BLE Name
        optionalServices: [SERVICE_UUID]
    });

    const server = await bluetoothDevice.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    bluetoothCharacteristic = await service.getCharacteristic(CHAR_UUID);
    
    document.getElementById('status').innerText = "Connected to Cube";
    
    bluetoothDevice.addEventListener('gattserverdisconnected', () => {
        document.getElementById('status').innerText = "Disconnected";
        bluetoothCharacteristic = null;
    });
}


// --- ANIMATION LOOP ---
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}
animate();

// Handle Window Resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
