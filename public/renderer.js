/**
 * Canvas drawing helpers.
 * Exposed as a global `Renderer` object (no bundler, no modules).
 */
const tankSkin = new Image();
tankSkin.src = 'skin.png';

function rayEdgeIntersect(ox, oy, dx, dy, edge) {
  if (dx * edge.nx + dy * edge.ny >= 0) return null;
  const sx = edge.x2 - edge.x1;
  const sy = edge.y2 - edge.y1;
  const denom = dx * sy - dy * sx;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((edge.x1 - ox) * sy - (edge.y1 - oy) * sx) / denom;
  if (t < 0 || t > 1) return null;
  const u = ((edge.x1 - ox) * dy - (edge.y1 - oy) * dx) / denom;
  if (u < 0 || u > 1) return null;
  return { t, px: ox + t * dx, py: oy + t * dy, nx: edge.nx, ny: edge.ny };
}

function getExpandedWallEdges(w, expansion) {
  const dx = w.x2 - w.x1;
  const dy = w.y2 - w.y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) return [];
  const dirX = dx / len;
  const dirY = dy / len;
  const nx = -dirY;
  const ny = dirX;
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
  let discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  discriminant = Math.sqrt(discriminant);
  const t1 = (-b - discriminant) / (2 * a);
  const t2 = (-b + discriminant) / (2 * a);
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

function getOBBEdges(cx, cy, w, h, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const hw = w / 2;
  const hh = h / 2;
  const c1x = cx + hw * cos - hh * sin, c1y = cy + hw * sin + hh * cos;
  const c2x = cx - hw * cos - hh * sin, c2y = cy - hw * sin + hh * cos;
  const c3x = cx - hw * cos + hh * sin, c3y = cy - hw * sin - hh * cos;
  const c4x = cx + hw * cos + hh * sin, c4y = cy + hw * sin - hh * cos;
  return [
    [c1x, c1y, c2x, c2y],
    [c2x, c2y, c3x, c3y],
    [c3x, c3y, c4x, c4y],
    [c4x, c4y, c1x, c1y]
  ];
}

