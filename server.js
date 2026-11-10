const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const { generateMaze, getSpawnPositions } = require('./game/maze');
const { updateBullet, getExpandedWallEdges } = require('./game/physics');
const { MatterWorld } = require('./game/matterPhysics');
const { checkBulletTankHit } = require('./game/collision');
const C = require('./game/constants');
const { spawnPowerUp, checkPowerUpPickup, applyPowerUp, tickPowerUpEffects, checkBulletShield, resetPowerUpIds, POWERUP_TYPES } = require('./game/powerups');

/* ── Express + Socket.IO setup ─────────────────────────── */

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

/* ── Game state ────────────────────────────────────────── */

let matterWorld = null;  // MatterWorld instance

const playerHistory = {}; // { socketId: { name, color } }

const game = {
  phase: 'waiting',       // 'waiting' | 'playing' | 'roundEnd'
  maze: null,             // { walls, rows, cols }
  tanks: {},              // { socketId: tankObj }
  bullets: [],
  powerUps: [],           // active power-ups on the map
  powerUpTimer: 0,        // frame counter for spawning
  roundPlayers: new Set(),// IDs of tanks spawned this round
  roundWinner: null,
  roundEndTimeout: null,
  carryOnEndsAt: null,
  carryOnWinnerId: null,
  roundStartedAt: null,
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
    shakeIntensity: 5,
    powerUpSpawnInterval: C.POWERUP_SPAWN_INTERVAL,
    enabledPowerUps: [C.POWERUP_SHIELD, C.POWERUP_DOUBLEGUN, C.POWERUP_LASER, C.POWERUP_SHOTGUN],
  },
  globalKills: 0,
  globalBullets: 0,
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
  powerUpSize: C.POWERUP_SIZE,
  shieldRadiusFraction: C.SHIELD_RADIUS_FRACTION,
  shieldColor: C.SHIELD_COLOR,
  shieldFlickerStartFrames: C.SHIELD_FLICKER_START_FRAMES,
  shieldDurationFrames: C.SHIELD_DURATION_FRAMES,
  shieldFlickerPeriodMs: C.SHIELD_FLICKER_PERIOD_MS,
  doubleGunBarrelOffset: C.DOUBLEGUN_BARREL_OFFSET,
  barrelLength: C.BARREL_LENGTH,
  barrelWidth: C.BARREL_WIDTH,
  laserLength: C.LASER_LENGTH,
  laserAimLength: C.LASER_AIM_LENGTH,
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
    const resolvedKills = [];
    for (const [vId, count] of Object.entries(t.killDetails || {})) {
      let vName = "Unknown";
      let vColor = "#999999";
      if (game.tanks[vId]) {
        vName = game.tanks[vId].name;
        vColor = game.tanks[vId].color;
      } else if (playerHistory[vId]) {
        vName = playerHistory[vId].name;
        vColor = playerHistory[vId].color;
      }
      resolvedKills.push({ name: vName, color: vColor, count });
    }
    scores[id] = { name: t.name, score: t.score, kills: t.kills, killDetails: resolvedKills, color: t.color };
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
  game.powerUps = [];
  game.powerUpTimer = 0;
  game.roundWinner = null;
  game.carryOnEndsAt = null;
  game.carryOnWinnerId = null;
  resetPowerUpIds();

  // Precompute expanded edges for bullets (3px wall half-thickness + 0px bullet radius = 3 to prevent shoot-through)
  game.bulletEdges = [];
  for (const w of game.maze.walls) {
    game.bulletEdges.push(...getExpandedWallEdges(w, 3));
  }

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
    t.ghost = false;
    t.shield = null;
    t.doubleGun = null;
    t.laser = null;
    t.shotgun = null;
    t.roundKills = 0;
    idx++;

    // Create Matter.js body for this tank
    matterWorld.addTank(id, sp.x, sp.y, sp.angle);

    // Clear latched fire from intermission
    if (inputs[id]) {
      inputs[id].wantsFire = false;
    }
  }

  game.phase = 'playing';
  game.roundStartedAt = Date.now();

  io.emit('newRound', {
    maze: game.maze,
    tanks: game.tanks,
    scores: buildScores(),
    powerUps: game.powerUps,
  });
}

