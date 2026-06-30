const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const { generateMaze, getSpawnPositions } = require('./game/maze');
const { updateBullet } = require('./game/physics');
const { MatterWorld } = require('./game/matterPhysics');
const { checkBulletTankHit } = require('./game/collision');
const C = require('./game/constants');

/* ── Express + Socket.IO setup ─────────────────────────── */

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

/* ── Game state ────────────────────────────────────────── */

let matterWorld = null;  // MatterWorld instance

const game = {
  phase: 'waiting',       // 'waiting' | 'playing' | 'roundEnd'
  maze: null,             // { walls, rows, cols }
  tanks: {},              // { socketId: tankObj }
  bullets: [],
  roundPlayers: new Set(),// IDs of tanks spawned this round
  roundWinner: null,
  roundEndTimeout: null,
  carryOnEndsAt: null,
  carryOnWinnerId: null,
  settings: {
    tankSpeed: C.TANK_SPEED,
    tankTurnRate: C.TANK_TURN_RATE,
    bulletSpeed: C.BULLET_SPEED,
    maxBulletsPerPlayer: C.MAX_BULLETS_PER_PLAYER,
    postWinDelay: C.POST_WIN_DELAY,
    mazeRows: 0,
    mazeCols: 0,
    symmetricMaze: false,
    wallRemoval: C.WALL_REMOVAL_FRACTION,
    shakeIntensity: 5
  }
};

const inputs = {};        // { socketId: inputState }

/* ── Config blob sent to clients for rendering ─────────── */

const clientConfig = {
  cellSize: C.CELL_SIZE,
  tankWidth: C.TANK_WIDTH,
  tankLength: C.TANK_LENGTH,
  tankRadius: C.TANK_RADIUS,
  bulletRadius: C.BULLET_RADIUS,
  broadcastRate: C.BROADCAST_RATE,
};

/* ── Helpers ───────────────────────────────────────────── */

function getAvailableSlot() {
  const used = new Set(Object.values(game.tanks).map(t => t.colorIdx));
  for (let i = 0; i < C.MAX_PLAYERS; i++) {
    if (!used.has(i)) return i;
  }
  return 0;
}

function buildScores() {
  const scores = {};
  for (const [id, t] of Object.entries(game.tanks)) {
    scores[id] = { name: t.name, score: t.score, kills: t.kills, color: t.color };
  }
  return scores;
}

function startNewRound() {
  const s = game.settings;
  let rows = s.mazeRows > 0 ? s.mazeRows : (C.MAZE_ROWS_MIN + Math.floor(Math.random() * (C.MAZE_ROWS_MAX - C.MAZE_ROWS_MIN + 1)));
  let cols = s.mazeCols > 0 ? s.mazeCols : (C.MAZE_COLS_MIN + Math.floor(Math.random() * (C.MAZE_COLS_MAX - C.MAZE_COLS_MIN + 1)));
  
  if (s.symmetricMaze) {
    // Force a square even-sized maze for 4-way rotational symmetry
    rows = cols = Math.max(rows, cols);
    if (rows % 2 !== 0) rows++;
    cols = rows;
  }
  
  game.maze = generateMaze(cols, rows, s.wallRemoval, s.symmetricMaze);

  // Initialize Matter.js world
  if (matterWorld) matterWorld.destroy();
  matterWorld = new MatterWorld();
  matterWorld.initWalls(game.maze.walls);

  // Everyone connected becomes a round player
  game.roundPlayers = new Set(Object.keys(game.tanks));
  game.bullets = [];
  game.roundWinner = null;
  game.carryOnEndsAt = null;
  game.carryOnWinnerId = null;

  // Spawn each player
  const spawns = getSpawnPositions(rows, cols, C.MAX_PLAYERS, s.symmetricMaze);
  let idx = 0;
  for (const id of game.roundPlayers) {
    const sp = spawns[idx % spawns.length];
    const t = game.tanks[id];
    t.x = sp.x;
    t.y = sp.y;
    t.angle = sp.angle;
    t.alive = true;
    idx++;

    // Create Matter.js body for this tank
    matterWorld.addTank(id, sp.x, sp.y, sp.angle);

    // Clear latched fire from intermission
    if (inputs[id]) {
      inputs[id].wantsFire = false;
    }
  }

  game.phase = 'playing';

  io.emit('newRound', {
    maze: game.maze,
    tanks: game.tanks,
    scores: buildScores(),
  });
}

