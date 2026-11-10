module.exports = {
  // Maze
  CELL_SIZE: 64,
  MAZE_ROWS_MIN: 6,
  MAZE_ROWS_MAX: 9,
  MAZE_COLS_MIN: 10,
  MAZE_COLS_MAX: 14,
  WALL_REMOVAL_FRACTION: 0.7,

  // Tank
  TANK_WIDTH: 24,
  TANK_LENGTH: 32,
  TANK_RADIUS: 14,       // kept for reference
  TANK_SPEED: 2.2,
  TANK_TURN_RATE: 0.11,  // radians per tick

  // Barrel (for Matter.js compound body)
  BARREL_LENGTH: 9,
  BARREL_WIDTH: 6,

  // Bullet
  BULLET_RADIUS: 2.5,
  BULLET_SPEED: 2.5,
  MAX_BOUNCES: Infinity,   // unlimited bounces
  BULLET_LIFETIME_FRAMES: 600, // 10 seconds at 60 Hz
  MAX_BULLETS_PER_PLAYER: 10,
  BULLET_GRACE_FRAMES: 15,
  BULLET_SPAWN_OFFSET: 20, // px from tank center

  // Timing
  TICK_RATE: 60,
  BROADCAST_RATE: 60,
  ROUND_END_DELAY: 3000, // ms
  POST_WIN_DELAY: 4000,  // ms to carry on game after all but one die
  ROUND_TIMEOUT: 120000, // ms – 2 minutes max round duration
  
  // Players
  MAX_PLAYERS: 4,
  PLAYER_COLORS: ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f'],
  PLAYER_NAMES: ['Red', 'Blue', 'Green', 'Yellow'],

  // ── Power-ups ──────────────────────────────────────────
  POWERUP_SPAWN_INTERVAL: 480,   // frames (8s at 60Hz), adjustable in settings
  POWERUP_SIZE: 24,              // side length of the power-up square (px)
  POWERUP_PICKUP_RADIUS: 18,    // how close a tank must be to collect

  // Power-up types
  POWERUP_SHIELD: 'shield',
  POWERUP_DOUBLEGUN: 'doublegun',
  POWERUP_LASER: 'laser',
  POWERUP_SHOTGUN: 'shotgun',

  // Shield
  SHIELD_DURATION_FRAMES: 420,       // 7 seconds at 60Hz
  SHIELD_FLICKER_START_FRAMES: 300,  // 5 seconds — start flickering
  SHIELD_FLICKER_PERIOD_MS: 400,     // 200ms on, 200ms dim
  SHIELD_RADIUS_FRACTION: 0.90,      // 90% of half-cell-size diameter
  SHIELD_COLOR: '#4dffff',

  // Double gun
  DOUBLEGUN_TOTAL_SHOTS: 10,         // 10 total bullets (5 per barrel)
  DOUBLEGUN_BULLET_LIFETIME: 360,    // 6 seconds at 60Hz
  DOUBLEGUN_BARREL_OFFSET: 5,       // px offset from center for each barrel
  
  // Laser
  LASER_SPEED: 22.45,
  LASER_LIFETIME_FRAMES: 48,         // 800ms at 60Hz
  LASER_LENGTH: 160,                 // 2.5 units (2.5 * 64)
  LASER_AIM_LENGTH: 384,             // 6 units (6 * 64)

  // Shotgun
  SHOTGUN_SHOTS: 3,
  SHOTGUN_PELLETS: 20,
  SHOTGUN_SPEED: 4.25,
  SHOTGUN_LIFETIME_FRAMES: 120,      // 2 seconds at 60Hz
  SHOTGUN_SPREAD_RADIANS: 4 * (Math.PI / 180), // 4 degrees
};
