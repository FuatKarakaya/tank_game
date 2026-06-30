const { MAX_BOUNCES, BULLET_LIFETIME_FRAMES } = require('./constants');

/**
 * Move a bullet for one frame, bouncing off walls via ray-segment intersection.
 * Mutates `bullet` in place.  Sets bullet.alive = false when bounces exhausted.
 */
function updateBullet(bullet, walls) {
  if (!bullet.alive) return;

  let remaining = 1.0;   // fraction of this frame's movement still to go
  let { x, y, vx, vy } = bullet;
  let safetyIter = 0;

  while (remaining > 0.001 && safetyIter < 10) {
    safetyIter++;
    const dx = vx * remaining;
    const dy = vy * remaining;

    // Find the nearest wall intersection along the ray (x,y) → (x+dx, y+dy)
    let closest = null;
    let closestT = Infinity;

    for (const w of walls) {
      const hit = raySegmentIntersect(x, y, dx, dy, w.x1, w.y1, w.x2, w.y2);
      if (hit && hit.t > 0.0001 && hit.t < closestT) {
        closestT = hit.t;
        closest = hit;
      }
    }

    if (closest && closestT <= 1.0) {
      // Advance to the hit point
      x = closest.px;
      y = closest.py;

      // Reflect velocity
      const dot = vx * closest.nx + vy * closest.ny;
      vx -= 2 * dot * closest.nx;
      vy -= 2 * dot * closest.ny;

      remaining *= (1 - closestT);
      bullet.bounces++;
    } else {
      // No wall hit — travel the full remaining distance
      x += dx;
      y += dy;
      remaining = 0;
    }
  }

  bullet.x = x;
  bullet.y = y;
  bullet.vx = vx;
  bullet.vy = vy;
  bullet.age++;

  // Age-based lifetime (10 seconds)
  if (bullet.age >= BULLET_LIFETIME_FRAMES) {
    bullet.alive = false;
  }
}

/**
 * Standard ray-vs-line-segment intersection.
 *
 * Ray:     P = (ox, oy) + t * (dx, dy)   for t ∈ [0, 1]
 * Segment: Q = (x1, y1) + u * (sx, sy)   for u ∈ [0, 1]
 *
 * Returns { t, px, py, nx, ny } or null.
 * nx,ny is the outward-facing normal (facing the ray origin).
 */
function raySegmentIntersect(ox, oy, dx, dy, x1, y1, x2, y2) {
  const sx = x2 - x1;
  const sy = y2 - y1;

  const denom = dx * sy - dy * sx;
  if (Math.abs(denom) < 1e-10) return null;   // parallel / coincident

  const t = ((x1 - ox) * sy - (y1 - oy) * sx) / denom;
  const u = ((x1 - ox) * dy - (y1 - oy) * dx) / denom;

  if (t < 0 || t > 1 || u < 0 || u > 1) return null;

  // Compute hit point
  const px = ox + t * dx;
  const py = oy + t * dy;

  // Outward normal of the segment (perpendicular), facing the ray origin
  let nx = -sy;
  let ny = sx;
  const len = Math.sqrt(nx * nx + ny * ny);
  if (len === 0) return null;
  nx /= len;
  ny /= len;

  // Make sure normal points toward the ray origin (i.e. against the ray)
  if (nx * dx + ny * dy > 0) {
    nx = -nx;
    ny = -ny;
  }

  return { t, px, py, nx, ny };
}

module.exports = { updateBullet, raySegmentIntersect };
