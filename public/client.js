// client.js - simple three.js first-person + WebSocket multiplayer prototype

// ---- Basic settings ----
const SERVER = (location.origin.replace(/^http/, 'ws')) + '/';
const ws = new WebSocket(SERVER);
let myId = null;

// Three.js setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// lighting
const light = new THREE.DirectionalLight(0xffffff, 0.9);
light.position.set(5,10,7);
scene.add(light);
scene.add(new THREE.AmbientLight(0xffffff, 0.4));

// player "capsule" height offset (camera sits at head)
let player = { x:0,y:2,z:0, rotY:0 };

// world storage: map key -> mesh
const blockMeshes = new Map();

// block geometry + simple materials
const BOX = new THREE.BoxGeometry(1,1,1);
const materials = {
  dirt: new THREE.MeshLambertMaterial({color:0x8B5A2B}),
  stone: new THREE.MeshLambertMaterial({color:0x7f7f7f}),
  wood: new THREE.MeshLambertMaterial({color:0xA0522D})
};

function addBlockAtKey(key, type){
  if(blockMeshes.has(key)) return;
  const [x,y,z] = key.split(',').map(Number);
  const mesh = new THREE.Mesh(BOX, materials[type] || materials.dirt);
  mesh.position.set(x, y, z);
  scene.add(mesh);
  blockMeshes.set(key, mesh);
}
function removeBlockAtKey(key){
  const m = blockMeshes.get(key);
  if(!m) return;
  scene.remove(m);
  blockMeshes.delete(key);
}

// ground grid helper (invisible to collisions)
const gridSize = 50;
const grid = new THREE.GridHelper(gridSize*2, gridSize*2, 0x444444, 0x888888);
grid.position.y = -2.5;
scene.add(grid);

// players map for other players
const otherPlayers = new Map();
const playersDiv = document.getElementById('players');

function upPlayersPanel(){
  playersDiv.innerHTML = '<b>Players</b><br/>' + Array.from(otherPlayers.values()).map(p => p.name || p.id).join('<br/>');
}

// camera and controls (custom simple FPS)
let move = {forward:false, back:false, left:false, right:false, jump:false};
let velocityY = 0;
const gravity = -0.03;

// pointer lock for looking around
renderer.domElement.addEventListener('click', ()=> {
  renderer.domElement.requestPointerLock();
});
document.addEventListener('pointerlockchange', ()=> {
  if (document.pointerLockElement === renderer.domElement) {
    document.addEventListener('mousemove', onMouseMove);
  } else {
    document.removeEventListener('mousemove', onMouseMove);
  }
});

function onMouseMove(e){
  const sensitivity = 0.002;
  player.rotY -= e.movementX * sensitivity;
  camera.rotation.x -= e.movementY * sensitivity;
  camera.rotation.x = Math.max(-Math.PI/2 + 0.01, Math.min(Math.PI/2 - 0.01, camera.rotation.x));
}

// keyboard
window.addEventListener('keydown', (e)=>{
  if(e.code === 'KeyW') move.forward=true;
  if(e.code === 'KeyS') move.back=true;
  if(e.code === 'KeyA') move.left=true;
  if(e.code === 'KeyD') move.right=true;
  if(e.code === 'Space') { if (Math.abs(velocityY) < 0.001) velocityY = 0.6; }
});
window.addEventListener('keyup', (e)=>{
  if(e.code === 'KeyW') move.forward=false;
  if(e.code === 'KeyS') move.back=false;
  if(e.code === 'KeyA') move.left=false;
  if(e.code === 'KeyD') move.right=false;
});

// inventory
let selectedBlock = 'dirt';
document.querySelectorAll('#inventory button').forEach(b=>{
  b.addEventListener('click', ()=> {
    document.querySelectorAll('#inventory button').forEach(x=>x.classList.remove('sel'));
    b.classList.add('sel');
    selectedBlock = b.dataset.block;
  });
});
// highlight default
document.querySelector('#inventory button.sel')?.classList.add('sel') || document.querySelector('#inventory button')?.classList.add('sel');

