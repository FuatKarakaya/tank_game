const C = require('./constants');
const { pointInRotatedRect } = require('./collision');

/**
 * Power-up manager — handles spawning, pickup detection, and effect ticking.
 */

const POWERUP_TYPES = [C.POWERUP_SHIELD, C.POWERUP_DOUBLEGUN, C.POWERUP_LASER, C.POWERUP_SHOTGUN];

let nextPowerUpId = 0;

/**
 * Spawn a power-up at a random empty cell in the maze.
 * Returns the new power-up object or null if no valid cell found.
 */
function spawnPowerUp(maze, tanks, existingPowerUps, enabledTypes) {
  // Filter to only enabled types
  const types = POWERUP_TYPES.filter(t => enabledTypes.includes(t));
  if (types.length === 0) return null;

  const rows = maze.rows;
  const cols = maze.cols;
  const S = C.CELL_SIZE;

  // Build set of occupied cells (tanks + existing power-ups)
  const occupied = new Set();
  for (const t of Object.values(tanks)) {
    if (t.alive || t.ghost) {
      const cr = Math.floor(t.y / S);
      const cc = Math.floor(t.x / S);
      occupied.add(`${cr},${cc}`);
    }
  }
  for (const p of existingPowerUps) {
    const cr = Math.floor(p.y / S);
    const cc = Math.floor(p.x / S);
    occupied.add(`${cr},${cc}`);
  }

  // Collect free cells
  const freeCells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!occupied.has(`${r},${c}`)) {
        freeCells.push({ r, c });
      }
    }
  }

  if (freeCells.length === 0) return null;

  const cell = freeCells[Math.floor(Math.random() * freeCells.length)];
  const type = types[Math.floor(Math.random() * types.length)];

  return {
    id: nextPowerUpId++,
    type,
    x: cell.c * S + S / 2,
    y: cell.r * S + S / 2,
    rotation: Math.random() * Math.PI * 2, // random rotation
    alive: true,
  };
}

/**
 * Check if any alive tank is close enough to pick up a power-up.
 * Returns { tankId, powerUp } or null.
 */
function checkPowerUpPickup(tanks, powerUps) {
  const results = [];
  const puSize = C.POWERUP_SIZE || 24;

  for (const pu of powerUps) {
    if (!pu.alive) continue;
    for (const [id, tank] of Object.entries(tanks)) {
      if (!tank.alive || tank.ghost) continue;
      
      if ((tank.shield && tank.shield.active) || 
          (tank.doubleGun && tank.doubleGun.active) || 
          (tank.laser && tank.laser.active) || 
          (tank.shotgun && tank.shotgun.active)) {
        continue;
      }
      
      // OBB intersection check: check if any corner of PU is in Tank, or vice-versa
      if (rectsIntersect(pu.x, pu.y, puSize, puSize, pu.rotation, tank.x, tank.y, C.TANK_LENGTH, C.TANK_WIDTH, tank.angle)) {
        pu.alive = false;
        results.push({ tankId: id, powerUp: pu });
        break; // one tank per power-up
      }
    }
  }
  return results;
}

function rectsIntersect(c1x, c1y, w1, h1, a1, c2x, c2y, w2, h2, a2) {
  const dx = c1x - c2x;
  const dy = c1y - c2y;
  const dist = Math.sqrt(dx*dx + dy*dy);
  if (dist > (w1 + h1 + w2 + h2)/2) return false;

  const getCorners = (cx, cy, w, h, a) => [
    { dx: w/2, dy: h/2 }, { dx: -w/2, dy: h/2 },
    { dx: -w/2, dy: -h/2 }, { dx: w/2, dy: -h/2 }
  ].map(p => ({
    x: cx + p.dx * Math.cos(a) - p.dy * Math.sin(a),
    y: cy + p.dx * Math.sin(a) + p.dy * Math.cos(a)
  }));
  
  for (const p of getCorners(c1x, c1y, w1, h1, a1)) {
    if (pointInRotatedRect(p.x, p.y, c2x, c2y, a2, w2, h2)) return true;
  }
  for (const p of getCorners(c2x, c2y, w2, h2, a2)) {
    if (pointInRotatedRect(p.x, p.y, c1x, c1y, a1, w1, h1)) return true;
  }
  if (pointInRotatedRect(c1x, c1y, c2x, c2y, a2, w2, h2)) return true;
  if (pointInRotatedRect(c2x, c2y, c1x, c1y, a1, w1, h1)) return true;
  
  return false;
}

function applyPowerUp(tank, powerUp) {
  if (powerUp.type === C.POWERUP_SHIELD) {
    tank.shield = {
      active: true,
      age: 0,
      startTime: Date.now(),
    };
  } else if (powerUp.type === C.POWERUP_DOUBLEGUN) {
    tank.doubleGun = {
      active: true,
      shotsLeft: C.DOUBLEGUN_TOTAL_SHOTS,
      nextBarrel: 0,
    };
  } else if (powerUp.type === C.POWERUP_LASER) {
    tank.laser = {
      active: true,
      shotsLeft: 1, // Only 1 laser shot
    };
  } else if (powerUp.type === C.POWERUP_SHOTGUN) {
    tank.shotgun = {
      active: true,
      shotsLeft: C.SHOTGUN_SHOTS,
    };
  }
}

/**
 * Tick power-up effects on all tanks. Called once per server tick.
 */
function tickPowerUpEffects(tanks) {
  for (const tank of Object.values(tanks)) {
    if (!tank.alive && !tank.ghost) continue;

    // Shield
    if (tank.shield && tank.shield.active) {
      tank.shield.age++;
      if (tank.shield.age >= C.SHIELD_DURATION_FRAMES) {
        tank.shield.active = false;
        tank.shield = null;
      }
    }

    // Double gun — expires when shots run out (already handled on fire)
    if (tank.doubleGun && tank.doubleGun.active && tank.doubleGun.shotsLeft <= 0) {
      tank.doubleGun.active = false;
      tank.doubleGun = null;
    }
  }
}

/**
 * Check if a bullet is blocked by any tank's shield.
 * Returns true if the bullet should be destroyed.
 * The shield blocks all bullets EXCEPT those fired outward by the shield's owner.
 */
function checkBulletShield(bullet, tanks) {
  const shieldR = (C.CELL_SIZE * C.SHIELD_RADIUS_FRACTION) / 2;
  const shieldRSq = shieldR * shieldR;

  for (const [id, tank] of Object.entries(tanks)) {
    if (!tank.shield || !tank.shield.active) continue;
    if (!tank.alive) continue;

    // Owner's bullets going outward pass through
    if (bullet.ownerId === id) continue;

    // Check if bullet is within shield radius
    const dx = bullet.x - tank.x;
    const dy = bullet.y - tank.y;
    const distSq = dx * dx + dy * dy;

    if (distSq < shieldRSq) {
      return true; // bullet is blocked
    }
  }
  return false;
}

/**
 * Reset the powerup ID counter (for new rounds).
 */
function resetPowerUpIds() {
  nextPowerUpId = 0;
}

module.exports = {
  POWERUP_TYPES,
  spawnPowerUp,
  checkPowerUpPickup,
  applyPowerUp,
  tickPowerUpEffects,
  checkBulletShield,
  resetPowerUpIds,
};
