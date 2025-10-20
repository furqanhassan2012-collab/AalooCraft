// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Serve client files
app.use(express.static(path.join(__dirname, 'public')));

// Simple in-memory world: a small 3D grid (x,z columns with height)
const WORLD_SIZE = 40; // plane size (-WORLD_SIZE .. WORLD_SIZE)
const WORLD_HEIGHT = 12;

// We'll store blocks in a map keyed by "x,y,z"
const blocks = new Map();

// Initialize a basic terrain: ground at y=0 with a few layers
for (let x = -WORLD_SIZE; x <= WORLD_SIZE; x++) {
  for (let z = -WORLD_SIZE; z <= WORLD_SIZE; z++) {
    for (let y = -2; y <= 0; y++) {
      const key = `${x},${y},${z}`;
      blocks.set(key, { type: 'dirt' });
    }
    // a few stone veins
    if (Math.random() < 0.02) {
      blocks.set(`${x},1,${z}`, { type: 'stone' });
    }
  }
}

const players = new Map(); // id -> {x,y,z,rot, name}

// Broadcast helper
function broadcast(obj) {
  const raw = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(raw);
  }
}

// When a new client connects
wss.on('connection', (ws) => {
  const id = uuidv4();
  // default spawn position
  const spawnX = Math.floor(Math.random() * 6) - 3;
  const spawnZ = Math.floor(Math.random() * 6) - 3;
  const p = { id, x: spawnX, y: 2, z: spawnZ, rotY: 0, name: `Player-${id.slice(0,4)}` };
  players.set(id, p);

  // Send initial full state: id, blocks snapshot, other players
  const blocksArray = [];
  for (const [key, val] of blocks.entries()) {
    blocksArray.push({ key, type: val.type });
  }

  ws.send(JSON.stringify({ t: 'init', id, me: p, players: Array.from(players.values()), blocks: blocksArray }));

  // Announce new player
  broadcast({ t: 'player_join', player: p });

  // receive messages
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) { return; }
    // handle messages: 'update' (position), 'place', 'break'
    if (msg.t === 'update') {
      const pl = players.get(msg.id);
      if (pl) {
        pl.x = msg.x; pl.y = msg.y; pl.z = msg.z; pl.rotY = msg.rotY;
        broadcast({ t: 'player_update', id: msg.id, x: pl.x, y: pl.y, z: pl.z, rotY: pl.rotY });
      }
    } else if (msg.t === 'place') {
      // place block at key if empty
      const { key, type } = msg;
      if (!blocks.has(key)) {
        blocks.set(key, { type });
        broadcast({ t: 'place', key, type });
      }
    } else if (msg.t === 'break') {
      const { key } = msg;
      if (blocks.has(key)) {
        // return block type to client as "drop"
        const val = blocks.get(key);
        blocks.delete(key);
        broadcast({ t: 'break', key, type: val.type });
      }
    } else if (msg.t === 'chat') {
      broadcast({ t: 'chat', id: msg.id, text: msg.text, name: msg.name });
    }
  });

  ws.on('close', () => {
    players.delete(id);
    broadcast({ t: 'player_leave', id });
  });
});

server.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
