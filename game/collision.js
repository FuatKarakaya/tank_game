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
  if (!tank.alive || !bullet.alive) return false;

  // Grace period — don't let your own bullet kill you right after firing
  if (bullet.ownerId === tank.id && bullet.age < C.BULLET_GRACE_FRAMES) return false;

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

module.exports = { checkBulletTankHit };
