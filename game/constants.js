module.exports = {
  // Maze
  CELL_SIZE: 64,
  MAZE_ROWS_MIN: 6,
  MAZE_ROWS_MAX: 9,
  MAZE_COLS_MIN: 10,
  MAZE_COLS_MAX: 14,
  WALL_REMOVAL_FRACTION: 0.18,

  // Tank
  TANK_WIDTH: 24,
  TANK_LENGTH: 32,
  TANK_RADIUS: 14,       // kept for reference
  TANK_SPEED: 2.03,
  TANK_TURN_RATE: 0.11,  // radians per tick

  // Barrel (for Matter.js compound body)
  BARREL_LENGTH: 9,
  BARREL_WIDTH: 6,

  // Bullet
  BULLET_RADIUS: 2.5,
  BULLET_SPEED: 2.323,
  MAX_BOUNCES: Infinity,   // unlimited bounces
  BULLET_LIFETIME_FRAMES: 600, // 10 seconds at 60 Hz
  MAX_BULLETS_PER_PLAYER: 10,
  BULLET_GRACE_FRAMES: 15,
  BULLET_SPAWN_OFFSET: 10, // px from tank center

  // Timing
  TICK_RATE: 60,
  BROADCAST_RATE: 20,
  ROUND_END_DELAY: 3000, // ms
  POST_WIN_DELAY: 4000,  // ms to carry on game after all but one die
  
  // Players
  MAX_PLAYERS: 4,
  PLAYER_COLORS: ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f'],
  PLAYER_NAMES: ['Red', 'Blue', 'Green', 'Yellow'],
};