function checkRoundEnd() {
  const alive = Object.values(game.tanks).filter(
    t => t.alive && game.roundPlayers.has(t.id)
  );

  if (game.roundPlayers.size < 2) return;

  if (alive.length > 1) {
    game.carryOnEndsAt = null;
    return;
  }

  // Round over or carry on
  if (alive.length === 1) {
    if (!game.carryOnEndsAt) {
      game.carryOnEndsAt = Date.now() + game.settings.postWinDelay;
      game.carryOnWinnerId = alive[0].id;
      io.emit('carryOnStart', {
        winnerId: alive[0].id,
        endsAt: game.carryOnEndsAt
      });
      return;
    } else if (Date.now() < game.carryOnEndsAt) {
      return; // Still carrying on
    }
    
    // Carry-on finished
    alive[0].score++;
    game.roundWinner = alive[0].id;
  } else {
    // 0 alive
    game.roundWinner = null; // draw
    game.carryOnEndsAt = null;
  }

  game.phase = 'roundEnd';
  io.emit('roundEnd', { winnerId: game.roundWinner, scores: buildScores() });

  // Wait 2 seconds on a draw, else use ROUND_END_DELAY
  const delay = game.roundWinner === null ? 2000 : C.ROUND_END_DELAY;

  // Schedule next round
  game.roundEndTimeout = setTimeout(() => {
    game.roundEndTimeout = null;
    const total = Object.keys(game.tanks).length;
    if (total >= 2) {
      startNewRound();
    } else {
      game.phase = 'waiting';
      io.emit('phaseChange', { phase: 'waiting' });
    }
  }, delay);
}

/* ── Socket connection handling ────────────────────────── */

io.on('connection', (socket) => {
  const totalPlayers = Object.keys(game.tanks).length;
  if (totalPlayers >= C.MAX_PLAYERS) {
    socket.emit('serverFull');
    socket.disconnect();
    return;
  }

  // Assign a colour slot
  const slot = getAvailableSlot();
  const tank = {
    id: socket.id,
    x: 0, y: 0, angle: 0,
    alive: false,
    color: C.PLAYER_COLORS[slot],
    colorIdx: slot,
    score: 0,
    kills: 0,
    name: C.PLAYER_NAMES[slot],
  };
  game.tanks[socket.id] = tank;
  inputs[socket.id] = {
    forward: false, backward: false,
    left: false, right: false,
    fire: false, wantsFire: false,
  };

  console.log(`+ ${tank.name} joined (${Object.keys(game.tanks).length}/${C.MAX_PLAYERS})`);

  // Tell the new client about the current state
  const spectating = game.phase === 'playing'; // mid-round joiners spectate
  socket.emit('welcome', {
    id: socket.id,
    config: clientConfig,
    maze: game.maze,
    tanks: game.tanks,
    phase: game.phase,
    spectating,
    scores: buildScores(),
  });

  socket.emit('settingsUpdated', game.settings);
  io.emit('playerJoined', { id: socket.id, tank });

  // Single player dev mode: start immediately if at least 1 player
  if (game.phase === 'waiting' && Object.keys(game.tanks).length >= 1) {
    startNewRound();
  } else if (game.phase === 'playing' && game.roundPlayers.size === 1) {
    // If a second player joins while 1 player is fooling around, restart for them
    startNewRound();
  }

  /* ── Per-client events ──────────────────────────────── */

  socket.on('input', (data) => {
    const inp = inputs[socket.id];
    if (!inp) return;
    inp.forward  = !!data.forward;
    inp.backward = !!data.backward;
    inp.left     = !!data.left;
    inp.right    = !!data.right;
    // Latch fire so we never miss a quick tap between ticks
    if (data.fire && !inp.fire) inp.wantsFire = true;
    inp.fire = !!data.fire;
  });

  socket.on('updateSettings', (newSettings) => {
    game.settings = { ...game.settings, ...newSettings };
    io.emit('settingsUpdated', game.settings);
  });

  socket.on('changeColor', (color) => {
    if (game.tanks[socket.id]) {
      game.tanks[socket.id].color = color;
      io.emit('colorUpdated', { id: socket.id, color });
    }
  });

  socket.on('disconnect', () => {
    const t = game.tanks[socket.id];
    if (t) console.log(`- ${t.name} left`);

    // Remove Matter.js body
    if (matterWorld) matterWorld.removeTank(socket.id);

    delete game.tanks[socket.id];
    delete inputs[socket.id];
    game.roundPlayers.delete(socket.id);

    // Remove that player's bullets
    game.bullets = game.bullets.filter(b => b.ownerId !== socket.id);

    io.emit('playerLeft', { id: socket.id });

    const total = Object.keys(game.tanks).length;
    if (total < 1) {
      // Nobody left
      if (game.roundEndTimeout) {
        clearTimeout(game.roundEndTimeout);
        game.roundEndTimeout = null;
      }
      game.phase = 'waiting';
      game.bullets = [];
      io.emit('phaseChange', { phase: 'waiting' });
      return;
    }

    if (game.phase === 'playing') checkRoundEnd();
  });
});

