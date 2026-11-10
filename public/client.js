/* global io, Renderer */

(function () {
  'use strict';

  /* ── DOM refs ──────────────────────────────────────────── */
  const canvas   = document.getElementById('canvas');
  const ctx      = canvas.getContext('2d');
  const scoreEl  = document.getElementById('scoreboard');
  const statusEl = document.getElementById('status');
  const timerEl  = document.getElementById('round-timer');
  const killLeaderboardEl = document.getElementById('kill-leaderboard');

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
  const inpPowerUpInterval = document.getElementById('set-powerup-interval');
  const nameInput = document.getElementById('name-input');
  const colorPicker = document.getElementById('color-picker');
  const inpFitScreen = document.getElementById('fit-screen');
  const inpPuShield = document.getElementById('set-pu-shield');
  const inpPuDoublegun = document.getElementById('set-pu-doublegun');
  const inpPuLaser = document.getElementById('set-pu-laser');
  const inpPuShotgun = document.getElementById('set-pu-shotgun');

  /* ── Client state ──────────────────────────────────────── */
  let myId      = null;
  let config    = {};
  let maze      = null;
  let phase     = 'waiting';
  let spectating = false;
  let winnerId  = null;
  let drawReason = null;
  let roundStartTime = 0;
  let carryOnEndsAt = null;
  let carryOnWinnerId = null;
  let carryOnTitleText = null;
  let powerUps  = [];     // active power-ups on the map

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
    if (data.tanks[myId]) {
      colorPicker.value = data.tanks[myId].color;
      if (nameInput) nameInput.value = data.tanks[myId].name;
    }
  });

  socket.on('newRound', (data) => {
    maze       = data.maze;
    phase      = 'playing';
    spectating = false;
    winnerId   = null;
    drawReason = null;
    currState  = { tanks: data.tanks, bullets: [] };
    prevState  = null;
    stateTime  = performance.now();
    roundStartTime = performance.now();
    carryOnEndsAt = null;
    carryOnWinnerId = null;
    carryOnTitleText = null;
    powerUps   = data.powerUps || [];
    generateMazeColors();
    resizeCanvas();
    updateScoreboard(data.scores);
    updateStatus();
  });

  socket.on('state', (data) => {
    prevState = currState;
    currState = data;
    stateTime = performance.now();
    // Sync power-ups from authoritative server state
    if (data.powerUps) powerUps = data.powerUps;
    if (data.globalStats) {
      const elScrapyard = document.getElementById('stat-scrapyard');
      const elBullets = document.getElementById('stat-bullets');
      if (elScrapyard) elScrapyard.textContent = data.globalStats.kills;
      if (elBullets) elBullets.textContent = data.globalStats.bullets;
    }
  });

  socket.on('roundEnd', (data) => {
    phase    = 'roundEnd';
    winnerId = data.winnerId;
    drawReason = data.drawReason || null;
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
    carryOnTitleText = data.titleText || null;
  });

  socket.on('colorUpdated', ({ id, color }) => {
    if (currState && currState.tanks[id]) currState.tanks[id].color = color;
    if (prevState && prevState.tanks[id]) prevState.tanks[id].color = color;
    if (id === myId && colorPicker) colorPicker.value = color;
  });

  socket.on('nameUpdated', ({ id, name }) => {
    if (currState && currState.tanks[id]) currState.tanks[id].name = name;
    if (prevState && prevState.tanks[id]) prevState.tanks[id].name = name;
    if (id === myId && nameInput) nameInput.value = name;
  });

  socket.on('scoresUpdated', (scores) => {
    updateScoreboard(scores);
  });

  socket.on('serverFull', () => {
    statusEl.textContent = 'Server is full (4 / 4 players)';
  });

  socket.on('disconnect', () => {
    statusEl.textContent = 'Disconnected — retrying…';
  });

  // ── Power-up events ──────────────────────────────────
  socket.on('powerUpSpawned', (pu) => {
    powerUps.push(pu);
  });

  socket.on('powerUpCollected', ({ powerUpId }) => {
    powerUps = powerUps.filter(p => p.id !== powerUpId);
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
    if (newSettings.powerUpSpawnInterval !== undefined) {
      inpPowerUpInterval.value = newSettings.powerUpSpawnInterval;
    }
    if (newSettings.enabledPowerUps) {
      inpPuShield.checked = newSettings.enabledPowerUps.includes('shield');
      inpPuDoublegun.checked = newSettings.enabledPowerUps.includes('doublegun');
      inpPuLaser.checked = newSettings.enabledPowerUps.includes('laser');
      inpPuShotgun.checked = newSettings.enabledPowerUps.includes('shotgun');
    }
  });

  /* ── Color Picker & Settings UI ────────────────────────── */
  
  colorPicker.addEventListener('change', (e) => {
    socket.emit('changeColor', e.target.value);
  });

  if (nameInput) {
    nameInput.addEventListener('change', (e) => {
      socket.emit('changeName', e.target.value);
    });
  }

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
      shakeIntensity: parseInt(inpShake.value) || 0,
      powerUpSpawnInterval: parseInt(inpPowerUpInterval.value) || 480,
      enabledPowerUps: [
        ...(inpPuShield.checked ? ['shield'] : []),
        ...(inpPuDoublegun.checked ? ['doublegun'] : []),
        ...(inpPuLaser.checked ? ['laser'] : []),
        ...(inpPuShotgun.checked ? ['shotgun'] : []),
      ],
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
    
    const baseW = maze.cols * config.cellSize;
    const baseH = maze.rows * config.cellSize;
    canvas.width  = baseW;
    canvas.height = baseH;
    
    if (inpFitScreen && inpFitScreen.checked) {
      // Fit to screen, accounting for headers/UI
      // UI height approximation: scoreboard + status + color picker approx 160px
      const availableW = window.innerWidth - 40;
      const availableH = window.innerHeight - 160;
      
      const scaleW = availableW / baseW;
      const scaleH = availableH / baseH;
      const scale = Math.max(0.1, Math.min(scaleW, scaleH));
      
      canvas.style.width = `${baseW * scale}px`;
      canvas.style.height = `${baseH * scale}px`;
    } else {
      canvas.style.width = '';
      canvas.style.height = '';
    }
  }

  window.addEventListener('resize', resizeCanvas);
  if (inpFitScreen) inpFitScreen.addEventListener('change', resizeCanvas);

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
    killLeaderboardEl.innerHTML = '<div style="font-weight: bold; margin-bottom: 2px;">Kills</div>';
    let hasKills = false;

    for (const [, data] of Object.entries(scores)) {
      const el = document.createElement('div');
      el.className = 'score-item';
      
      let killsHtml = '';
      if (data.killDetails && data.killDetails.length > 0) {
        killsHtml = '';
        for (const kill of data.killDetails) {
          killsHtml += `<span class="score-color" style="background:${kill.color}; display:inline-block; width:8px; height:8px; margin-left:4px; margin-right:2px; vertical-align:middle;"></span><span style="font-weight:normal; font-size:12px; margin-right:4px;">${kill.name} (${kill.count})</span>`;
        }
      } else if (data.kills > 0) {
        killsHtml = ` <span style="font-weight:normal; font-size:12px;">(${data.kills})</span>`;
      }

      el.innerHTML =
        `<span class="score-color" style="background:${data.color}"></span>${data.name}: ${data.score}`;
      scoreEl.appendChild(el);

      if (killsHtml !== '') {
        hasKills = true;
        const killEl = document.createElement('div');
        killEl.style.display = 'flex';
        killEl.style.alignItems = 'center';
        killEl.style.flexWrap = 'wrap';
        killEl.style.gap = '2px';
        killEl.innerHTML = `<span class="score-color" style="background:${data.color}; width:10px; height:10px;"></span><strong>${data.name}:</strong> ${killsHtml}`;
        killLeaderboardEl.appendChild(killEl);
      }
    }
    
    killLeaderboardEl.style.display = hasKills ? 'flex' : 'none';
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
    const interval = 1000 / (config.broadcastRate || 60);
    
    // Extrapolate up to 1.5x the interval if packets arrive late (prevents micro-stutters)
    const t = Math.min(elapsed / interval, 1.5);

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

  function shadeColor(color, percent) {
    if (!color || color[0] !== '#') return '#000000';
    let R = parseInt(color.substring(1,3), 16);
    let G = parseInt(color.substring(3,5), 16);
    let B = parseInt(color.substring(5,7), 16);

    R = parseInt(R * (100 + percent) / 100);
    G = parseInt(G * (100 + percent) / 100);
    B = parseInt(B * (100 + percent) / 100);

    R = Math.max(0, Math.min(255, R));
    G = Math.max(0, Math.min(255, G));
    B = Math.max(0, Math.min(255, B));

    let RR = R.toString(16).padStart(2, '0');
    let GG = G.toString(16).padStart(2, '0');
    let BB = B.toString(16).padStart(2, '0');

    return "#" + RR + GG + BB;
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

    // Power-ups on the map
    for (const pu of powerUps) {
      if (pu.alive) {
        Renderer.drawPowerUp(ctx, pu, config);
      }
    }

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

    // Tanks (alive, ghost, and shields)
    const tanks = state.tanks;
    for (const tank of Object.values(tanks)) {
      if (tank.alive || tank.ghost) {
        Renderer.drawTank(ctx, tank, config, tank.id === myId);
        Renderer.drawLaserSight(ctx, tank, config, maze, tanks);
        if (tank.shield && tank.shield.active) Renderer.drawShield(ctx, tank, config);
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

          if (carryOnTitleText) {
            ctx.fillStyle = shadeColor(winner.color, -40);
            ctx.font = 'bold 36px "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(carryOnTitleText, w / 2, h / 2 + 100);
          }
        }
      }
    }

    if (phase === 'waiting') {
      Renderer.drawOverlay(ctx, w, h, ['Waiting for players…']);
    } else if (phase === 'roundEnd') {
      const winName = winnerId && state.tanks[winnerId]
        ? state.tanks[winnerId].name
        : null;
      const line1 = winName ? `${winName} wins!` : (drawReason || 'Draw!');
      Renderer.drawOverlay(ctx, w, h, [
        line1,
        'Next round starting…',
      ]);
    }
  }

  requestAnimationFrame(render);
})();
