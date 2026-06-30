/* global io, Renderer */

(function () {
  'use strict';

  /* ── DOM refs ──────────────────────────────────────────── */
  const canvas   = document.getElementById('canvas');
  const ctx      = canvas.getContext('2d');
  const scoreEl  = document.getElementById('scoreboard');
  const statusEl = document.getElementById('status');
  const timerEl  = document.getElementById('round-timer');

  const settingsBtn = document.getElementById('settings-btn');
  const settingsModal = document.getElementById('settings-modal');
  const settingsSave = document.getElementById('settings-save');
  const settingsCancel = document.getElementById('settings-cancel');

  const inpTankSpeed = document.getElementById('set-tank-speed');
  const inpTankTurn = document.getElementById('set-tank-turn');
  const inpBulletSpeed = document.getElementById('set-bullet-speed');
  const inpMaxBullets = document.getElementById('set-max-bullets');
  const inpCarryOn = document.getElementById('set-carry-on');
  const inpMazeRows = document.getElementById('set-maze-rows');
  const inpMazeCols = document.getElementById('set-maze-cols');
  const inpSymmetricMaze = document.getElementById('set-symmetric-maze');
  const inpWallRemoval = document.getElementById('set-wall-removal');
  const inpShake = document.getElementById('set-shake');
  const colorPicker = document.getElementById('color-picker');

  /* ── Client state ──────────────────────────────────────── */
  let myId      = null;
  let config    = {};
  let maze      = null;
  let phase     = 'waiting';
  let spectating = false;
  let winnerId  = null;
  let roundStartTime = 0;
  let carryOnEndsAt = null;
  let carryOnWinnerId = null;

  // State snapshots for interpolation
  let prevState  = null;
  let currState  = null;
  let stateTime  = 0;

  /* ── Socket.IO ─────────────────────────────────────────── */
  const socket = io();

  socket.on('welcome', (data) => {
    myId       = data.id;
    config     = data.config;
    maze       = data.maze;
    phase      = data.phase;
    spectating = data.spectating;

    if (data.tanks) {
      currState = { tanks: data.tanks, bullets: [] };
      prevState = null;
    }
    generateMazeColors();
    resizeCanvas();
    updateScoreboard(data.scores);
    updateStatus();
    if (data.tanks[myId]) colorPicker.value = data.tanks[myId].color;
  });

  socket.on('newRound', (data) => {
    maze       = data.maze;
    phase      = 'playing';
    spectating = false;
    winnerId   = null;
    currState  = { tanks: data.tanks, bullets: [] };
    prevState  = null;
    stateTime  = performance.now();
    roundStartTime = performance.now();
    carryOnEndsAt = null;
    carryOnWinnerId = null;
    generateMazeColors();
    resizeCanvas();
    updateScoreboard(data.scores);
    updateStatus();
  });

  socket.on('state', (data) => {
    prevState = currState;
    currState = data;
    stateTime = performance.now();
  });

  socket.on('roundEnd', (data) => {
    phase    = 'roundEnd';
    winnerId = data.winnerId;
    updateScoreboard(data.scores);
    updateStatus();
  });

  socket.on('phaseChange', (data) => {
    phase = data.phase;
    updateStatus();
  });

  socket.on('playerJoined', () => {});   // state broadcast covers rendering
  socket.on('playerLeft',   () => {});
  socket.on('tankKilled',   () => {
    const intensity = config.shakeIntensity !== undefined ? config.shakeIntensity : 5;
    if (intensity > 0) {
      canvas.classList.remove('shake');
      void canvas.offsetWidth; // trigger reflow
      canvas.classList.add('shake');
    }
  });

  socket.on('carryOnStart', (data) => {
    carryOnEndsAt = data.endsAt;
    carryOnWinnerId = data.winnerId;
  });

  socket.on('colorUpdated', ({ id, color }) => {
    if (currState && currState.tanks[id]) currState.tanks[id].color = color;
    if (prevState && prevState.tanks[id]) prevState.tanks[id].color = color;
    if (id === myId) colorPicker.value = color;
  });

  socket.on('serverFull', () => {
    statusEl.textContent = 'Server is full (4 / 4 players)';
  });

  socket.on('disconnect', () => {
    statusEl.textContent = 'Disconnected — retrying…';
  });

  socket.on('connect', () => {
    if (myId) statusEl.textContent = 'Reconnected!';
  });

  socket.on('settingsUpdated', (newSettings) => {
    config = { ...config, ...newSettings };
    inpTankSpeed.value = newSettings.tankSpeed;
    inpTankTurn.value = newSettings.tankTurnRate;
    inpBulletSpeed.value = newSettings.bulletSpeed;
    inpMaxBullets.value = newSettings.maxBulletsPerPlayer;
    inpCarryOn.value = newSettings.postWinDelay;
    inpMazeRows.value = newSettings.mazeRows;
    inpMazeCols.value = newSettings.mazeCols;
    inpSymmetricMaze.checked = newSettings.symmetricMaze;
    inpWallRemoval.value = newSettings.wallRemoval;
    inpShake.value = newSettings.shakeIntensity;
  });

  /* ── Color Picker & Settings UI ────────────────────────── */
  
  colorPicker.addEventListener('change', (e) => {
    socket.emit('changeColor', e.target.value);
  });

  settingsBtn.addEventListener('click', () => {
    settingsModal.style.display = 'flex';
  });

  settingsCancel.addEventListener('click', () => {
    settingsModal.style.display = 'none';
  });

  settingsSave.addEventListener('click', () => {
    const s = {
      tankSpeed: parseFloat(inpTankSpeed.value) || 2.4,
      tankTurnRate: parseFloat(inpTankTurn.value) || 0.1,
      bulletSpeed: parseFloat(inpBulletSpeed.value) || 2.7,
      maxBulletsPerPlayer: parseInt(inpMaxBullets.value) || 10,
      postWinDelay: parseInt(inpCarryOn.value) || 4000,
      mazeRows: parseInt(inpMazeRows.value) || 0,
      mazeCols: parseInt(inpMazeCols.value) || 0,
      symmetricMaze: inpSymmetricMaze.checked,
      wallRemoval: parseFloat(inpWallRemoval.value) || 0.18,
      shakeIntensity: parseInt(inpShake.value) || 0
    };
    socket.emit('updateSettings', s);
    settingsModal.style.display = 'none';
  });

  /* ── Input handling ────────────────────────────────────── */

  const keys = { forward: false, backward: false, left: false, right: false, fire: false };

  function keyMap(code) {
    switch (code) {
      case 'ArrowUp':    case 'KeyW': return 'forward';
      case 'ArrowDown':  case 'KeyS': return 'backward';
      case 'ArrowLeft':  case 'KeyA': return 'left';
      case 'ArrowRight': case 'KeyD': return 'right';
      case 'Space':      case 'KeyQ': return 'fire';
      default: return null;
    }
  }

  document.addEventListener('keydown', (e) => {
    const k = keyMap(e.code);
    if (k && !e.repeat) {
      e.preventDefault();
      keys[k] = true;
      socket.emit('input', keys);
    }
  });

  document.addEventListener('keyup', (e) => {
    const k = keyMap(e.code);
    if (k) {
      e.preventDefault();
      keys[k] = false;
      socket.emit('input', keys);
    }
  });

  /* ── UI helpers ────────────────────────────────────────── */

  function generateMazeColors() {
    if (!maze) return;
    maze.bgColors = [];
    for (let r = 0; r < maze.rows; r++) {
      maze.bgColors[r] = [];
      for (let c = 0; c < maze.cols; c++) {
        maze.bgColors[r][c] = Math.random() > 0.5 ? '#D6D6D6' : '#E6E6E6';
      }
    }
  }

  function resizeCanvas() {
    if (!maze || !config.cellSize) return;
    canvas.width  = maze.cols * config.cellSize;
    canvas.height = maze.rows * config.cellSize;
  }

  function updateStatus() {
    if (phase === 'waiting') {
      statusEl.textContent = 'Waiting for at least 2 players…';
    } else if (phase === 'playing') {
      statusEl.textContent = spectating
        ? 'Spectating - you will join next round'
        : 'WASD / Arrows to move · Space to fire';
    } else if (phase === 'roundEnd') {
      statusEl.textContent = winnerId && currState && currState.tanks[winnerId]
        ? `${currState.tanks[winnerId].name} wins the round!`
        : 'Round over — Draw!';
    }
  }

  function updateScoreboard(scores) {
    if (!scores) return;
    scoreEl.innerHTML = '';
    for (const [, data] of Object.entries(scores)) {
      const el = document.createElement('div');
      el.className = 'score-item';
      el.innerHTML =
        `<span class="score-color" style="background:${data.color}"></span>${data.name}: ${data.score} (${data.kills || 0})`;
      scoreEl.appendChild(el);
    }
  }

  /* ── Interpolation ─────────────────────────────────────── */

  function lerpAngle(a, b, t) {
    let d = b - a;
    if (d > Math.PI)  d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    return a + d * t;
  }

  function getInterpolatedState() {
    if (!currState) return null;
    if (!prevState) return currState;

    const elapsed  = performance.now() - stateTime;
    const interval = 1000 / (config.broadcastRate || 20);
    const t = Math.min(elapsed / interval, 1.0);

    const tanks = {};
    for (const [id, tank] of Object.entries(currState.tanks)) {
      const prev = prevState.tanks ? prevState.tanks[id] : null;
      if (prev) {
        tanks[id] = {
          ...tank,
          x:     prev.x     + (tank.x     - prev.x)     * t,
          y:     prev.y     + (tank.y     - prev.y)     * t,
          angle: lerpAngle(prev.angle, tank.angle, t),
        };
      } else {
        tanks[id] = tank;
      }
    }

    return { tanks, bullets: currState.bullets };
  }

  /* ── Render loop (requestAnimationFrame) ────────────────── */

  function render() {
    requestAnimationFrame(render);

    const w = canvas.width;
    const h = canvas.height;

    // Clear
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    if (!maze || !currState) {
      Renderer.drawOverlay(ctx, w, h, ['TankTrouble LAN', 'Waiting for server…']);
      return;
    }

    // Maze background & walls
    Renderer.drawMazeBackground(ctx, maze, config);
    Renderer.drawMaze(ctx, maze.walls);

    // Update timer
    if (phase === 'playing') {
      const elapsed = Math.floor((performance.now() - roundStartTime) / 1000);
      const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
      const s = (elapsed % 60).toString().padStart(2, '0');
      timerEl.textContent = `${m}:${s}`;
    } else if (phase === 'waiting') {
      timerEl.textContent = '00:00';
    }

    // Interpolated state
    const state = getInterpolatedState();
    if (!state) return;

    // Bullets
    for (const b of state.bullets) {
      Renderer.drawBullet(ctx, b, config);
    }

    // Tanks
    for (const tank of Object.values(state.tanks)) {
      if (tank.alive) {
        Renderer.drawTank(ctx, tank, config, tank.id === myId);
      }
    }

    // Overlays
    if (carryOnEndsAt) {
      const timeLeft = carryOnEndsAt - Date.now();
      if (timeLeft > 0) {
        const winner = state.tanks[carryOnWinnerId];
        if (winner) {
          ctx.fillStyle = winner.color;
          ctx.globalAlpha = 0.2;
          ctx.fillRect(0, 0, w, h);
          ctx.globalAlpha = 1.0;
          
          const sec = Math.ceil(timeLeft / 1000);
          const ms = timeLeft % 1000;
          const alpha = ms / 1000;
          
          ctx.fillStyle = `rgba(0,0,0,${alpha})`;
          ctx.font = 'bold 120px "Segoe UI", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(sec, w / 2, h / 2 + 40);
        }
      }
    }

    if (phase === 'waiting') {
      Renderer.drawOverlay(ctx, w, h, ['Waiting for players…']);
    } else if (phase === 'roundEnd') {
      const winName = winnerId && state.tanks[winnerId]
        ? state.tanks[winnerId].name
        : null;
      Renderer.drawOverlay(ctx, w, h, [
        winName ? `${winName} wins!` : 'Draw!',
        'Next round starting…',
      ]);
    }
  }

  requestAnimationFrame(render);
})();
