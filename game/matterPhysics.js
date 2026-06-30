const Matter = require('matter-js');
const C = require('./constants');

const { Engine, World, Bodies, Body, Composite, Events } = Matter;

/**
 * Manages a headless Matter.js world for tank physics.
 * Tanks are compound bodies (rectangle hull + barrel).
 * Maze walls are static rectangle bodies.
 */
class MatterWorld {
  constructor() {
    this.engine = Engine.create({
      gravity: { x: 0, y: 0 },  // top-down, no gravity
    });
    this.world = this.engine.world;
    this.tankBodies = {};  // id → Matter.Body (compound)
    this.wallBodies = [];
  }

  /**
   * Build static wall bodies from maze wall segments.
   * Each wall segment {x1,y1,x2,y2} becomes a thin static rectangle.
   */
  initWalls(walls) {
    const WALL_THICKNESS = 6;  // matches the visual wall width

    for (const w of walls) {
      const cx = (w.x1 + w.x2) / 2;
      const cy = (w.y1 + w.y2) / 2;
      const dx = w.x2 - w.x1;
      const dy = w.y2 - w.y1;
      const length = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);

      if (length < 0.1) continue;  // skip degenerate segments

      const wallBody = Bodies.rectangle(cx, cy, length, WALL_THICKNESS, {
        isStatic: true,
        angle: angle,
        friction: 0,
        restitution: 0.2,
        label: 'wall',
      });
      this.wallBodies.push(wallBody);
    }

    Composite.add(this.world, this.wallBodies);
  }

  /**
   * Create a compound tank body: rectangle hull + barrel rectangle.
   * The barrel protrudes from the front of the hull.
   */
  addTank(id, x, y, angle) {
    const hullW = C.TANK_LENGTH;  // along the tank's facing direction
    const hullH = C.TANK_WIDTH;
    const barrelW = C.BARREL_LENGTH;
    const barrelH = C.BARREL_WIDTH;

    // Hull centered at (0,0) in local coords
    const hull = Bodies.rectangle(0, 0, hullW, hullH, {
      label: 'tankHull',
    });

    // Barrel offset: its center is at the front of the hull + half barrel length
    const barrelOffsetX = hullW / 2 + barrelW / 2 - 2; // -2 for overlap like original
    const barrel = Bodies.rectangle(barrelOffsetX, 0, barrelW, barrelH, {
      label: 'tankBarrel',
    });

    // Create compound body
    const tankBody = Body.create({
      parts: [hull, barrel],
      friction: 0,
      frictionAir: 0.15,    // some drag to keep movement feeling controlled
      frictionStatic: 0,
      restitution: 0.3,
      density: 0.005,
      label: 'tank',
      collisionFilter: {
        category: 0x0002,   // tanks
        mask: 0x0003,       // collide with walls (0x0001) and other tanks (0x0002)
      },
    });

    Body.setPosition(tankBody, { x, y });
    Body.setAngle(tankBody, angle);
    Body.setVelocity(tankBody, { x: 0, y: 0 });
    Body.setAngularVelocity(tankBody, 0);

    Composite.add(this.world, tankBody);
    this.tankBodies[id] = tankBody;

    return tankBody;
  }

  /**
   * Remove a tank body from the world (on death or disconnect).
   */
  removeTank(id) {
    const body = this.tankBodies[id];
    if (body) {
      Composite.remove(this.world, body);
      delete this.tankBodies[id];
    }
  }

  /**
   * Apply movement input to a tank.
   * Instead of directly setting position, we set velocity for physics-based movement.
   */
  applyTankInput(id, input, settings) {
    const body = this.tankBodies[id];
    if (!body) return;

    const speed = settings.tankSpeed;
    const turnRate = settings.tankTurnRate;

    // Turn — apply angular velocity
    let angVel = 0;
    if (input.left) angVel -= turnRate;
    if (input.right) angVel += turnRate;
    Body.setAngularVelocity(body, angVel);

    // Move — apply velocity in facing direction
    const angle = body.angle;
    let vx = 0, vy = 0;
    if (input.forward) {
      vx += Math.cos(angle) * speed;
      vy += Math.sin(angle) * speed;
    }
    if (input.backward) {
      vx -= Math.cos(angle) * speed;
      vy -= Math.sin(angle) * speed;
    }
    Body.setVelocity(body, { x: vx, y: vy });
  }

  /**
   * Step the physics engine by one tick.
   */
  step() {
    Engine.update(this.engine, 1000 / C.TICK_RATE);
  }

  /**
   * Read position and angle from a tank body.
   */
  getTankState(id) {
    const body = this.tankBodies[id];
    if (!body) return null;
    return {
      x: body.position.x,
      y: body.position.y,
      angle: body.angle,
    };
  }

  /**
   * Clear everything for a new round.
   */
  destroy() {
    Composite.clear(this.world, false);
    this.tankBodies = {};
    this.wallBodies = [];
  }
}

module.exports = { MatterWorld };
