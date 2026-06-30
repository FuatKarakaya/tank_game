const { CELL_SIZE, WALL_REMOVAL_FRACTION } = require('./constants');

/**
 * Generate a random maze using the Recursive Backtracker algorithm.
 * Returns { walls: [{x1,y1,x2,y2}], rows, cols }.
 */
function generateMaze(cols, rows, wallRemoval = WALL_REMOVAL_FRACTION, symmetric = false) {
  // Initialise grid — every cell starts with all four walls
  const grid = [];
  for (let r = 0; r < rows; r++) {
    grid[r] = [];
    for (let c = 0; c < cols; c++) {
      grid[r][c] = { top: true, right: true, bottom: true, left: true, visited: false };
    }
  }

  let genRows = rows;
  let genCols = cols;
  if (symmetric) {
    genRows = rows / 2;
    genCols = cols / 2;
  }

  // Iterative DFS (avoids call-stack limits on large grids)
  const stack = [{ r: 0, c: 0 }];
  grid[0][0].visited = true;

  while (stack.length > 0) {
    const cur = stack[stack.length - 1];
    const neighbours = unvisitedNeighbours(grid, cur.r, cur.c, genRows, genCols);

    if (neighbours.length === 0) {
      stack.pop();
    } else {
      const next = neighbours[Math.floor(Math.random() * neighbours.length)];
      removeWallBetween(grid, cur.r, cur.c, next.r, next.c);
      grid[next.r][next.c].visited = true;
      stack.push(next);
    }
  }

  if (symmetric) {
    // Knock out some walls in the top-left quadrant first
    removeRandomWalls(grid, genRows, genCols, wallRemoval);
    // Apply rotational symmetry to the rest of the grid
    applySymmetry(grid, genRows);
    
    // Connect the 4 quadrants in the center
    const h = genRows; // h = half size
    grid[h-1][h-1].right = false;
    grid[h-1][h].left = false;

    grid[h-1][h].bottom = false;
    grid[h][h].top = false;

    grid[h][h].left = false;
    grid[h][h-1].right = false;

    grid[h][h-1].top = false;
    grid[h-1][h-1].bottom = false;
  } else {
    // Knock out some walls across the whole grid
    removeRandomWalls(grid, rows, cols, wallRemoval);
  }

  // Convert the grid representation into line segments for physics
  const walls = gridToSegments(grid, rows, cols);
  return { walls, rows, cols };
}

/* ── helpers ───────────────────────────────────────────── */

function unvisitedNeighbours(grid, r, c, rows, cols) {
  const out = [];
  if (r > 0 && !grid[r - 1][c].visited) out.push({ r: r - 1, c });
  if (r < rows - 1 && !grid[r + 1][c].visited) out.push({ r: r + 1, c });
  if (c > 0 && !grid[r][c - 1].visited) out.push({ r, c: c - 1 });
  if (c < cols - 1 && !grid[r][c + 1].visited) out.push({ r, c: c + 1 });
  return out;
}

function removeWallBetween(grid, r1, c1, r2, c2) {
  if (r2 === r1 - 1) { grid[r1][c1].top = false; grid[r2][c2].bottom = false; }
  if (r2 === r1 + 1) { grid[r1][c1].bottom = false; grid[r2][c2].top = false; }
  if (c2 === c1 - 1) { grid[r1][c1].left = false; grid[r2][c2].right = false; }
  if (c2 === c1 + 1) { grid[r1][c1].right = false; grid[r2][c2].left = false; }
}

function removeRandomWalls(grid, rows, cols, fraction) {
  // Collect all remaining internal walls
  const candidates = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c < cols - 1 && grid[r][c].right)  candidates.push({ r, c, side: 'right' });
      if (r < rows - 1 && grid[r][c].bottom) candidates.push({ r, c, side: 'bottom' });
    }
  }

  // Fisher-Yates partial shuffle to pick walls to remove
  const count = Math.floor(candidates.length * fraction);
  for (let i = 0; i < count && candidates.length > 0; i++) {
    const idx = Math.floor(Math.random() * candidates.length);
    const w = candidates[idx];
    if (w.side === 'right') {
      grid[w.r][w.c].right = false;
      grid[w.r][w.c + 1].left = false;
    } else {
      grid[w.r][w.c].bottom = false;
      grid[w.r + 1][w.c].top = false;
    }
    candidates.splice(idx, 1);
  }
}

function applySymmetry(grid, halfSize) {
  const size = halfSize * 2;
  for (let r = 0; r < halfSize; r++) {
    for (let c = 0; c < halfSize; c++) {
      const cell = grid[r][c];
      
      const trR = c;
      const trC = size - 1 - r;
      grid[trR][trC] = { top: cell.left, right: cell.top, bottom: cell.right, left: cell.bottom, visited: true };
      
      const brR = size - 1 - r;
      const brC = size - 1 - c;
      grid[brR][brC] = { top: cell.bottom, right: cell.left, bottom: cell.top, left: cell.right, visited: true };
      
      const blR = size - 1 - c;
      const blC = r;
      grid[blR][blC] = { top: cell.right, right: cell.bottom, bottom: cell.left, left: cell.top, visited: true };
    }
  }
}

function gridToSegments(grid, rows, cols) {
  const S = CELL_SIZE;
  const walls = [];

  // Four border walls
  walls.push({ x1: 0, y1: 0, x2: cols * S, y2: 0 });             // top
  walls.push({ x1: 0, y1: rows * S, x2: cols * S, y2: rows * S }); // bottom
  walls.push({ x1: 0, y1: 0, x2: 0, y2: rows * S });             // left
  walls.push({ x1: cols * S, y1: 0, x2: cols * S, y2: rows * S }); // right

  // Internal walls — emit only RIGHT and BOTTOM to avoid duplicates
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c < cols - 1 && grid[r][c].right) {
        walls.push({ x1: (c + 1) * S, y1: r * S, x2: (c + 1) * S, y2: (r + 1) * S });
      }
      if (r < rows - 1 && grid[r][c].bottom) {
        walls.push({ x1: c * S, y1: (r + 1) * S, x2: (c + 1) * S, y2: (r + 1) * S });
      }
    }
  }

  return walls;
}

function getSpawnPositions(rows, cols, count = 4, symmetric = false) {
  const S = CELL_SIZE;
  const half = S / 2;

  if (symmetric) {
    return [
      { x: half,                y: half,                angle: Math.PI * 0.25 },   // top-left  → SE
      { x: (cols - 0.5) * S,    y: half,                angle: Math.PI * 0.75 },  // top-right → SW
      { x: (cols - 0.5) * S,    y: (rows - 0.5) * S,    angle: -Math.PI * 0.75 }, // bot-right → NW
      { x: half,                y: (rows - 0.5) * S,    angle: -Math.PI * 0.25 }, // bot-left  → NE
    ];
  }

  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({ r, c });
    }
  }

  // Shuffle cells
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }

  const spawns = [];
  for (let i = 0; i < Math.min(count, cells.length); i++) {
    const cell = cells[i];
    spawns.push({
      x: cell.c * S + half,
      y: cell.r * S + half,
      angle: Math.random() * Math.PI * 2
    });
  }
  return spawns;
}

module.exports = { generateMaze, getSpawnPositions };
