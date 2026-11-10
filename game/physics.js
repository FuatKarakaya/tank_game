const { MAX_BOUNCES, BULLET_LIFETIME_FRAMES } = require('./constants');

/**
 * Move a bullet for one frame, bouncing off walls via ray-segment intersection.
 * Mutates `bullet` in place.  Sets bullet.alive = false when bounces exhausted.
 */
function updateBullet(bullet, walls, tanks) {
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

    for (const edge of walls) {
      const hit = rayEdgeIntersect(x, y, dx, dy, edge);
      if (hit && hit.t > 0.0001 && hit.t < closestT) {
        closestT = hit.t;
        closest = hit;
      }
    }

    if (tanks) {
      const shieldR = (64 * 0.90) / 2; // C.CELL_SIZE * C.SHIELD_RADIUS_FRACTION / 2
      for (const [id, tank] of Object.entries(tanks)) {
        if (!tank.shield || !tank.shield.active || !tank.alive) continue;
        
        // Owner's bullets going outward shouldn't bounce off their own shield
        if (bullet.ownerId === id) {
          const dxC = x - tank.x;
          const dyC = y - tank.y;
          if (dxC * vx + dyC * vy > 0) continue; 
        }

        const hit = rayCircleIntersect(x, y, dx, dy, tank.x, tank.y, shieldR);
        if (hit && hit.t > 0.0001 && hit.t < closestT) {
          closestT = hit.t;
          closest = hit;
        }
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
      if (bullet.type === 'pellet') {
        const maxLife = bullet.lifetime || BULLET_LIFETIME_FRAMES;
        const framesLeft = maxLife - bullet.age;
        if (framesLeft > 0) {
          // Halve the remaining life on every bounce
          bullet.age += framesLeft / 2;
        }
      }
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

  // Age-based lifetime (default 10s, or per-bullet override for double gun)
  const maxLife = bullet.lifetime || BULLET_LIFETIME_FRAMES;
  if (bullet.age >= maxLife) {
    bullet.alive = false;
  }
}

function rayEdgeIntersect(ox, oy, dx, dy, edge) {
  // 1-sided check: if ray is moving in the same general direction as the normal, ignore
  if (dx * edge.nx + dy * edge.ny >= 0) return null;
  
  const sx = edge.x2 - edge.x1;
  const sy = edge.y2 - edge.y1;
  const denom = dx * sy - dy * sx;
  if (Math.abs(denom) < 1e-10) return null;
  
  const t = ((edge.x1 - ox) * sy - (edge.y1 - oy) * sx) / denom;
  if (t < 0 || t > 1) return null;
  
  const u = ((edge.x1 - ox) * dy - (edge.y1 - oy) * dx) / denom;
  if (u < 0 || u > 1) return null;
  
  return {
    t: t,
    px: ox + t * dx,
    py: oy + t * dy,
    nx: edge.nx,
    ny: edge.ny
  };
}

function getExpandedWallEdges(w, expansion) {
  const dx = w.x2 - w.x1;
  const dy = w.y2 - w.y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) return [];
  
  const dirX = dx / len;
  const dirY = dy / len;
  
  // Normal (pointing "left")
  const nx = -dirY;
  const ny = dirX;
  
  // 4 corners of the expanded rectangle
  const startX = w.x1 - dirX * expansion;
  const startY = w.y1 - dirY * expansion;
  const endX = w.x2 + dirX * expansion;
  const endY = w.y2 + dirY * expansion;
  
  const C1x = startX + nx * expansion, C1y = startY + ny * expansion;
  const C2x = endX + nx * expansion, C2y = endY + ny * expansion;
  const C3x = endX - nx * expansion, C3y = endY - ny * expansion;
  const C4x = startX - nx * expansion, C4y = startY - ny * expansion;
  
  return [
    { x1: C1x, y1: C1y, x2: C2x, y2: C2y, nx: nx, ny: ny },
    { x1: C2x, y1: C2y, x2: C3x, y2: C3y, nx: dirX, ny: dirY },
    { x1: C3x, y1: C3y, x2: C4x, y2: C4y, nx: -nx, ny: -ny },
    { x1: C4x, y1: C4y, x2: C1x, y2: C1y, nx: -dirX, ny: -dirY }
  ];
}

function rayCircleIntersect(ox, oy, dx, dy, cx, cy, r) {
  const fx = ox - cx;
  const fy = oy - cy;
  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = (fx * fx + fy * fy) - r * r;
  
  if (c <= 0) {
    // If it's already moving outwards, let it escape!
    if (fx * dx + fy * dy >= 0) return null;

    // Bullet is inside and moving inwards. Bounce it instantly.
    let len = Math.hypot(fx, fy);
    let nx = len > 0 ? fx / len : 1;
    let ny = len > 0 ? fy / len : 0;
    
    // Return t=0.0002 to bypass the t>0.0001 filter in updateBullet loop!
    return { t: 0.0002, px: ox, py: oy, nx, ny };
  }

  let discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  discriminant = Math.sqrt(discriminant);
  const t1 = (-b - discriminant) / (2 * a);
  if (t1 >= 0 && t1 <= 1) {
    const px = ox + t1 * dx;
    const py = oy + t1 * dy;
    let nx = (px - cx) / r;
    let ny = (py - cy) / r;
    if (nx * dx + ny * dy > 0) { nx = -nx; ny = -ny; }
    return { t: t1, px, py, nx, ny };
  }
  return null;
}

module.exports = { updateBullet, rayEdgeIntersect, rayCircleIntersect, getExpandedWallEdges };
