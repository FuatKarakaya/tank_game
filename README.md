# TankTrouble LAN

A real-time LAN/multiplayer browser game inspired by classic TankTrouble, built with **Node.js**, **Express**, **Socket.IO**, and **Matter.js** physics.

## Features

- **Real-Time Multiplayer (up to 4 players):** Play across devices on the same local network at 60 Hz server tick rate with client-side interpolation.
- **Physics & Ricochets:** Powered by Matter.js for tank-to-wall collisions and continuous raycast/swept collision detection for bouncing projectiles.
- **Procedural Mazes:** Randomized or symmetric grid mazes with configurable dimensions and wall removal ratios.
- **Power-Ups:**
  - **Shield:** Temporary protective bubble that deflects/absorbs incoming projectiles and flickers before expiring.
  - **Double Gun:** Dual-barrel rapid fire with extra ammo.
  - **Laser:** High-velocity piercing beam with a predictive laser sight.
  - **Shotgun:** Fires a tight spread of 20 bouncing pellets per shot.
- **Live Game Settings:** Customize tank speed, turn rate, bullet speed, max bullets, maze size/symmetry, screen shake, and power-up spawn rules directly from the in-game settings menu (`⚙️`).
- **Player Customization & Stats:** Choose your player name and tank color, view head-to-head kill leaderboards, and track global Scrapyard (kills) and Bullets Fired counters.

## Controls

| Action | Primary Keys | Alternative Keys |
| :--- | :--- | :--- |
| **Move Forward** | `W` | `↑` (Up Arrow) |
| **Move Backward** | `S` | `↓` (Down Arrow) |
| **Turn Left** | `A` | `←` (Left Arrow) |
| **Turn Right** | `D` | `→` (Right Arrow) |
| **Fire** | `Space` | `Q` |

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v16 or higher recommended)

### Installation

```bash
npm install
```

### Running the Server

```bash
npm start
```

The server starts on port `3001` and prints both the local URL and your LAN IP address:

```text
  ╔══════════════════════════════════════╗
  ║    TankTrouble LAN (Matter.js)       ║
  ╠══════════════════════════════════════╣
  ║  Local:   http://localhost:3001      ║
  ║  Network: http://<YOUR_LAN_IP>:3001  ║
  ╚══════════════════════════════════════╝
```

Share the **Network** URL with other players on the same Wi-Fi/LAN to join the match.

## Project Structure

```text
├── game/
│   ├── collision.js      # Bullet-tank and OBB collision detection
│   ├── constants.js      # Game balance, physics, and power-up constants
│   ├── matterPhysics.js  # Matter.js world, wall bodies, and tank compound bodies
│   ├── maze.js           # Procedural & symmetric maze generator
│   ├── physics.js        # Bullet movement, raycasting, and wall ricochets
│   └── powerups.js       # Power-up spawning, pickup, and active effect timers
├── public/
│   ├── index.html        # Game UI, scoreboard, and settings modal
│   ├── style.css         # Styling and layout
│   ├── client.js         # Socket.IO client, input handling, and state interpolation
│   └── renderer.js       # HTML5 Canvas rendering, particles, and visual effects
└── server.js             # Express + Socket.IO server and 60 Hz game loop
```
