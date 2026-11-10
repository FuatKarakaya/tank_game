const C = require('./constants');

/**
 * Check if a bullet hits a tank using point-in-rotated-rectangle test.
 * The tank hitbox is the full body rectangle (TANK_LENGTH × TANK_WIDTH)
 * plus the barrel rectangle.
 * 
 * Skips the check during the grace period (bullet can't hit its owner
 * for the first N frames after firing).
 */
function checkBulletTankHit(bullet, tank) {
  if (bullet.type === 'laser') {
    return checkLaserTankHit(bullet, tank);
  }
  if (!tank.alive || !bullet.alive) return false;
  if (tank.ghost) return false;  // ghost tanks can't be hit
  if (tank.shield && tank.shield.active) return false; // shield protects from all bullets

  // A bullet can never hit its owner until it has bounced.
  if (bullet.ownerId === tank.id) {
    if (bullet.bounces === 0) return false;
    
    // If a young bullet is moving AWAY from the tank, let it escape.
    // This prevents self-kills on angled close shots, but allows point-blank kills.
    if (bullet.age < C.BULLET_GRACE_FRAMES) {
      const dx = bullet.x - tank.x;
      const dy = bullet.y - tank.y;
      if (dx * bullet.vx + dy * bullet.vy > 0) return false;
    }
  }

  // Check against the hull rectangle
  if (pointInRotatedRect(
    bullet.x, bullet.y,
    tank.x, tank.y, tank.angle,
    C.TANK_LENGTH, C.TANK_WIDTH
  )) {
    return true;
  }

  // Check against the barrel rectangle
  // Barrel center is offset from tank center along facing direction
  const barrelOffsetX = C.TANK_LENGTH / 2 + C.BARREL_LENGTH / 2 - 2;
  const barrelCX = tank.x + Math.cos(tank.angle) * barrelOffsetX;
  const barrelCY = tank.y + Math.sin(tank.angle) * barrelOffsetX;

  if (pointInRotatedRect(
    bullet.x, bullet.y,
    barrelCX, barrelCY, tank.angle,
    C.BARREL_LENGTH, C.BARREL_WIDTH
  )) {
    return true;
  }

  return false;
}

/**
 * Test if point (px,py) is inside a rectangle centered at (cx,cy)
 * rotated by `angle`, with dimensions width × height.
 * 
 * Transform the point into the rectangle's local coordinate system
 * then check if it's within ±halfWidth and ±halfHeight.
 */
function pointInRotatedRect(px, py, cx, cy, angle, width, height) {
  // Translate point to rectangle's local origin
  const dx = px - cx;
  const dy = py - cy;

  // Rotate point by -angle to align with rectangle axes
  const cosA = Math.cos(-angle);
  const sinA = Math.sin(-angle);
  const localX = dx * cosA - dy * sinA;
  const localY = dx * sinA + dy * cosA;

  // Check bounds
  const hw = width / 2;
  const hh = height / 2;
  return Math.abs(localX) <= hw && Math.abs(localY) <= hh;
}

function checkLaserTankHit(bullet, tank) {
  if (!tank.alive || !bullet.alive || tank.ghost) return false;
  if (tank.shield && tank.shield.active) return false;
  if (bullet.ownerId === tank.id && bullet.bounces === 0) return false;

  const tailX = bullet.x - bullet.vx;
  const tailY = bullet.y - bullet.vy;

  if (segmentIntersectsRotatedRect(tailX, tailY, bullet.x, bullet.y, tank.x, tank.y, tank.angle, C.TANK_LENGTH, C.TANK_WIDTH)) return true;
  
  const barrelOffsetX = C.TANK_LENGTH / 2 + C.BARREL_LENGTH / 2 - 2;
  const barrelCX = tank.x + Math.cos(tank.angle) * barrelOffsetX;
  const barrelCY = tank.y + Math.sin(tank.angle) * barrelOffsetX;
  if (segmentIntersectsRotatedRect(tailX, tailY, bullet.x, bullet.y, barrelCX, barrelCY, tank.angle, C.BARREL_LENGTH, C.BARREL_WIDTH)) return true;

  return false;
}

function segmentIntersectsRotatedRect(x1, y1, x2, y2, cx, cy, angle, width, height) {
  const dx1 = x1 - cx;
  const dy1 = y1 - cy;
  const dx2 = x2 - cx;
  const dy2 = y2 - cy;

  const cosA = Math.cos(-angle);
  const sinA = Math.sin(-angle);

  const lx1 = dx1 * cosA - dy1 * sinA;
  const ly1 = dx1 * sinA + dy1 * cosA;
  const lx2 = dx2 * cosA - dy2 * sinA;
  const ly2 = dx2 * sinA + dy2 * cosA;

  const hw = width / 2;
  const hh = height / 2;

  if (Math.abs(lx1) <= hw && Math.abs(ly1) <= hh) return true;
  if (Math.abs(lx2) <= hw && Math.abs(ly2) <= hh) return true;

  if (lx1 < -hw && lx2 < -hw) return false;
  if (lx1 > hw && lx2 > hw) return false;
  if (ly1 < -hh && ly2 < -hh) return false;
  if (ly1 > hh && ly2 > hh) return false;

  const A = ly2 - ly1;
  const B = lx1 - lx2;
  const C_eq = lx2 * ly1 - lx1 * ly2;

  const v1 = A * (-hw) + B * (-hh) + C_eq;
  const v2 = A * (hw) + B * (-hh) + C_eq;
  const v3 = A * (hw) + B * (hh) + C_eq;
  const v4 = A * (-hw) + B * (hh) + C_eq;

  if ((v1 > 0 && v2 > 0 && v3 > 0 && v4 > 0) || (v1 < 0 && v2 < 0 && v3 < 0 && v4 < 0)) {
    return false;
  }
  
  return true;
}

module.exports = { checkBulletTankHit, pointInRotatedRect };