function checkRoundEnd() {
  if (game.roundPlayers.size < 2) return;

  // 2-minute timeout: force draw
  if (game.roundStartedAt && Date.now() - game.roundStartedAt >= C.ROUND_TIMEOUT) {
    // Kill everyone still alive
    for (const id of game.roundPlayers) {
      const t = game.tanks[id];
      if (t && t.alive) {
        t.alive = false;
        t.ghost = true;
        io.emit('tankKilled', { tankId: id, byId: null });
      }
    }
    game.roundWinner = null;
    game.carryOnEndsAt = null;
    game.phase = 'roundEnd';
    io.emit('roundEnd', { winnerId: null, scores: buildScores(), drawReason: 'death due to boredom' });
    game.roundEndTimeout = setTimeout(() => {
      game.roundEndTimeout = null;
      const total = Object.keys(game.tanks).length;
      if (total >= 2) {
        startNewRound();
      } else {
        game.phase = 'waiting';
        io.emit('phaseChange', { phase: 'waiting' });
      }
    }, 2000);
    return;
  }

  const alive = Object.values(game.tanks).filter(
    t => t.alive && !t.ghost && game.roundPlayers.has(t.id)
  );

  if (alive.length > 1) {
    game.carryOnEndsAt = null;
    return;
  }

  // Round over or carry on
  if (alive.length === 1) {
    if (!game.carryOnEndsAt) {
      game.carryOnEndsAt = Date.now() + game.settings.postWinDelay;
      game.carryOnWinnerId = alive[0].id;
      
      let titleText = null;
      if (game.roundPlayers.size > 2) {
        if (alive[0].roundKills === game.roundPlayers.size - 1) {
          const titles = [
            "The Tank Harbor Butcher", "Ruthless Killer", "Maker of Graves",
            "Angel of Death", "Azrael's Apprentice", "Harvester of Souls",
            "Walker Among Corpses", "Veteran Slayer"
          ];
          titleText = titles[Math.floor(Math.random() * titles.length)];
        } else if (alive[0].roundKills === 0) {
          const titles = ["Pussy Cat", "The Late Lord Frey", "Comfy Ass Winner"];
          titleText = titles[Math.floor(Math.random() * titles.length)];
        }
      }

      io.emit('carryOnStart', {
        winnerId: alive[0].id,
        endsAt: game.carryOnEndsAt,
        titleText
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

  playerHistory[socket.id] = { name: tank.name, color: tank.color };

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
  io.emit('scoresUpdated', buildScores());

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
      if (playerHistory[socket.id]) playerHistory[socket.id].color = color;
      io.emit('colorUpdated', { id: socket.id, color });
      io.emit('scoresUpdated', buildScores());
    }
  });

  socket.on('changeName', (name) => {
    if (game.tanks[socket.id]) {
      const cleanName = String(name).trim().substring(0, 12) || "Player";
      game.tanks[socket.id].name = cleanName;
      if (playerHistory[socket.id]) playerHistory[socket.id].name = cleanName;
      io.emit('nameUpdated', { id: socket.id, name: cleanName });
      io.emit('scoresUpdated', buildScores());
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
    io.emit('scoresUpdated', buildScores());

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
    if (!tank || !inp) continue;
    // Ghost tanks keep moving but cannot control or shoot
    if (!tank.alive && !tank.ghost) continue;

    matterWorld.applyTankInput(id, inp, game.settings);

    // Fire (rising-edge, latched)
    if (inp.wantsFire && !tank.ghost) {
      inp.wantsFire = false;
      const count = game.bullets.filter(b => b.ownerId === id && b.alive && !b.isPowerWeapon).length;
      const isPowerWeapon = (tank.laser && tank.laser.active) || 
                            (tank.shotgun && tank.shotgun.active) || 
                            (tank.doubleGun && tank.doubleGun.active);
      if (isPowerWeapon || count < game.settings.maxBulletsPerPlayer) {
        // Get the current tank state from Matter.js for accurate barrel position
        const mState = matterWorld.getTankState(id);
        const fireAngle = mState ? mState.angle : tank.angle;
        const fireX = mState ? mState.x : tank.x;
        const fireY = mState ? mState.y : tank.y;

        if (tank.laser && tank.laser.active && tank.laser.shotsLeft > 0) {
          game.globalBullets++;
          game.bullets.push({
            type: 'laser',
            isPowerWeapon: true,
            x: fireX + Math.cos(fireAngle) * C.BULLET_SPAWN_OFFSET,
            y: fireY + Math.sin(fireAngle) * C.BULLET_SPAWN_OFFSET,
            vx: Math.cos(fireAngle) * C.LASER_SPEED,
            vy: Math.sin(fireAngle) * C.LASER_SPEED,
            bounces: 0,
            ownerId: id,
            age: 0,
            alive: true,
            lifetime: C.LASER_LIFETIME_FRAMES,
            color: tank.color
          });
          tank.laser.shotsLeft--;
          if (tank.laser.shotsLeft <= 0) tank.laser.active = false;
        } else if (tank.shotgun && tank.shotgun.active && tank.shotgun.shotsLeft > 0) {
          for (let p = 0; p < C.SHOTGUN_PELLETS; p++) {
            const angleOffset = (Math.random() * 2 - 1) * C.SHOTGUN_SPREAD_RADIANS;
            const pelletAngle = fireAngle + angleOffset;
            const sideOffset = (Math.random() * 2 - 1) * (C.TANK_WIDTH / 2);
            const perpX = -Math.sin(fireAngle) * sideOffset;
            const perpY = Math.cos(fireAngle) * sideOffset;

            game.globalBullets++;
            game.bullets.push({
              type: 'pellet',
              isPowerWeapon: true,
              x: fireX + Math.cos(fireAngle) * C.BULLET_SPAWN_OFFSET + perpX,
              y: fireY + Math.sin(fireAngle) * C.BULLET_SPAWN_OFFSET + perpY,
              vx: Math.cos(pelletAngle) * C.SHOTGUN_SPEED * (0.95 + Math.random() * 0.1),
              vy: Math.sin(pelletAngle) * C.SHOTGUN_SPEED * (0.95 + Math.random() * 0.1),
              bounces: 0,
              ownerId: id,
              age: 0,
              alive: true,
              lifetime: C.SHOTGUN_LIFETIME_FRAMES,
            });
          }
          tank.shotgun.shotsLeft--;
          if (tank.shotgun.shotsLeft <= 0) tank.shotgun.active = false;
        } else if (tank.doubleGun && tank.doubleGun.active && tank.doubleGun.shotsLeft > 0) {
          // Double gun: fire from alternating barrel
          const side = tank.doubleGun.nextBarrel === 0 ? -1 : 1;
          const perpX = -Math.sin(fireAngle) * C.DOUBLEGUN_BARREL_OFFSET * side;
          const perpY = Math.cos(fireAngle) * C.DOUBLEGUN_BARREL_OFFSET * side;

          game.globalBullets++;
          game.bullets.push({
            isPowerWeapon: true,
            x: fireX + Math.cos(fireAngle) * C.BULLET_SPAWN_OFFSET + perpX,
            y: fireY + Math.sin(fireAngle) * C.BULLET_SPAWN_OFFSET + perpY,
            vx: Math.cos(fireAngle) * game.settings.bulletSpeed,
            vy: Math.sin(fireAngle) * game.settings.bulletSpeed,
            bounces: 0,
            ownerId: id,
            age: 0,
            alive: true,
            lifetime: C.DOUBLEGUN_BULLET_LIFETIME,
          });

          tank.doubleGun.nextBarrel = tank.doubleGun.nextBarrel === 0 ? 1 : 0;
          tank.doubleGun.shotsLeft--;
        } else {
          // Normal single barrel
          game.globalBullets++;
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
  }

  // 2. Step Matter.js world
  matterWorld.step();

  // 3. Sync tank positions from Matter.js back to game state (alive + ghost)
  for (const id of game.roundPlayers) {
    const tank = game.tanks[id];
    if (!tank) continue;
    if (!tank.alive && !tank.ghost) continue;

    const mState = matterWorld.getTankState(id);
    if (mState) {
      tank.x = mState.x;
      tank.y = mState.y;
      tank.angle = mState.angle;
    }
  }

  // 4. Update bullets (ray-cast bouncing off walls and shields)
  for (const b of game.bullets) {
    if (b.alive) updateBullet(b, game.bulletEdges, game.tanks);
  }



  // 6. Bullet → Tank collisions (now uses rectangle hitbox)
  for (const b of game.bullets) {
    if (!b.alive) continue;
    for (const id of Object.keys(game.tanks)) {
      const tank = game.tanks[id];
      if (checkBulletTankHit(b, tank)) {
        tank.alive = false;
        b.alive = false;

        // Ghost mode: reduce opacity, keep moving, no interaction
        tank.ghost = true;
        matterWorld.ghostTank(id);
        
        // Award kill if they hit someone else
        if (b.ownerId !== id && game.tanks[b.ownerId]) {
          game.tanks[b.ownerId].kills++;
          game.tanks[b.ownerId].roundKills = (game.tanks[b.ownerId].roundKills || 0) + 1;
          const victimId = id;
          if (!game.tanks[b.ownerId].killDetails) game.tanks[b.ownerId].killDetails = {};
          game.tanks[b.ownerId].killDetails[victimId] = (game.tanks[b.ownerId].killDetails[victimId] || 0) + 1;
        }
        game.globalKills++;

        // Remove powerups from dead tank
        tank.shield = null;
        tank.doubleGun = null;
        tank.laser = null;
        tank.shotgun = null;

        io.emit('tankKilled', { tankId: id, byId: b.ownerId });
        io.emit('scoresUpdated', buildScores());
        break; // this bullet is spent
      }
    }
  }

  // 7. Power-up spawning
  game.powerUpTimer++;
  if (game.powerUpTimer >= game.settings.powerUpSpawnInterval) {
    game.powerUpTimer = 0;
    const activeCount = game.powerUps.filter(p => p.alive).length;
    if (activeCount < 3) {
      const pu = spawnPowerUp(game.maze, game.tanks, game.powerUps, game.settings.enabledPowerUps);
      if (pu) {
        game.powerUps.push(pu);
        io.emit('powerUpSpawned', pu);
      }
    }
  }

  // 8. Power-up pickup
  const pickups = checkPowerUpPickup(game.tanks, game.powerUps);
  for (const { tankId, powerUp } of pickups) {
    applyPowerUp(game.tanks[tankId], powerUp);
    io.emit('powerUpCollected', { tankId, powerUpId: powerUp.id, type: powerUp.type });
  }
  game.powerUps = game.powerUps.filter(p => p.alive);

  // 9. Tick power-up effects (shield timer, doublegun expiry)
  tickPowerUpEffects(game.tanks);

  // 10. Prune dead bullets
  game.bullets = game.bullets.filter(b => b.alive);

  // 11. Check round end
  checkRoundEnd();

  // 12. Broadcast state snapshot (throttled)
  if (tick % broadcastEvery === 0) {
    io.volatile.emit('state', {
      tanks: game.tanks,
      bullets: game.bullets.map(b => ({
        x: b.x, y: b.y, 
        type: b.type, vx: b.vx, vy: b.vy, 
        color: b.color, age: b.age, 
        lifetime: b.lifetime || 600 // C.BULLET_LIFETIME_FRAMES
      })),
      powerUps: game.powerUps,
      globalStats: { kills: game.globalKills, bullets: game.globalBullets }
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