/* ── Server-side game loop (60 Hz) ─────────────────────── */

let tick = 0;
const broadcastEvery = Math.round(C.TICK_RATE / C.BROADCAST_RATE);

setInterval(() => {
  if (game.phase !== 'playing') return;
  if (!matterWorld) return;
  tick++;

  // 1. Apply inputs to Matter.js tank bodies
  for (const id of game.roundPlayers) {
    const tank = game.tanks[id];
    const inp = inputs[id];
    if (!tank || !inp || !tank.alive) continue;

    matterWorld.applyTankInput(id, inp, game.settings);

    // Fire (rising-edge, latched)
    if (inp.wantsFire) {
      inp.wantsFire = false;
      const count = game.bullets.filter(b => b.ownerId === id && b.alive).length;
      if (count < game.settings.maxBulletsPerPlayer) {
        // Get the current tank state from Matter.js for accurate barrel position
        const mState = matterWorld.getTankState(id);
        const fireAngle = mState ? mState.angle : tank.angle;
        const fireX = mState ? mState.x : tank.x;
        const fireY = mState ? mState.y : tank.y;

        game.bullets.push({
          x: fireX + Math.cos(fireAngle) * C.BULLET_SPAWN_OFFSET,
          y: fireY + Math.sin(fireAngle) * C.BULLET_SPAWN_OFFSET,
          vx: Math.cos(fireAngle) * game.settings.bulletSpeed,
          vy: Math.sin(fireAngle) * game.settings.bulletSpeed,
          bounces: 0,
          ownerId: id,
          age: 0,
          alive: true,
        });
      }
    }
  }

  // 2. Step Matter.js world
  matterWorld.step();

  // 3. Sync tank positions from Matter.js back to game state
  for (const id of game.roundPlayers) {
    const tank = game.tanks[id];
    if (!tank || !tank.alive) continue;

    const mState = matterWorld.getTankState(id);
    if (mState) {
      tank.x = mState.x;
      tank.y = mState.y;
      tank.angle = mState.angle;
    }
  }

  // 4. Update bullets (ray-cast bouncing, unchanged from original)
  for (const b of game.bullets) {
    if (b.alive) updateBullet(b, game.maze.walls);
  }

  // 5. Bullet → Tank collisions (now uses rectangle hitbox)
  for (const b of game.bullets) {
    if (!b.alive) continue;
    for (const id of Object.keys(game.tanks)) {
      const tank = game.tanks[id];
      if (checkBulletTankHit(b, tank)) {
        tank.alive = false;
        b.alive = false;
        
        // Remove the dead tank from Matter.js so it stops colliding
        matterWorld.removeTank(id);
        
        // Award kill if they hit someone else
        if (b.ownerId !== id && game.tanks[b.ownerId]) {
          game.tanks[b.ownerId].kills++;
        }

        io.emit('tankKilled', { tankId: id, byId: b.ownerId });
        break; // this bullet is spent
      }
    }
  }

  // 6. Prune dead bullets
  game.bullets = game.bullets.filter(b => b.alive);

  // 7. Check round end
  checkRoundEnd();

  // 8. Broadcast state snapshot (throttled)
  if (tick % broadcastEvery === 0) {
    io.volatile.emit('state', {
      tanks: game.tanks,
      bullets: game.bullets.map(b => ({ x: b.x, y: b.y })),
    });
  }
}, 1000 / C.TICK_RATE);

/* ── Start listening ───────────────────────────────────── */

const PORT = 3001;
server.listen(PORT, '0.0.0.0', () => {
  let localIP = 'localhost';
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        localIP = iface.address;
        break;
      }
    }
  }
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║    TankTrouble LAN (Matter.js)       ║');
  console.log('  ╠══════════════════════════════════════╣');
  console.log(`  ║  Local:   http://localhost:${PORT}      ║`);
  console.log(`  ║  Network: http://${localIP.padEnd(15)}:${PORT} ║`);
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
  console.log('  Share the Network URL with players on your WiFi!');
  console.log('');
});
