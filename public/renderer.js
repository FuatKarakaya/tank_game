/**
 * Canvas drawing helpers.
 * Exposed as a global `Renderer` object (no bundler, no modules).
 */
const tankSkin = new Image();
tankSkin.src = 'skin.png';

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

  /** Draw a single tank (rotated rectangle + barrel) */
  drawTank(ctx, tank, cfg, isMe) {
    const hw = cfg.tankWidth / 2;
    const hl = cfg.tankLength / 2;

    ctx.save();
    ctx.translate(tank.x, tank.y);
    ctx.rotate(tank.angle);

    // Body
    ctx.fillStyle = tank.color;
    ctx.fillRect(-hl, -hw, cfg.tankLength, cfg.tankWidth);

    // Barrel
    ctx.fillStyle = tank.color;
    // To make it LONGER: Increase the 3rd value (currently 10).
    // To make it THICKER: Increase the 4th value (currently 6).
    // If you make it thicker, you should also adjust the 2nd value (Y-offset) to keep it centered. 
    // It should be `-thickness / 2`. So for a thickness of 8, use -4.
    ctx.fillRect(hl - 2, -3, 9, 6);

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
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, cfg.bulletRadius, 0, Math.PI * 2);
    ctx.fill();
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
};