// eslint-disable-next-line no-unused-vars
const Renderer = {

  /** Draw checkered maze background */
  drawMazeBackground(ctx, maze, cfg) {
    if (!maze.bgColors) return;
    for (let r = 0; r < maze.rows; r++) {
      for (let c = 0; c < maze.cols; c++) {
        ctx.fillStyle = maze.bgColors[r][c];
        ctx.fillRect(c * cfg.cellSize, r * cfg.cellSize, cfg.cellSize, cfg.cellSize);
      }
    }
  },

  /** Draw every wall segment */
  drawMaze(ctx, walls) {
    ctx.save();
    ctx.strokeStyle = '#666666';
    ctx.lineWidth = 6;
    ctx.lineCap = 'butt';
    for (const w of walls) {
      ctx.beginPath();
      ctx.moveTo(w.x1, w.y1);
      ctx.lineTo(w.x2, w.y2);
      ctx.stroke();
    }
    ctx.restore();
  },

  /** Draw a single tank (rotated rectangle + barrel), with ghost and doubleGun support */
  drawTank(ctx, tank, cfg, isMe) {
    const hw = cfg.tankWidth / 2;
    const hl = cfg.tankLength / 2;

    ctx.save();

    // Ghost tanks render at 0.2 opacity
    if (tank.ghost) {
      ctx.globalAlpha = 0.2;
    }

    ctx.translate(tank.x, tank.y);
    ctx.rotate(tank.angle);

    // Body
    ctx.fillStyle = tank.color;
    ctx.fillRect(-hl, -hw, cfg.tankLength, cfg.tankWidth);

    // Barrel(s)
    ctx.fillStyle = tank.color;
    if (tank.doubleGun && tank.doubleGun.active) {
      // Double barrels — two barrels offset from center
      const barrelOffset = cfg.doubleGunBarrelOffset || 5;
      const bLen = cfg.barrelLength || 9;
      const bWid = cfg.barrelWidth || 6;
      ctx.fillRect(hl - 2, -barrelOffset - bWid / 2, bLen, bWid);
      ctx.fillRect(hl - 2, barrelOffset - bWid / 2, bLen, bWid);
    } else if (tank.laser && tank.laser.active) {
      // Semicircle cut half looking outward
      ctx.beginPath();
      ctx.arc(hl - 2, 0, 6, -Math.PI / 2, Math.PI / 2);
      ctx.fill();
    } else if (tank.shotgun && tank.shotgun.active) {
      // Barrel twice as thick
      ctx.fillRect(hl - 2, -6, 9, 12);
    } else {
      // Single barrel (original)
      ctx.fillRect(hl - 2, -3, 9, 6);
    }

    // Overlay Skin
    if (tankSkin.complete && tankSkin.naturalWidth > 0) {
      ctx.save();
      // Move 4px towards the barrel (along local X-axis)
      ctx.translate(3, 0);
      // Rotate by 90 degrees assuming the 43x63 image faces UP
      ctx.rotate(Math.PI / 2);
      // 43x63
      ctx.drawImage(tankSkin, -26 / 2, -40 / 2, 26, 40);
      ctx.restore();
    }

    ctx.restore();
  },

  /** Draw a bullet */
  drawBullet(ctx, bullet, cfg) {
    ctx.save();
    
    // Fade out (ghost) during the last 6 frames (100ms at 60fps)
    const framesLeft = bullet.lifetime - bullet.age;
    if (framesLeft <= 6 && framesLeft >= 0) {
      ctx.globalAlpha = Math.max(0, framesLeft / 6);
    }

    if (bullet.type === 'laser') {
      ctx.fillStyle = bullet.color || '#000000';
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, cfg.bulletRadius, 0, Math.PI * 2);
      ctx.fill();
    } else if (bullet.type === 'pellet') {
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, 1, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, cfg.bulletRadius, 0, Math.PI * 2);
      ctx.fill();
    }
    
    ctx.restore();
  },

  /**
   * Draw a power-up on the map.
   * A rotated #828485 square with a logo drawn in wall color (#666666).
   */
  drawPowerUp(ctx, pu, cfg) {
    const size = cfg.powerUpSize || 24;
    const half = size / 2;

    ctx.save();
    ctx.translate(pu.x, pu.y);
    ctx.rotate(pu.rotation);

    // Square background
    ctx.fillStyle = '#828485';
    ctx.fillRect(-half, -half, size, size);

    // Logo (same color as walls)
    ctx.fillStyle = '#666666';
    ctx.strokeStyle = '#666666';

    if (pu.type === 'shield') {
      // Shield logo: a circle
      ctx.beginPath();
      ctx.arc(0, 0, half * 0.55, 0, Math.PI * 2);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (pu.type === 'doublegun') {
      // Double gun logo: two dots
      const dotR = half * 0.22;
      ctx.beginPath();
      ctx.arc(-half * 0.3, 0, dotR, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(half * 0.3, 0, dotR, 0, Math.PI * 2);
      ctx.fill();
    } else if (pu.type === 'laser') {
      // 3 part zigzag
      ctx.beginPath();
      ctx.moveTo(-half * 0.4, -half * 0.4);
      ctx.lineTo(half * 0.1, -half * 0.1);
      ctx.lineTo(-half * 0.1, half * 0.1);
      ctx.lineTo(half * 0.4, half * 0.4);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (pu.type === 'shotgun') {
      // 6 points in a rectangular grid (3 rows, 2 columns, like a domino 6)
      const pR = 1.5;
      ctx.fillStyle = '#666666';
      
      const xOffset = half * 0.3;
      const yOffset = half * 0.4;
      
      const positions = [
        [-xOffset, -yOffset], [xOffset, -yOffset],
        [-xOffset, 0],        [xOffset, 0],
        [-xOffset, yOffset],  [xOffset, yOffset]
      ];
      
      for (const [px, py] of positions) {
        ctx.beginPath();
        ctx.arc(px, py, pR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  },

  /**
   * Draw the shield effect around a tank.
   * - Outer ring: #4dffff at high opacity
   * - 4px gradient fading inward to transparent
   * - Transparent inside
   * - Flickering after 5 seconds (0.8 ↔ 0.3 every 200ms)
   */
  drawShield(ctx, tank, cfg) {
    if (!tank.shield || !tank.shield.active) return;

    const radius = (cfg.cellSize * (cfg.shieldRadiusFraction || 0.9)) / 2;
    const age = tank.shield.age;
    const flickerStart = cfg.shieldFlickerStartFrames || 300;
    const totalDuration = cfg.shieldDurationFrames || 420;
    const flickerPeriod = cfg.shieldFlickerPeriodMs || 400;

    // Determine opacity
    let baseOpacity = 0.8;
    if (age >= flickerStart) {
      // Flickering phase: 0.8 and 0.3 alternating every half-period
      const elapsed = (age - flickerStart) * (1000 / 60); // convert frames to ms
      const phase = Math.floor(elapsed / (flickerPeriod / 2)) % 2;
      baseOpacity = phase === 0 ? 0.8 : 0.3;
    }

    ctx.save();
    ctx.translate(tank.x, tank.y);

    // Outer ring (2px thick stroke at full opacity)
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.strokeStyle = cfg.shieldColor || '#4dffff';
    ctx.lineWidth = 2;
    ctx.globalAlpha = baseOpacity;
    ctx.stroke();

    // Inward gradient band (4px, fading from baseOpacity to 0)
    const gradientSteps = 4;
    for (let i = 0; i < gradientSteps; i++) {
      const r = radius - 2 - i;
      const stepOpacity = baseOpacity * (1 - (i + 1) / gradientSteps);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.strokeStyle = cfg.shieldColor || '#4dffff';
      ctx.lineWidth = 1;
      ctx.globalAlpha = stepOpacity;
      ctx.stroke();
    }

    ctx.restore();
  },

  /** Draw a centred text overlay (for round-end / waiting) */
  drawOverlay(ctx, w, h, lines) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#222222';
    ctx.textAlign = 'center';

    const startY = h / 2 - ((lines.length - 1) * 20);
    lines.forEach((line, i) => {
      ctx.font = i === 0 ? 'bold 28px "Segoe UI", sans-serif'
                         : '16px "Segoe UI", sans-serif';
      ctx.fillText(line, w / 2, startY + i * 36);
    });
  },

  /** Draw dashed aiming line for Laser powerup */
  drawLaserSight(ctx, tank, cfg, maze, tanks) {
    if (!tank.laser || !tank.laser.active) return;
    
    const barrelOffsetX = cfg.tankLength / 2 + 2;
    let x = tank.x + Math.cos(tank.angle) * barrelOffsetX;
    let y = tank.y + Math.sin(tank.angle) * barrelOffsetX;
    let vx = Math.cos(tank.angle);
    let vy = Math.sin(tank.angle);
    
    let remaining = cfg.laserAimLength || 384;
    const shieldR = (cfg.cellSize * (cfg.shieldRadiusFraction || 0.9)) / 2;
    
    ctx.save();
    ctx.strokeStyle = tank.color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(x, y);
    
    let safety = 0;
    while (remaining > 0 && safety < 20) {
      safety++;
      let closest = null;
      let closestT = Infinity;
      
      const dx = vx * remaining;
      const dy = vy * remaining;
      
      // Wall intersection
      for (const w of maze.walls) {
        // Laser has no radius, but wall half-thickness is 3
        const edges = getExpandedWallEdges(w, 3);
        for (const edge of edges) {
          const hit = rayEdgeIntersect(x, y, dx, dy, edge);
          if (hit && hit.t > 0.0001 && hit.t < closestT) {
            closestT = hit.t;
            closest = hit;
          }
        }
      }

      // Tank and Shield intersection
      for (const [id, other] of Object.entries(tanks)) {
        if (!other.alive || (id === tank.id && safety === 1)) continue;
        
        // Shield check
        if (other.shield && other.shield.active) {
          const hit = rayCircleIntersect(x, y, dx, dy, other.x, other.y, shieldR);
          if (hit && hit.t > 0.0001 && hit.t < closestT) {
            closestT = hit.t;
            closest = hit;
          }
        }
        
        // Tank hull check (stops the laser, no bounce)
        if (!other.ghost) {
          const edges = getOBBEdges(other.x, other.y, cfg.tankLength, cfg.tankWidth, other.angle);
          for (const edge of edges) {
            const edgeData = { x1: edge[0], y1: edge[1], x2: edge[2], y2: edge[3] };
            // Compute normal for the edge
            const ex = edge[2] - edge[0];
            const ey = edge[3] - edge[1];
            const elen = Math.hypot(ex, ey);
            edgeData.nx = -ey / elen;
            edgeData.ny = ex / elen;
            
            const hit = rayEdgeIntersect(x, y, dx, dy, edgeData);
            if (hit && hit.t > 0.0001 && hit.t < closestT) {
              closestT = hit.t;
              closest = hit;
              closest.isTank = true;
            }
          }
        }
      }
      
      if (closest && closestT <= 1.0) {
        x = closest.px;
        y = closest.py;
        ctx.lineTo(x, y);
        
        if (closest.isTank) {
          // Stop here if it hits a tank
          remaining = 0;
        } else {
          // Bounce off wall/shield
          const dot = vx * closest.nx + vy * closest.ny;
          vx -= 2 * dot * closest.nx;
          vy -= 2 * dot * closest.ny;
          remaining *= (1 - closestT);
        }
      } else {
        ctx.lineTo(x + dx, y + dy);
        remaining = 0;
      }
    }
    ctx.stroke();
    ctx.restore();
  },
};