// resize
window.addEventListener('resize', ()=> {
  camera.aspect = window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// raycaster for block targeting
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2(0,0);
// left click = break, right click = place
window.addEventListener('mousedown', (e)=>{
  if(document.pointerLockElement !== renderer.domElement) return;
  e.preventDefault();
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  raycaster.set(camera.position, dir);
  // find nearest intersect with block meshes
  const intersects = raycaster.intersectObjects(Array.from(blockMeshes.values()));
  if(intersects.length > 0){
    const it = intersects[0];
    const mesh = it.object;
    // compute integer block coordinates
    const bx = Math.round(mesh.position.x);
    const by = Math.round(mesh.position.y);
    const bz = Math.round(mesh.position.z);
    if(e.button === 0) {
      // break
      const key = `${bx},${by},${bz}`;
      ws.send(JSON.stringify({ t: 'break', key }));
    } else if (e.button === 2) {
      // place at adjacent position (along normal)
      const nx = Math.round(bx + it.face.normal.x);
      const ny = Math.round(by + it.face.normal.y);
      const nz = Math.round(bz + it.face.normal.z);
      const key = `${nx},${ny},${nz}`;
      ws.send(JSON.stringify({ t: 'place', key, type: selectedBlock }));
    }
  } else {
    // if no block hit and right click, place in front at integer coords
    if(e.button === 2){
      const pos = new THREE.Vector3().copy(camera.position).add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(3));
      const key = `${Math.round(pos.x)},${Math.round(pos.y)},${Math.round(pos.z)}`;
      ws.send(JSON.stringify({ t: 'place', key, type: selectedBlock }));
    }
  }
});
// disable context menu so right-click works
window.addEventListener('contextmenu', (e)=> e.preventDefault());

// WebSocket handling
ws.addEventListener('open', ()=> console.log('WS open'));
ws.addEventListener('message', (ev)=> {
  const msg = JSON.parse(ev.data);
  if(msg.t === 'init'){
    myId = msg.id;
    // set player spawn
    player.x = msg.me.x; player.y = msg.me.y; player.z = msg.me.z; player.rotY = msg.me.rotY;
    // load blocks
    msg.blocks.forEach(b => {
      addBlockFromServer(b.key, b.type);
    });
    // other players
    msg.players.forEach(p => {
      if(p.id !== myId){
        otherPlayers.set(p.id, p);
      }
    });
    upPlayersPanel();
  } else if (msg.t === 'place'){
    addBlockFromServer(msg.key, msg.type);
  } else if (msg.t === 'break'){
    removeBlockAtKey(msg.key);
  } else if (msg.t === 'player_join'){
    if(msg.player.id !== myId) otherPlayers.set(msg.player.id, msg.player);
    upPlayersPanel();
  } else if (msg.t === 'player_leave'){
    otherPlayers.delete(msg.id);
    upPlayersPanel();
  } else if (msg.t === 'player_update'){
    if(msg.id === myId) return;
    const p = otherPlayers.get(msg.id);
    if(p){
      p.x = msg.x; p.y = msg.y; p.z = msg.z; p.rotY = msg.rotY;
    } else {
      otherPlayers.set(msg.id, { id: msg.id, x:msg.x,y:msg.y,z:msg.z, rotY: msg.rotY });
    }
    upPlayersPanel();
  } else if (msg.t === 'chat'){
    addChat(`${msg.name || msg.id}: ${msg.text}`);
  }
});

// helper to add block from server data
function addBlockFromServer(key, type){
  addBlockAtKey(key, type);
}

// initial camera position
camera.position.set(player.x, player.y, player.z);

// send periodic updates of player position
setInterval(()=> {
  if(!myId) return;
  // update local player movement & physics
  const speed = 0.08;
  const forward = new THREE.Vector3(Math.sin(player.rotY), 0, Math.cos(player.rotY));
  const right = new THREE.Vector3(forward.z, 0, -forward.x);
  let dx = 0, dz = 0;
  if(move.forward) { dx += forward.x * speed; dz += forward.z * speed; }
  if(move.back)    { dx -= forward.x * speed; dz -= forward.z * speed; }
  if(move.left)    { dx -= right.x * speed; dz -= right.z * speed; }
  if(move.right)   { dx += right.x * speed; dz += right.z * speed; }

  // simple collision: don't sink below y=0 ground
  velocityY += gravity;
  player.y += velocityY;
  if(player.y < 1.8){ player.y = 1.8; velocityY = 0; }

  player.x += dx;
  player.z += dz;

  // update camera
  camera.position.set(player.x, player.y + 0.2, player.z);
  camera.rotation.set(camera.rotation.x, player.rotY, 0);

  // send the minimal update to server
  ws.send(JSON.stringify({ t: 'update', id: myId, x: player.x, y: player.y, z: player.z, rotY: player.rotY }));
}, 50);

// animation loop
function animate(){
  requestAnimationFrame(animate);
  // update other players: render simple cubes representing them
  // (create meshes lazily)
  otherPlayers.forEach((p, id) => {
    if(id === myId) return;
    if(!p._mesh){
      const g = new THREE.BoxGeometry(0.6,1.6,0.6);
      const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x3366ff }));
      scene.add(m);
      p._mesh = m;
    }
    p._mesh.position.set(p.x, p.y, p.z);
    p._mesh.rotation.y = p.rotY || 0;
  });

  renderer.render(scene, camera);
}
animate();

// chat UI
const chatLog = document.getElementById('chatLog');
const chatIn = document.getElementById('chatIn');
chatIn.addEventListener('keydown', (e)=>{
  if(e.key === 'Enter'){
    const text = chatIn.value.trim();
    if(text){
      ws.send(JSON.stringify({ t: 'chat', id: myId, text, name: null }));
      addChat('Me: ' + text);
      chatIn.value = '';
    }
  }
});
function addChat(text){
  const div = document.createElement('div'); div.textContent = text; chatLog.appendChild(div); chatLog.scrollTop = chatLog.scrollHeight;
}
