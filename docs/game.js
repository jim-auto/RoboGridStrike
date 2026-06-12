"use strict";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const hpEl = document.getElementById("hp");
const waveEl = document.getElementById("wave");
const syncEl = document.getElementById("sync");
const touchButtons = document.querySelectorAll("[data-action]");
const heroArt = new Image();
heroArt.src = "./assets/maintenance-robot.jpg";
const wardenArt = new Image();
wardenArt.src = "./assets/signal-warden.jpg";

const W = canvas.width;
const H = canvas.height;
const grid = {
  x: 267,
  y: 82,
  cols: 6,
  rows: 6,
  cell: 66,
  gap: 6,
};
const MISSION_CLEAR_WAVE = 5;

const keys = new Set();
const pressed = new Set();
const shots = [];
const slashes = [];
const zones = [];
const hazards = [];
const clones = [];
const pulses = [];
const sparks = [];
const enemies = [];
const obstacles = [
  { col: 2, row: 2, hp: 45, flash: 0 },
  { col: 3, row: 4, hp: 45, flash: 0 },
];
const chips = [
  { label: "LiDAR", cooldown: 1.15 },
  { label: "SNARE", cooldown: 1.65 },
  { label: "CLONE", cooldown: 2.2 },
  { label: "JAM", cooldown: 4.0 },
];
const upgradePool = [
  {
    title: "Rifle Tune",
    detail: "Gun damage +3",
    apply: () => {
      player.gunBonus += 3;
    },
  },
  {
    title: "Blade Servo",
    detail: "Sword damage +8",
    apply: () => {
      player.swordBonus += 8;
    },
  },
  {
    title: "Phase Bearing",
    detail: "Phase cooldown -18%",
    apply: () => {
      player.phaseCdMult *= 0.82;
    },
  },
  {
    title: "Signal Cache",
    detail: "SYNC gain +25%",
    apply: () => {
      player.syncGainMult *= 1.25;
    },
  },
  {
    title: "Chip Scheduler",
    detail: "Chip cooldowns -15%",
    apply: () => {
      player.chipCdMult *= 0.85;
    },
  },
  {
    title: "Field Patch",
    detail: "Max HP +20 and repair 30",
    apply: () => {
      player.maxHp += 20;
      player.hp = Math.min(player.maxHp, player.hp + 30);
    },
  },
];

let audioCtx = null;
let lastTime = performance.now();
let hitstop = 0;
let shake = 0;
let titleScreen = true;
let gameOver = false;
let missionComplete = false;
let wave = 1;
let spawnTimer = 0;
let message = "SYSTEM ONLINE";
let nextEnemyId = 1;
let upgradePending = false;
let upgradeChoices = [];
let pendingWave = 1;
const runStats = {
  startedAt: performance.now(),
  completedAt: 0,
  damageTaken: 0,
  overclockUses: 0,
  upgrades: 0,
};
let missionResult = null;

const player = {
  col: 1,
  row: 3,
  px: 0,
  py: 0,
  hp: 100,
  maxHp: 100,
  invuln: 0,
  dash: 0,
  gunCd: 0,
  swordCd: 0,
  phaseCd: 0,
  sync: 0,
  overdrive: 0,
  turn: 0,
  gunBonus: 0,
  swordBonus: 0,
  phaseCdMult: 1,
  chipCdMult: 1,
  syncGainMult: 1,
  chipCd: [0, 0, 0, 0],
  facing: 1,
};

function cellCenter(col, row) {
  return {
    x: grid.x + col * (grid.cell + grid.gap) + grid.cell / 2,
    y: grid.y + row * (grid.cell + grid.gap) + grid.cell / 2,
  };
}

function init() {
  const p = cellCenter(player.col, player.row);
  player.px = p.x;
  player.py = p.y;
  enemies.length = 0;
  message = "MISSION STANDBY";
}

function startMission() {
  if (!titleScreen) return;
  titleScreen = false;
  runStats.startedAt = performance.now();
  runStats.completedAt = 0;
  runStats.damageTaken = 0;
  runStats.overclockUses = 0;
  runStats.upgrades = 0;
  pressed.clear();
  message = "SYSTEM ONLINE";
  spawnEnemy("charger", 4, 1);
  spawnEnemy("worker", 5, 3);
  spawnEnemy("turret", 5, 5);
}

function playTone(freq, dur = 0.04, type = "square", gain = 0.025) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const amp = audioCtx.createGain();
  osc.frequency.value = freq;
  osc.type = type;
  amp.gain.setValueAtTime(gain, audioCtx.currentTime);
  amp.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
  osc.connect(amp).connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + dur);
}

function armAudio() {
  if (!audioCtx) audioCtx = new AudioContext();
}

function spawnEnemy(type, col, row) {
  const p = cellCenter(col, row);
  const specs = {
    charger: { hp: 75, cd: 0.9 },
    turret: { hp: 60, cd: 1.4 },
    worker: { hp: 70, cd: 1.15 },
    warden: { hp: 360, cd: 1.0 },
  };
  const spec = specs[type] || specs.charger;
  enemies.push({
    id: nextEnemyId++,
    type,
    col,
    row,
    px: p.x,
    py: p.y,
    hp: spec.hp,
    maxHp: spec.hp,
    cd: spec.cd,
    windup: 0,
    action: null,
    stun: 0,
    flash: 0,
    dirJam: 0,
    scanned: 0,
    facing: -1,
    pattern: 0,
  });
}

function inBounds(col, row) {
  return col >= 0 && col < grid.cols && row >= 0 && row < grid.rows;
}

function isBlocked(col, row) {
  return obstacles.some((o) => o.hp > 0 && o.col === col && o.row === row);
}

function isEnemyCell(col, row, ignoreId = null) {
  return enemies.some((enemy) => enemy.hp > 0 && enemy.id !== ignoreId && enemy.col === col && enemy.row === row);
}

function isPlayerCell(col, row) {
  return player.col === col && player.row === row;
}

function clampPlayer() {
  player.col = Math.max(0, Math.min(grid.cols - 1, player.col));
  player.row = Math.max(0, Math.min(grid.rows - 1, player.row));
}

function tryMove(dx, dy) {
  if (dx !== 0 && dy === 0) {
    const dir = dx > 0 ? 1 : -1;
    if (dir !== player.facing) {
      turnPlayer(dir);
      return;
    }
  }
  if (dx > 0) player.facing = 1;
  if (dx < 0) player.facing = -1;
  const nextCol = player.col + dx;
  const nextRow = player.row + dy;
  if (!inBounds(nextCol, nextRow)) return;
  if (isBlocked(nextCol, nextRow)) return;
  if (isEnemyCell(nextCol, nextRow)) return;
  player.col = nextCol;
  player.row = nextRow;
}

function addTurnBurst(dir) {
  const p = cellCenter(player.col, player.row);
  sparks.push({ x: p.x - dir * 22, y: p.y, t: 0.14, color: "#7dff91" });
  sparks.push({ x: p.x + dir * 18, y: p.y - 22, t: 0.12, color: "#ffd35a" });
}

function dashPlayer() {
  player.dash = 0.12;
  tryMove(player.facing, 0);
  shake = Math.max(shake, 4);
  playTone(220, 0.035, "triangle", 0.016);
}

function gainSync(amount) {
  if (amount <= 0 || gameOver) return;
  player.sync = Math.min(100, player.sync + amount * player.syncGainMult);
}

function damageEnemy(enemy, amount, knock = 0, syncGain = amount * 0.32) {
  const wasAlive = enemy.hp > 0;
  enemy.hp -= amount;
  enemy.flash = 0.12;
  enemy.stun = Math.max(enemy.stun, 0.08);
  const nextCol = Math.max(0, Math.min(grid.cols - 1, enemy.col + knock));
  if (enemy.type !== "warden" && knock && !isBlocked(nextCol, enemy.row) && !isEnemyCell(nextCol, enemy.row, enemy.id) && !isPlayerCell(nextCol, enemy.row)) {
    enemy.col = nextCol;
  }
  const p = cellCenter(enemy.col, enemy.row);
  enemy.px = p.x;
  enemy.py = p.y;
  hitstop = Math.max(hitstop, 0.055);
  shake = Math.max(shake, 8);
  sparks.push({ x: enemy.px, y: enemy.py, t: 0.18, color: "#ffd35a" });
  playTone(160, 0.045, "sawtooth", 0.035);
  if (wasAlive) gainSync(syncGain);
}

function hurtPlayer(amount) {
  if (player.invuln > 0 || gameOver) return;
  runStats.damageTaken += Math.min(amount, player.hp);
  player.hp -= amount;
  player.invuln = 1.0;
  hitstop = 0.07;
  shake = 12;
  sparks.push({ x: player.px, y: player.py, t: 0.22, color: "#ff5b6e" });
  playTone(80, 0.09, "triangle", 0.045);
  if (player.hp <= 0) {
    player.hp = 0;
    gameOver = true;
    message = "OPERATOR DOWN - PRESS R";
  }
}

function addClone(col, row, duration = 1.0) {
  if (!inBounds(col, row) || isBlocked(col, row)) return;
  const p = cellCenter(col, row);
  clones.push({ col, row, px: p.x, py: p.y, t: duration, max: duration, facing: player.facing });
}

function turnPlayer(dir) {
  if (player.facing === dir) {
    player.turn = Math.max(player.turn, 0.1);
    message = dir < 0 ? "HOLDING LEFT" : "HOLDING RIGHT";
    return;
  }
  player.facing = dir;
  player.turn = 0.22;
  addTurnBurst(dir);
  shake = Math.max(shake, 3);
  message = dir < 0 ? "PIVOT LEFT" : "PIVOT RIGHT";
  playTone(dir < 0 ? 330 : 390, 0.045, "triangle", 0.022);
}

function flipPlayer() {
  turnPlayer(player.facing * -1);
}

function makeLaneCells(enemy) {
  const cells = [];
  const useRow = Math.abs(player.col - enemy.col) >= Math.abs(player.row - enemy.row);
  if (useRow) {
    const row = player.row;
    const left = Math.min(player.col, enemy.col);
    const right = Math.max(player.col, enemy.col);
    for (let col = left; col <= right; col++) {
      if (inBounds(col, row) && !isBlocked(col, row)) cells.push({ col, row });
    }
  } else {
    const col = player.col;
    const top = Math.min(player.row, enemy.row);
    const bottom = Math.max(player.row, enemy.row);
    for (let row = top; row <= bottom; row++) {
      if (inBounds(col, row) && !isBlocked(col, row)) cells.push({ col, row });
    }
  }
  return cells;
}

function startLaneWork(enemy) {
  const cells = makeLaneCells(enemy);
  if (!cells.length) return false;
  enemy.action = { type: "lane", cells };
  enemy.windup = 0.5;
  enemy.cd = 999;
  playTone(260, 0.04, "triangle", 0.014);
  return true;
}

function rowCells(row) {
  const cells = [];
  for (let col = 0; col < grid.cols; col++) cells.push({ col, row });
  return cells;
}

function colCells(col) {
  const cells = [];
  for (let row = 0; row < grid.rows; row++) cells.push({ col, row });
  return cells;
}

function forwardRowCells(fromCol, row, dir) {
  const cells = [];
  if (dir > 0) {
    for (let col = fromCol; col < grid.cols; col++) cells.push({ col, row });
  } else {
    for (let col = fromCol; col >= 0; col--) cells.push({ col, row });
  }
  return cells;
}

function wardenBarrierCells(enemy) {
  const anchors = [
    { col: 2, row: Math.max(0, player.row - 1) },
    { col: 3, row: Math.min(grid.rows - 1, player.row + 1) },
    { col: enemy.col - 1, row: Math.max(0, Math.min(grid.rows - 1, player.row)) },
  ];
  const cells = [];
  for (const cell of anchors) {
    if (!inBounds(cell.col, cell.row) || isPlayerCell(cell.col, cell.row) || isEnemyCell(cell.col, cell.row)) continue;
    if (cells.some((other) => other.col === cell.col && other.row === cell.row)) continue;
    cells.push(cell);
  }
  return cells;
}

function startWardenAction(enemy) {
  const step = enemy.pattern % 3;
  enemy.pattern += 1;
  enemy.facing = player.col < enemy.col ? -1 : 1;

  if (step === 0) {
    enemy.action = { type: "wardenBeam", cells: rowCells(player.row) };
    enemy.windup = 0.68;
    enemy.cd = 999;
    message = "SIGNAL WARDEN: ROW LOCK";
    playTone(210, 0.06, "sine", 0.018);
    return;
  }

  if (step === 1) {
    const row = player.row;
    const col = Math.max(0, Math.min(grid.cols - 1, player.col + player.facing));
    enemy.action = { type: "wardenLane", cells: [...rowCells(row), ...colCells(col)] };
    enemy.windup = 0.55;
    enemy.cd = 999;
    message = "SIGNAL WARDEN: WORK ZONE";
    playTone(260, 0.06, "triangle", 0.018);
    return;
  }

  const cells = wardenBarrierCells(enemy);
  enemy.action = { type: "wardenBarrier", cells };
  enemy.windup = 0.7;
  enemy.cd = 999;
  message = "SIGNAL WARDEN: BARRIER SHIFT";
  playTone(130, 0.08, "sawtooth", 0.018);
}

function fireGun() {
  if (player.gunCd > 0 || gameOver) return;
  player.gunCd = player.overdrive > 0 ? 0.1 : 0.18;
  const p = cellCenter(player.col, player.row);
  shots.push({ x: p.x + player.facing * 34, y: p.y, vx: player.facing * 720, damage: 10 + player.gunBonus, team: "player", pierce: 0, r: 7, hit: new Set() });
  sparks.push({ x: p.x + player.facing * 24, y: p.y, t: 0.08, color: "#46e4ff" });
  playTone(510, 0.035, "square", 0.018);
}

function swingSword() {
  if (player.swordCd > 0 || gameOver) return;
  const col = player.col + player.facing;
  if (!inBounds(col, player.row)) return;
  player.swordCd = player.overdrive > 0 ? 0.24 : 0.38;
  slashes.push({ col, row: player.row, t: 0.16, damage: 34 + player.swordBonus, knock: player.facing });
  message = "EDGE STRIKE";
  playTone(760, 0.06, "triangle", 0.045);
}

function findPhaseTarget() {
  const row = player.row;
  const mirrorCol = grid.cols - 1 - player.col;
  const candidates = [mirrorCol, mirrorCol + player.facing, mirrorCol - player.facing];
  for (const col of candidates) {
    if (col === player.col || !inBounds(col, row)) continue;
    if (isBlocked(col, row) || isEnemyCell(col, row)) continue;
    return col;
  }
  return null;
}

function phaseShift() {
  if (player.phaseCd > 0 || gameOver) return;
  const targetCol = findPhaseTarget();
  if (targetCol === null) {
    player.phaseCd = 0.35 * player.phaseCdMult;
    message = "PHASE BLOCKED";
    playTone(110, 0.06, "triangle", 0.018);
    return;
  }

  const startCol = player.col;
  const row = player.row;
  const isOverclock = player.sync >= 100;
  const dir = Math.sign(targetCol - startCol) || player.facing;
  const left = Math.min(startCol, targetCol);
  const right = Math.max(startCol, targetCol);
  const pulseT = isOverclock ? 0.34 : 0.24;

  addClone(startCol, row, 0.85);
  player.col = targetCol;
  player.facing = dir;
  player.dash = 0.18;
  player.phaseCd = (isOverclock ? 1.05 : 2.4) * player.phaseCdMult;
  pulses.push({ row, from: left, to: right, t: pulseT, max: pulseT, overclock: isOverclock });

  for (const enemy of enemies) {
    if (enemy.row >= row - 1 && enemy.row <= row + 1 && enemy.col >= left && enemy.col <= right) {
      damageEnemy(enemy, isOverclock ? 42 : 22, dir, isOverclock ? 0 : 7);
      if (isOverclock) enemy.dirJam = Math.max(enemy.dirJam, 1.3);
    }
  }

  if (isOverclock) {
    player.sync = 0;
    player.overdrive = 4.0;
    runStats.overclockUses += 1;
    message = "OVERCLOCK PHASE";
    shake = Math.max(shake, 13);
    playTone(740, 0.12, "sawtooth", 0.05);
  } else {
    message = "MIRROR PHASE";
    shake = Math.max(shake, 8);
    playTone(520, 0.08, "square", 0.034);
  }
}

function useChip(i) {
  if (player.chipCd[i] > 0 || gameOver) return;
  if (i === 0) {
    player.chipCd[i] = chips[i].cooldown * player.chipCdMult;
    const dir = player.facing;
    const from = player.col + dir;
    const to = dir > 0 ? grid.cols - 1 : 0;
    const left = Math.min(from, to);
    const right = Math.max(from, to);
    let tagged = 0;
    for (const enemy of enemies) {
      if (enemy.col < left || enemy.col > right || Math.abs(enemy.row - player.row) > 1) continue;
      enemy.scanned = 2.4;
      tagged += 1;
      sparks.push({ x: enemy.px, y: enemy.py, t: 0.24, color: "#7dff91" });
    }
    for (const o of obstacles) {
      if (o.hp <= 0 || o.col < left || o.col > right || Math.abs(o.row - player.row) > 1) continue;
      o.flash = 0.35;
    }
    gainSync(tagged > 0 ? tagged * 9 + 5 : 6);
    for (let row = Math.max(0, player.row - 1); row <= Math.min(grid.rows - 1, player.row + 1); row++) {
      pulses.push({ row, from: left, to: right, t: 0.26, max: 0.26, scan: true });
    }
    message = tagged > 0 ? `LiDAR SWEEP x${tagged}` : "LiDAR SWEEP";
    playTone(520, 0.09, "sine", 0.032);
  } else if (i === 1) {
    player.chipCd[i] = chips[i].cooldown * player.chipCdMult;
    const col = player.col + player.facing;
    for (let row = player.row - 1; row <= player.row + 1; row++) {
      if (inBounds(col, row)) zones.push({ col, row, t: 1.2, tick: row === player.row ? 0 : 0.08, damage: 9, jam: false });
    }
    message = "ARC SNARE";
    playTone(420, 0.09, "sine", 0.038);
  } else if (i === 2) {
    player.chipCd[i] = chips[i].cooldown * player.chipCdMult;
    player.dash = 0.16;
    const startCol = player.col;
    const startRow = player.row;
    addClone(startCol, startRow, 1.1);
    const oldCol = player.col;
    player.col = Math.max(0, Math.min(grid.cols - 1, player.col + player.facing * 2));
    if (isBlocked(player.col, player.row) || isEnemyCell(player.col, player.row)) player.col = oldCol;
    addClone(player.col, Math.max(0, player.row - 1), 0.9);
    addClone(player.col, Math.min(grid.rows - 1, player.row + 1), 0.9);
    if (inBounds(player.col + player.facing, player.row)) {
      slashes.push({ col: player.col + player.facing, row: player.row, t: 0.16, damage: 36 + Math.floor(player.swordBonus * 0.5), knock: player.facing });
    }
    message = "VECTOR CLONE";
    shake = 7;
    playTone(360, 0.07, "square", 0.035);
  } else if (i === 3) {
    player.chipCd[i] = chips[i].cooldown * player.chipCdMult;
    for (const enemy of enemies) {
      enemy.dirJam = 3.0;
      enemy.cd += 0.45 + Math.random() * 0.35;
      enemy.flash = 0.2;
      sparks.push({ x: enemy.px, y: enemy.py, t: 0.32, color: "#c77dff" });
    }
    for (let step = 1; step <= 2; step++) {
      const col = player.col + player.facing * step;
      if (inBounds(col, player.row)) zones.push({ col, row: player.row, t: 2.2, tick: step === 1 ? 0 : 0.1, damage: 5, jam: true });
    }
    message = "LOCALIZATION JAM";
    playTone(190, 0.14, "sine", 0.044);
  }
}

function updatePlayer(dt) {
  const cdRate = player.overdrive > 0 ? 1.65 : 1;
  player.gunCd = Math.max(0, player.gunCd - dt * cdRate);
  player.swordCd = Math.max(0, player.swordCd - dt * cdRate);
  player.phaseCd = Math.max(0, player.phaseCd - dt);
  player.overdrive = Math.max(0, player.overdrive - dt);
  player.turn = Math.max(0, player.turn - dt);
  player.invuln = Math.max(0, player.invuln - dt);
  player.dash = Math.max(0, player.dash - dt);
  player.chipCd = player.chipCd.map((v) => Math.max(0, v - dt * (player.overdrive > 0 ? 1.25 : 1)));

  if (pressed.has("q")) turnPlayer(-1);
  if (pressed.has("e")) turnPlayer(1);
  if (pressed.has("c") || pressed.has("tab")) flipPlayer();
  if (pressed.has("f")) phaseShift();

  let dx = 0;
  let dy = 0;
  if (pressed.has("arrowleft") || pressed.has("a")) dx -= 1;
  if (pressed.has("arrowright") || pressed.has("d")) dx += 1;
  if (pressed.has("arrowup") || pressed.has("w")) dy -= 1;
  if (pressed.has("arrowdown") || pressed.has("s")) dy += 1;
  if (dx || dy) tryMove(dx, dy);

  if (pressed.has(" ") || pressed.has("shift")) {
    dashPlayer();
  }
  if (keys.has("j") || keys.has("z")) fireGun();
  if (pressed.has("k") || pressed.has("x")) swingSword();
  for (let i = 0; i < 4; i++) {
    if (pressed.has(String(i + 1))) useChip(i);
  }

  const target = cellCenter(player.col, player.row);
  const speed = player.dash > 0 ? 30 : 18;
  player.px += (target.x - player.px) * Math.min(1, dt * speed);
  player.py += (target.y - player.py) * Math.min(1, dt * speed);
  clampPlayer();
}

function updateEnemies(dt) {
  for (const enemy of enemies) {
    enemy.cd -= dt;
    enemy.stun = Math.max(0, enemy.stun - dt);
    enemy.flash = Math.max(0, enemy.flash - dt);
    enemy.dirJam = Math.max(0, enemy.dirJam - dt);
    enemy.scanned = Math.max(0, enemy.scanned - dt);
    if (enemy.stun > 0) continue;

    if (enemy.windup > 0) {
      enemy.windup -= dt;
      if (enemy.windup <= 0 && enemy.action) {
        if (enemy.action.type === "charge") {
          if (enemy.action.col === player.col && enemy.action.row === player.row) {
            hurtPlayer(18);
          } else if (inBounds(enemy.action.col, enemy.action.row) && !isBlocked(enemy.action.col, enemy.action.row) && !isEnemyCell(enemy.action.col, enemy.action.row, enemy.id)) {
            enemy.col = enemy.action.col;
            enemy.row = enemy.action.row;
          }
          enemy.cd = 1.0 + Math.random() * 0.45;
          shake = Math.max(shake, 5);
          playTone(120, 0.045, "sawtooth", 0.025);
        }
        if (enemy.action.type === "shoot") {
          const cells = forwardRowCells(enemy.col, enemy.action.row, enemy.action.dir);
          if (cells.length) {
            hazards.push({ cells, t: 0.42, tick: 0, damage: 20, kind: "beam" });
            shake = Math.max(shake, 8);
          }
          enemy.cd = 1.35 + Math.random() * 0.4;
          message = "TURRET LINE";
          playTone(280, 0.07, "sawtooth", 0.032);
        }
        if (enemy.action.type === "lane") {
          hazards.push({ cells: enemy.action.cells, t: 1.8, tick: 0, damage: 10 });
          enemy.cd = 1.55 + Math.random() * 0.45;
          shake = Math.max(shake, 5);
          playTone(150, 0.08, "sawtooth", 0.026);
        }
        if (enemy.action.type === "wardenBeam") {
          hazards.push({ cells: enemy.action.cells, t: 0.48, tick: 0, damage: 16, kind: "beam" });
          enemy.cd = 0.9;
          shake = Math.max(shake, 9);
          playTone(90, 0.12, "sawtooth", 0.04);
        }
        if (enemy.action.type === "wardenLane") {
          hazards.push({ cells: enemy.action.cells, t: 1.85, tick: 0, damage: 12, kind: "lane" });
          enemy.cd = 1.15;
          shake = Math.max(shake, 7);
          playTone(170, 0.1, "sawtooth", 0.034);
        }
        if (enemy.action.type === "wardenBarrier") {
          obstacles.splice(0, obstacles.length);
          for (const cell of enemy.action.cells) obstacles.push({ col: cell.col, row: cell.row, hp: 55, flash: 0.24 });
          enemy.cd = 1.35;
          shake = Math.max(shake, 8);
          playTone(120, 0.12, "triangle", 0.04);
        }
        enemy.action = null;
      }
    } else {
      if (enemy.type === "charger" && enemy.cd <= 0) {
        const colDelta = enemy.dirJam > 0 ? Math.sign(Math.random() - 0.5) : Math.sign(player.col - enemy.col);
        const rowDelta = enemy.dirJam > 0 ? Math.sign(Math.random() - 0.5) : Math.sign(player.row - enemy.row);
        const useHorizontal = Math.abs(player.col - enemy.col) >= Math.abs(player.row - enemy.row);
        const dx = useHorizontal && colDelta ? colDelta : 0;
        const dy = !dx && rowDelta ? rowDelta : 0;
        enemy.facing = dx || (player.col < enemy.col ? -1 : 1);
        enemy.action = {
          type: "charge",
          col: Math.max(0, Math.min(grid.cols - 1, enemy.col + dx)),
          row: Math.max(0, Math.min(grid.rows - 1, enemy.row + dy)),
        };
        enemy.windup = 0.32;
        enemy.cd = 999;
        playTone(180, 0.035, "triangle", 0.014);
      }

      if (enemy.type === "turret" && enemy.cd <= 0) {
        const targetRow = enemy.dirJam > 0 ? Math.floor(Math.random() * grid.rows) : player.row;
        const dir = player.col < enemy.col ? -1 : 1;
        enemy.facing = dir;
        enemy.action = { type: "shoot", row: targetRow, dir, y: cellCenter(enemy.col, targetRow).y };
        enemy.windup = 0.52;
        enemy.cd = 999;
        playTone(240, 0.035, "sine", 0.014);
      }

      if (enemy.type === "worker" && enemy.cd <= 0) {
        if (!startLaneWork(enemy)) enemy.cd = 0.4;
      }

      if (enemy.type === "warden" && enemy.cd <= 0) {
        startWardenAction(enemy);
      }
    }

    const target = cellCenter(enemy.col, enemy.row);
    enemy.px += (target.x - enemy.px) * Math.min(1, dt * 8);
    enemy.py += (target.y - enemy.py) * Math.min(1, dt * 8);
  }
}

function updateProjectiles(dt) {
  for (const s of shots) s.x += s.vx * dt;

  for (const s of shots) {
    if (s.team === "player") {
      for (const o of obstacles) {
        const c = cellCenter(o.col, o.row);
        const key = `o:${o.col}:${o.row}`;
        if (o.hp > 0 && !s.hit.has(key) && Math.abs(s.x - c.x) < 42 && Math.abs(s.y - c.y) < 42) {
          s.hit.add(key);
          o.hp -= s.damage;
          o.flash = 0.12;
          if (s.pierce <= 0) s.dead = true;
          else s.pierce -= 1;
          shake = Math.max(shake, 5);
        }
      }
      for (const enemy of enemies) {
        const key = `e:${enemy.id}`;
        if (!s.hit.has(key) && Math.abs(s.x - enemy.px) < 38 && Math.abs(s.y - enemy.py) < 38) {
          s.hit.add(key);
          damageEnemy(enemy, s.damage);
          if (s.pierce <= 0) s.dead = true;
          else s.pierce -= 1;
        }
      }
    } else {
      let intercepted = false;
      for (const clone of clones) {
        if (Math.abs(s.x - clone.px) < 34 && Math.abs(s.y - clone.py) < 34) {
          clone.t = Math.min(clone.t, 0.08);
          sparks.push({ x: clone.px, y: clone.py, t: 0.2, color: "#7dff91" });
          s.dead = true;
          intercepted = true;
          playTone(420, 0.035, "triangle", 0.02);
          break;
        }
      }
      if (!intercepted && Math.abs(s.x - player.px) < 34 && Math.abs(s.y - player.py) < 34) {
        hurtPlayer(s.damage);
        s.dead = true;
      }
    }
  }

  for (let i = shots.length - 1; i >= 0; i--) {
    if (shots[i].dead || shots[i].x < 80 || shots[i].x > W - 80) shots.splice(i, 1);
  }
}

function updateAreaEffects(dt) {
  for (const clone of clones) clone.t -= dt;
  for (let i = clones.length - 1; i >= 0; i--) {
    if (clones[i].t <= 0) clones.splice(i, 1);
  }

  for (const pulse of pulses) pulse.t -= dt;
  for (let i = pulses.length - 1; i >= 0; i--) {
    if (pulses[i].t <= 0) pulses.splice(i, 1);
  }

  for (const slash of slashes) {
    slash.t -= dt;
    for (const enemy of enemies) {
      if (!slash.done && enemy.col === slash.col && enemy.row === slash.row) {
        damageEnemy(enemy, slash.damage, slash.knock || 0);
        slash.done = true;
      }
    }
  }
  for (let i = slashes.length - 1; i >= 0; i--) {
    if (slashes[i].t <= 0) slashes.splice(i, 1);
  }

  for (const zone of zones) {
    zone.t -= dt;
    zone.tick -= dt;
    if (zone.tick <= 0) {
      zone.tick = 0.28;
      for (const enemy of enemies) {
        if (enemy.col === zone.col && enemy.row === zone.row) {
          if (zone.jam) enemy.dirJam = Math.max(enemy.dirJam, 1.1);
          damageEnemy(enemy, zone.damage);
        }
      }
    }
  }
  for (let i = zones.length - 1; i >= 0; i--) {
    if (zones[i].t <= 0) zones.splice(i, 1);
  }

  for (const hazard of hazards) {
    hazard.t -= dt;
    hazard.tick -= dt;
    if (hazard.tick <= 0) {
      hazard.tick = 0.42;
      for (const cell of hazard.cells) {
        if (player.col === cell.col && player.row === cell.row) {
          hurtPlayer(hazard.damage);
          break;
        }
      }
    }
  }
  for (let i = hazards.length - 1; i >= 0; i--) {
    if (hazards[i].t <= 0) hazards.splice(i, 1);
  }

  for (const spark of sparks) spark.t -= dt;
  for (let i = sparks.length - 1; i >= 0; i--) {
    if (sparks[i].t <= 0) sparks.splice(i, 1);
  }
}

function pickUpgradeChoices() {
  const pool = [...upgradePool];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 3);
}

function openUpgradeSelection() {
  pendingWave = wave + 1;
  upgradeChoices = pickUpgradeChoices();
  upgradePending = true;
  message = `WAVE ${wave} CLEAR`;
  player.hp = Math.min(player.maxHp, player.hp + 10);
  playTone(540, 0.08, "triangle", 0.035);
}

function spawnWaveEnemies(level) {
  if (level >= MISSION_CLEAR_WAVE) {
    obstacles.splice(0, obstacles.length, { col: 2, row: 1, hp: 55, flash: 0 }, { col: 3, row: 4, hp: 55, flash: 0 });
    spawnEnemy("warden", 5, 2);
    message = "SIGNAL WARDEN ONLINE";
    return;
  }
  spawnRandomEnemy("charger");
  spawnRandomEnemy("turret");
  if (level >= 2) spawnRandomEnemy("worker");
  if (level % 2 === 0) spawnRandomEnemy("charger");
  if (level >= 4) spawnRandomEnemy("turret");
  if (level >= 5) spawnRandomEnemy("worker");
}

function selectUpgrade(index) {
  const choice = upgradeChoices[index];
  if (!upgradePending || !choice) return;
  choice.apply();
  runStats.upgrades += 1;
  upgradePending = false;
  upgradeChoices = [];
  wave = pendingWave;
  spawnTimer = 0.6;
  shots.length = 0;
  slashes.length = 0;
  zones.length = 0;
  hazards.length = 0;
  clones.length = 0;
  pulses.length = 0;
  message = `${choice.title} INSTALLED`;
  spawnWaveEnemies(wave);
  shake = Math.max(shake, 5);
  playTone(660, 0.09, "square", 0.034);
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
  const tenths = Math.floor((seconds % 1) * 10);
  return `${mins}:${secs}.${tenths}`;
}

function calculateRank(seconds, damageTaken, overclockUses) {
  let score = 100;
  score -= Math.max(0, seconds - 120) * 0.35;
  score -= damageTaken * 0.55;
  score += Math.min(overclockUses, 4) * 4;
  if (score >= 92) return "S";
  if (score >= 78) return "A";
  if (score >= 62) return "B";
  return "C";
}

function completeMission() {
  if (missionComplete) return;
  missionComplete = true;
  upgradePending = false;
  upgradeChoices = [];
  runStats.completedAt = performance.now();
  const seconds = Math.max(0, (runStats.completedAt - runStats.startedAt) / 1000);
  missionResult = {
    time: seconds,
    timeText: formatTime(seconds),
    damageTaken: Math.floor(runStats.damageTaken),
    overclockUses: runStats.overclockUses,
    upgrades: runStats.upgrades,
    rank: calculateRank(seconds, runStats.damageTaken, runStats.overclockUses),
  };
  shots.length = 0;
  slashes.length = 0;
  zones.length = 0;
  hazards.length = 0;
  clones.length = 0;
  pulses.length = 0;
  sparks.push({ x: player.px, y: player.py, t: 0.28, color: "#7dff91" });
  message = "MISSION COMPLETE";
  shake = Math.max(shake, 9);
  playTone(820, 0.16, "triangle", 0.055);
}

function updateUpgradeInput() {
  if (pressed.has("1")) selectUpgrade(0);
  if (pressed.has("2")) selectUpgrade(1);
  if (pressed.has("3")) selectUpgrade(2);
}

function updateWave(dt) {
  for (let i = enemies.length - 1; i >= 0; i--) {
    if (enemies[i].hp <= 0) enemies.splice(i, 1);
  }
  spawnTimer -= dt;
  if (enemies.length === 0 && spawnTimer <= 0 && !upgradePending) {
    if (wave >= MISSION_CLEAR_WAVE) completeMission();
    else openUpgradeSelection();
  }
}

function spawnRandomEnemy(type) {
  let fallback = null;
  let fallbackDistance = -1;
  for (let tries = 0; tries < 40; tries++) {
    const col = Math.floor(Math.random() * grid.cols);
    const row = Math.floor(Math.random() * grid.rows);
    const distance = Math.abs(col - player.col) + Math.abs(row - player.row);
    if (distance < 4 || isBlocked(col, row) || isEnemyCell(col, row) || isPlayerCell(col, row)) continue;
    spawnEnemy(type, col, row);
    return;
  }
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const distance = Math.abs(col - player.col) + Math.abs(row - player.row);
      if (isBlocked(col, row) || isEnemyCell(col, row) || isPlayerCell(col, row) || distance <= fallbackDistance) continue;
      fallback = { col, row };
      fallbackDistance = distance;
    }
  }
  if (fallback) spawnEnemy(type, fallback.col, fallback.row);
}

function update(dt) {
  if (hitstop > 0) {
    hitstop -= dt;
    dt *= 0.08;
  }
  shake = Math.max(0, shake - dt * 30);
  if (titleScreen) {
    hpEl.textContent = `HP ${Math.ceil(player.hp)}`;
    waveEl.textContent = "WAVE 1";
    if (syncEl) syncEl.textContent = "SYNC 0";
    pressed.clear();
    return;
  }
  if (gameOver || missionComplete) {
    hpEl.textContent = `HP ${Math.ceil(player.hp)}`;
    waveEl.textContent = `WAVE ${wave}`;
    if (syncEl) syncEl.textContent = player.overdrive > 0 ? "SYNC OVR" : `SYNC ${Math.floor(player.sync)}`;
    pressed.clear();
    return;
  }
  if (upgradePending) {
    updateUpgradeInput();
    hpEl.textContent = `HP ${Math.ceil(player.hp)}`;
    waveEl.textContent = `WAVE ${wave}`;
    if (syncEl) syncEl.textContent = player.overdrive > 0 ? "SYNC OVR" : `SYNC ${Math.floor(player.sync)}`;
    pressed.clear();
    return;
  }
  updatePlayer(dt);
  updateEnemies(dt);
  updateProjectiles(dt);
  updateAreaEffects(dt);
  updateWave(dt);
  hpEl.textContent = `HP ${Math.ceil(player.hp)}`;
  waveEl.textContent = `WAVE ${wave}`;
  if (syncEl) syncEl.textContent = player.overdrive > 0 ? "SYNC OVR" : `SYNC ${Math.floor(player.sync)}`;
  pressed.clear();
}

function drawGrid() {
  ctx.save();
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const x = grid.x + col * (grid.cell + grid.gap);
      const y = grid.y + row * (grid.cell + grid.gap);
      const parity = (col + row) % 2;
      ctx.fillStyle = parity ? "rgba(31, 123, 143, 0.18)" : "rgba(36, 54, 62, 0.32)";
      ctx.strokeStyle = "rgba(142, 245, 255, 0.38)";
      ctx.lineWidth = 2;
      ctx.fillRect(x, y, grid.cell, grid.cell);
      ctx.strokeRect(x + 0.5, y + 0.5, grid.cell - 1, grid.cell - 1);
    }
  }
  ctx.restore();
}

function drawHeroArt() {
  if (!heroArt.complete || heroArt.naturalWidth === 0) return;
  ctx.save();
  ctx.globalAlpha = 0.86;
  ctx.drawImage(heroArt, 85, 29, 305, 610, 24, 88, 214, 428);
  const gradient = ctx.createLinearGradient(24, 88, 238, 88);
  gradient.addColorStop(0, "rgba(7, 16, 20, 0)");
  gradient.addColorStop(0.78, "rgba(7, 16, 20, 0.14)");
  gradient.addColorStop(1, "rgba(7, 16, 20, 0.82)");
  ctx.fillStyle = gradient;
  ctx.fillRect(24, 88, 214, 428);
  ctx.strokeStyle = "rgba(142, 245, 255, 0.24)";
  ctx.lineWidth = 1;
  ctx.strokeRect(24.5, 88.5, 213, 427);
  ctx.restore();
}

function drawWardenArt() {
  if (!wardenArt.complete || wardenArt.naturalWidth === 0) return;
  const bossActive = enemies.some((enemy) => enemy.type === "warden" && enemy.hp > 0);
  ctx.save();
  ctx.globalAlpha = bossActive ? 0.9 : 0.42;
  ctx.drawImage(wardenArt, 74, 22, 364, 724, 724, 88, 212, 422);
  const gradient = ctx.createLinearGradient(724, 88, 936, 88);
  gradient.addColorStop(0, "rgba(7, 16, 20, 0.86)");
  gradient.addColorStop(0.22, "rgba(7, 16, 20, 0.16)");
  gradient.addColorStop(1, "rgba(7, 16, 20, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(724, 88, 212, 422);
  ctx.strokeStyle = bossActive ? "rgba(255, 91, 110, 0.52)" : "rgba(142, 245, 255, 0.18)";
  ctx.lineWidth = 1;
  ctx.strokeRect(724.5, 88.5, 211, 421);
  ctx.restore();
}

function drawRobot(x, y, color, enemy = false, flash = 0, dir = 1, turn = 0) {
  ctx.save();
  ctx.translate(x, y);
  if (turn > 0) {
    const progress = (0.22 - Math.min(turn, 0.22)) / 0.22;
    const pivot = Math.sin(progress * Math.PI);
    ctx.rotate(-dir * pivot * 0.12);
    ctx.scale(1 - pivot * 0.34, 1 + pivot * 0.06);
  }
  ctx.fillStyle = flash > 0 ? "#ffffff" : color;
  ctx.strokeStyle = enemy ? "#ffb0ba" : "#bff8ff";
  ctx.lineWidth = 3;
  ctx.fillRect(-24, -27, 48, 54);
  ctx.strokeRect(-24, -27, 48, 54);
  ctx.fillStyle = enemy ? "#ff5b6e" : "#46e4ff";
  ctx.fillRect(dir < 0 ? -19 : 5, -12, 14, 8);
  ctx.fillRect(-14, 31, 10, 10);
  ctx.fillRect(4, 31, 10, 10);
  ctx.restore();
}

function drawPlayerRobot(x, y, flash = 0, dir = 1, turn = 0) {
  ctx.save();
  ctx.translate(x, y);
  if (turn > 0) {
    const progress = (0.22 - Math.min(turn, 0.22)) / 0.22;
    const pivot = Math.sin(progress * Math.PI);
    ctx.rotate(-dir * pivot * 0.12);
    ctx.scale(1 - pivot * 0.34, 1 + pivot * 0.06);
  }

  const shell = flash > 0 ? "#ffffff" : player.overdrive > 0 ? "#d7b85a" : "#d8d1c0";
  const dark = "#1b2428";
  const teal = "#46e4ff";
  const yellow = "#ffd35a";

  ctx.lineWidth = 3;
  ctx.strokeStyle = "#bff8ff";
  ctx.fillStyle = dark;
  ctx.fillRect(-31, -14, 62, 44);
  ctx.strokeRect(-31, -14, 62, 44);

  ctx.fillStyle = shell;
  ctx.fillRect(-22, -26, 44, 34);
  ctx.strokeRect(-22, -26, 44, 34);
  ctx.fillRect(-18, 10, 14, 33);
  ctx.fillRect(4, 10, 14, 33);
  ctx.strokeRect(-18, 10, 14, 33);
  ctx.strokeRect(4, 10, 14, 33);

  ctx.fillStyle = shell;
  ctx.beginPath();
  ctx.moveTo(-21, -50);
  ctx.lineTo(21, -50);
  ctx.lineTo(27, -34);
  ctx.lineTo(18, -22);
  ctx.lineTo(-18, -22);
  ctx.lineTo(-27, -34);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = teal;
  ctx.shadowBlur = 12;
  ctx.shadowColor = teal;
  ctx.fillRect(dir < 0 ? -19 : 4, -40, 15, 13);
  ctx.shadowBlur = 0;

  ctx.fillStyle = yellow;
  ctx.fillRect(16, -64, 18, 13);
  ctx.strokeRect(16, -64, 18, 13);
  ctx.strokeStyle = teal;
  ctx.beginPath();
  ctx.arc(25, -58, 4, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "#ffd35a";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(dir * 24, -2);
  ctx.lineTo(dir * 49, 5);
  ctx.stroke();
  ctx.fillStyle = yellow;
  ctx.fillRect(dir * 34 - (dir < 0 ? 18 : 0), -7, 18, 19);
  ctx.strokeRect(dir * 34 - (dir < 0 ? 18 : 0), -7, 18, 19);

  ctx.strokeStyle = "#e8f7f8";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-dir * 24, 4);
  ctx.lineTo(-dir * 36, 31);
  ctx.stroke();

  ctx.fillStyle = "#11181b";
  ctx.fillRect(-24, 41, 18, 8);
  ctx.fillRect(6, 41, 18, 8);
  ctx.restore();
}

function drawWorkerRobot(enemy) {
  ctx.save();
  ctx.translate(enemy.px, enemy.py);
  ctx.fillStyle = enemy.flash > 0 ? "#ffffff" : "#5f4b28";
  ctx.strokeStyle = "#ffd35a";
  ctx.lineWidth = 3;
  ctx.fillRect(-25, -24, 50, 49);
  ctx.strokeRect(-25, -24, 50, 49);
  ctx.fillStyle = "#2c3438";
  ctx.fillRect(-18, -39, 36, 18);
  ctx.strokeRect(-18, -39, 36, 18);
  ctx.fillStyle = "#ffd35a";
  ctx.fillRect(-23, -43, 46, 7);
  ctx.fillStyle = "#46e4ff";
  ctx.fillRect(enemy.facing < 0 ? -15 : 5, -32, 10, 7);
  ctx.fillStyle = "#10171a";
  ctx.fillRect(-37, 1, 16, 33);
  ctx.fillRect(21, 1, 16, 33);
  ctx.strokeRect(-37, 1, 16, 33);
  ctx.strokeRect(21, 1, 16, 33);
  ctx.strokeStyle = "#ffd35a";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(enemy.facing * 21, -4);
  ctx.lineTo(enemy.facing * 42, 14);
  ctx.stroke();
  ctx.restore();
}

function drawWardenRobot(enemy) {
  ctx.save();
  ctx.translate(enemy.px, enemy.py);
  ctx.fillStyle = enemy.flash > 0 ? "#ffffff" : "#2a3437";
  ctx.strokeStyle = "#ff5b6e";
  ctx.lineWidth = 4;
  ctx.fillRect(-33, -34, 66, 68);
  ctx.strokeRect(-33, -34, 66, 68);
  ctx.fillStyle = "#3e4b4f";
  ctx.fillRect(-43, -13, 16, 40);
  ctx.fillRect(27, -13, 16, 40);
  ctx.strokeRect(-43, -13, 16, 40);
  ctx.strokeRect(27, -13, 16, 40);

  ctx.fillStyle = "#5b252e";
  ctx.beginPath();
  ctx.moveTo(-28, -55);
  ctx.lineTo(28, -55);
  ctx.lineTo(37, -36);
  ctx.lineTo(26, -24);
  ctx.lineTo(-26, -24);
  ctx.lineTo(-37, -36);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#ff5b6e";
  ctx.shadowBlur = 14;
  ctx.shadowColor = "#ff5b6e";
  ctx.fillRect(enemy.facing < 0 ? -24 : 8, -44, 16, 12);
  ctx.shadowBlur = 0;

  ctx.strokeStyle = "#ffd35a";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-22, -61);
  ctx.lineTo(-38, -78);
  ctx.moveTo(22, -61);
  ctx.lineTo(38, -78);
  ctx.stroke();

  ctx.fillStyle = "#ff5b6e";
  ctx.fillRect(-28, 34, 18, 12);
  ctx.fillRect(10, 34, 18, 12);
  ctx.fillStyle = "#ffd35a";
  ctx.fillRect(-8, -2, 16, 28);
  ctx.restore();
}

function drawEnemyTelegraphs() {
  for (const enemy of enemies) {
    if (!enemy.action || enemy.windup <= 0) continue;
    const pulse = 0.45 + Math.sin(performance.now() / 38) * 0.18;
    ctx.save();
    ctx.globalAlpha = Math.max(0.2, pulse);
    if (enemy.scanned > 0) ctx.globalAlpha = Math.max(0.55, pulse);
    if (enemy.action.type === "charge") {
      const c = cellCenter(enemy.action.col, enemy.action.row);
      const half = grid.cell / 2;
      ctx.fillStyle = "rgba(255, 91, 110, 0.24)";
      ctx.strokeStyle = "#ff5b6e";
      ctx.lineWidth = 5;
      ctx.fillRect(c.x - half, c.y - half, grid.cell, grid.cell);
      ctx.strokeRect(c.x - half + 5, c.y - half + 5, grid.cell - 10, grid.cell - 10);
      ctx.beginPath();
      ctx.moveTo(enemy.px - 28, enemy.py);
      ctx.lineTo(c.x + 28, c.y);
      ctx.stroke();
    }
    if (enemy.action.type === "shoot") {
      const cells = forwardRowCells(enemy.col, enemy.action.row, enemy.action.dir);
      ctx.fillStyle = "rgba(255, 91, 110, 0.28)";
      ctx.strokeStyle = "#ff5b6e";
      ctx.lineWidth = 5;
      for (const cell of cells) {
        const c = cellCenter(cell.col, cell.row);
        const half = grid.cell / 2;
        ctx.fillRect(c.x - half, c.y - half, grid.cell, grid.cell);
        ctx.strokeRect(c.x - half + 5, c.y - half + 5, grid.cell - 10, grid.cell - 10);
      }
      ctx.strokeStyle = "#ffd35a";
      ctx.lineWidth = 2;
      const edgeX = enemy.action.dir > 0 ? grid.x + grid.cols * (grid.cell + grid.gap) - grid.gap : grid.x;
      ctx.beginPath();
      ctx.moveTo(enemy.px + enemy.action.dir * 38, enemy.action.y);
      ctx.lineTo(edgeX, enemy.action.y);
      ctx.stroke();
    }
    if (enemy.action.type === "lane") {
      ctx.fillStyle = "rgba(255, 211, 90, 0.24)";
      ctx.strokeStyle = "#ffd35a";
      ctx.lineWidth = 4;
      for (const cell of enemy.action.cells) {
        const c = cellCenter(cell.col, cell.row);
        const half = grid.cell / 2;
        ctx.fillRect(c.x - half, c.y - half, grid.cell, grid.cell);
        ctx.strokeRect(c.x - half + 6, c.y - half + 6, grid.cell - 12, grid.cell - 12);
      }
    }
    if (enemy.action.type === "wardenBeam" || enemy.action.type === "wardenLane" || enemy.action.type === "wardenBarrier") {
      const isBeam = enemy.action.type === "wardenBeam";
      const isBarrier = enemy.action.type === "wardenBarrier";
      ctx.fillStyle = isBarrier ? "rgba(142, 245, 255, 0.18)" : isBeam ? "rgba(255, 91, 110, 0.28)" : "rgba(255, 211, 90, 0.24)";
      ctx.strokeStyle = isBarrier ? "#8ef5ff" : isBeam ? "#ff5b6e" : "#ffd35a";
      ctx.lineWidth = isBeam ? 5 : 4;
      for (const cell of enemy.action.cells) {
        const c = cellCenter(cell.col, cell.row);
        const half = grid.cell / 2;
        ctx.fillRect(c.x - half, c.y - half, grid.cell, grid.cell);
        ctx.strokeRect(c.x - half + 5, c.y - half + 5, grid.cell - 10, grid.cell - 10);
      }
    }
    ctx.restore();
  }
}

function draw() {
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#071014";
  ctx.fillRect(0, 0, W, H);
  ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

  ctx.fillStyle = "rgba(70,228,255,0.08)";
  for (let i = 0; i < 18; i++) {
    ctx.fillRect(70 + i * 50, 52 + ((performance.now() / 20 + i * 29) % 390), 18, 1);
  }

  drawHeroArt();
  drawWardenArt();
  drawGrid();

  for (const zone of zones) {
    const c = cellCenter(zone.col, zone.row);
    const half = grid.cell / 2;
    ctx.fillStyle = zone.jam ? "rgba(199, 125, 255, 0.18)" : "rgba(125, 255, 145, 0.22)";
    ctx.strokeStyle = zone.jam ? "rgba(199, 125, 255, 0.82)" : "rgba(125, 255, 145, 0.8)";
    ctx.lineWidth = 4;
    ctx.fillRect(c.x - half, c.y - half, grid.cell, grid.cell);
    ctx.strokeRect(c.x - half + 5, c.y - half + 5, grid.cell - 10, grid.cell - 10);
  }

  for (const hazard of hazards) {
    const pulse = 0.55 + Math.sin(performance.now() / 70) * 0.18;
    const isBeam = hazard.kind === "beam";
    for (const cell of hazard.cells) {
      const c = cellCenter(cell.col, cell.row);
      const half = grid.cell / 2;
      ctx.save();
      ctx.globalAlpha = Math.max(0.2, Math.min(0.9, pulse));
      ctx.fillStyle = isBeam ? "rgba(255, 91, 110, 0.33)" : "rgba(255, 211, 90, 0.22)";
      ctx.strokeStyle = isBeam ? "#ff5b6e" : "#ffd35a";
      ctx.lineWidth = 3;
      ctx.fillRect(c.x - half, c.y - half, grid.cell, grid.cell);
      ctx.strokeRect(c.x - half + 5, c.y - half + 5, grid.cell - 10, grid.cell - 10);
      ctx.strokeStyle = "rgba(255, 91, 110, 0.85)";
      ctx.lineWidth = 2;
      for (let i = -34; i < 34; i += 16) {
        ctx.beginPath();
        ctx.moveTo(c.x - half + i, c.y + half);
        ctx.lineTo(c.x - half + i + 42, c.y - half);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  for (const o of obstacles) {
    if (o.hp <= 0) continue;
    const c = cellCenter(o.col, o.row);
    ctx.fillStyle = o.flash > 0 ? "#ffffff" : "#5e7580";
    ctx.strokeStyle = "#aec7ce";
    ctx.lineWidth = 3;
    ctx.fillRect(c.x - 30, c.y - 30, 60, 60);
    ctx.strokeRect(c.x - 30, c.y - 30, 60, 60);
    o.flash = Math.max(0, o.flash - 1 / 60);
  }

  drawEnemyTelegraphs();

  for (const pulse of pulses) {
    const x = grid.x + pulse.from * (grid.cell + grid.gap);
    const y = grid.y + pulse.row * (grid.cell + grid.gap);
    const width = (pulse.to - pulse.from + 1) * grid.cell + (pulse.to - pulse.from) * grid.gap;
    const alpha = Math.max(0, pulse.t / pulse.max);
    ctx.save();
    ctx.globalAlpha = alpha;
    if (pulse.scan) {
      ctx.fillStyle = "rgba(125, 255, 145, 0.22)";
      ctx.strokeStyle = "#7dff91";
      ctx.lineWidth = 4;
    } else {
      ctx.fillStyle = pulse.overclock ? "rgba(255, 211, 90, 0.32)" : "rgba(70, 228, 255, 0.24)";
      ctx.strokeStyle = pulse.overclock ? "#ffd35a" : "#46e4ff";
      ctx.lineWidth = pulse.overclock ? 6 : 4;
    }
    ctx.fillRect(x, y, width, grid.cell);
    ctx.strokeRect(x + 4, y + 4, width - 8, grid.cell - 8);
    ctx.restore();
  }

  for (const slash of slashes) {
    const c = cellCenter(slash.col, slash.row);
    ctx.strokeStyle = "#f8ffff";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(c.x - 36, c.y + 34);
    ctx.lineTo(c.x + 36, c.y - 34);
    ctx.stroke();
  }

  for (const s of shots) {
    ctx.fillStyle = s.team === "player" ? "#46e4ff" : "#ff5b6e";
    ctx.shadowBlur = 18;
    ctx.shadowColor = ctx.fillStyle;
    if (s.beam) {
      ctx.fillRect(s.x - 54, s.y - 3, 108, 6);
    }
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  for (const enemy of enemies) {
    if (enemy.type === "warden") {
      drawWardenRobot(enemy);
    } else if (enemy.type === "worker") {
      drawWorkerRobot(enemy);
    } else {
      drawRobot(enemy.px, enemy.py, enemy.type === "charger" ? "#6b303b" : "#7c6635", true, enemy.flash, enemy.facing);
    }
    if (enemy.dirJam > 0) {
      ctx.strokeStyle = "#c77dff";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(enemy.px - 34, enemy.py - 34, 68, 68);
      ctx.setLineDash([]);
    }
    if (enemy.scanned > 0) {
      ctx.strokeStyle = "#7dff91";
      ctx.lineWidth = 3;
      ctx.strokeRect(enemy.px - 36, enemy.py - 36, 72, 72);
    }
    ctx.fillStyle = "#22070a";
    ctx.fillRect(enemy.px - 28, enemy.py - 43, 56, 6);
    ctx.fillStyle = "#ff5b6e";
    ctx.fillRect(enemy.px - 28, enemy.py - 43, 56 * Math.max(0, enemy.hp / enemy.maxHp), 6);
  }

  for (const clone of clones) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, clone.t / clone.max) * 0.55;
    drawRobot(clone.px, clone.py, "#2b8f78", false, 0, clone.facing);
    ctx.strokeStyle = "#7dff91";
    ctx.lineWidth = 2;
    ctx.strokeRect(clone.px - 32, clone.py - 35, 64, 70);
    ctx.restore();
  }

  if (player.turn > 0) {
    const progress = (0.22 - Math.min(player.turn, 0.22)) / 0.22;
    const alpha = Math.max(0, 1 - progress);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = player.facing < 0 ? "#ffd35a" : "#7dff91";
    ctx.lineWidth = 3;
    ctx.beginPath();
    if (player.facing < 0) {
      ctx.arc(player.px, player.py, 42, Math.PI * 0.18, Math.PI * 1.55, true);
    } else {
      ctx.arc(player.px, player.py, 42, Math.PI * 0.82, Math.PI * -0.55, false);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(player.px + player.facing * 43, player.py - 6);
    ctx.lineTo(player.px + player.facing * 31, player.py - 18);
    ctx.lineTo(player.px + player.facing * 31, player.py + 6);
    ctx.closePath();
    ctx.fillStyle = player.facing < 0 ? "#ffd35a" : "#7dff91";
    ctx.fill();
    ctx.restore();
  }

  if (player.invuln <= 0 || Math.floor(performance.now() / 70) % 2 === 0) {
    drawPlayerRobot(player.px, player.py, 0, player.facing, player.turn);
  }

  for (const spark of sparks) {
    ctx.fillStyle = spark.color;
    ctx.globalAlpha = Math.max(0, spark.t / 0.22);
    ctx.beginPath();
    ctx.arc(spark.x, spark.y, 30 * (1 - spark.t), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  drawOverlay();
  ctx.restore();
}

function drawOverlay() {
  ctx.fillStyle = "rgba(5, 10, 12, 0.70)";
  ctx.fillRect(24, 20, 912, 46);
  ctx.fillStyle = "#e8f7f8";
  ctx.font = "700 18px system-ui";
  ctx.fillText(message, 42, 50);
  ctx.fillStyle = player.facing < 0 ? "#ffd35a" : "#7dff91";
  ctx.font = "800 14px system-ui";
  ctx.fillText(player.facing < 0 ? "DIR <" : "DIR >", 310, 49);

  const phaseX = 334;
  ctx.fillStyle = "#0c171c";
  ctx.fillRect(phaseX, 26, 82, 30);
  ctx.strokeStyle = player.phaseCd > 0 ? "#526772" : player.sync >= 100 ? "#ffd35a" : "#7dff91";
  ctx.strokeRect(phaseX, 26, 82, 30);
  ctx.fillStyle = player.phaseCd > 0 ? "#78919a" : "#e8f7f8";
  ctx.font = "700 12px system-ui";
  ctx.fillText(player.sync >= 100 ? "F OVER" : "F PHASE", phaseX + 8, 46);
  if (player.phaseCd > 0) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(phaseX, 26, 82 * Math.min(1, player.phaseCd / 2.4), 30);
  }

  for (let i = 0; i < 4; i++) {
    const x = 430 + i * 122;
    const cooldown = chips[i].cooldown * player.chipCdMult;
    ctx.fillStyle = "#0c171c";
    ctx.fillRect(x, 26, 104, 30);
    ctx.strokeStyle = player.chipCd[i] > 0 ? "#526772" : "#46e4ff";
    ctx.strokeRect(x, 26, 104, 30);
    ctx.fillStyle = player.chipCd[i] > 0 ? "#78919a" : "#e8f7f8";
    ctx.font = "700 12px system-ui";
    ctx.fillText(`${i + 1} ${chips[i].label}`, x + 9, 46);
    if (player.chipCd[i] > 0) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(x, 26, 104 * Math.min(1, player.chipCd[i] / cooldown), 30);
    }
  }

  drawBossOverlay();

  if (titleScreen) {
    drawTitleOverlay();
  }

  if (upgradePending) {
    drawUpgradeOverlay();
  }

  if (missionComplete) {
    drawMissionCompleteOverlay();
  }

  if (gameOver) {
    ctx.fillStyle = "rgba(0,0,0,0.68)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#ff5b6e";
    ctx.font = "800 46px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("OPERATOR DOWN", W / 2, H / 2 - 10);
    ctx.fillStyle = "#e8f7f8";
    ctx.font = "700 18px system-ui";
    ctx.fillText("Press R to reboot combat simulation", W / 2, H / 2 + 30);
    ctx.textAlign = "left";
  }
}

function drawTitleOverlay() {
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.62)";
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = "center";
  ctx.fillStyle = "#e8f7f8";
  ctx.font = "900 56px system-ui";
  ctx.fillText("RoboGridStrike", W / 2, 168);
  ctx.fillStyle = "#8fa7ad";
  ctx.font = "800 16px system-ui";
  ctx.fillText("6x6 Infrastructure Combat Mission", W / 2, 198);

  const buttonX = W / 2 - 128;
  const buttonY = 250;
  const buttonW = 256;
  const buttonH = 58;
  const pulse = 0.7 + Math.sin(performance.now() / 180) * 0.18;
  ctx.fillStyle = "rgba(12, 23, 28, 0.96)";
  ctx.fillRect(buttonX, buttonY, buttonW, buttonH);
  ctx.strokeStyle = `rgba(125, 255, 145, ${pulse})`;
  ctx.lineWidth = 3;
  ctx.strokeRect(buttonX + 0.5, buttonY + 0.5, buttonW - 1, buttonH - 1);
  ctx.fillStyle = "#7dff91";
  ctx.font = "900 22px system-ui";
  ctx.fillText("START MISSION", W / 2, buttonY + 37);

  ctx.fillStyle = "#e8f7f8";
  ctx.font = "800 14px system-ui";
  ctx.fillText("ENTER / SPACE / TAP", W / 2, buttonY + 92);

  ctx.fillStyle = "#8fa7ad";
  ctx.font = "700 13px system-ui";
  ctx.fillText("Move  Turn  Phase  Gun  Sword  Chips", W / 2, 438);
  ctx.textAlign = "left";
  ctx.restore();
}

function drawBossOverlay() {
  const boss = enemies.find((enemy) => enemy.type === "warden" && enemy.hp > 0);
  if (!boss) return;
  const x = 248;
  const y = 70;
  const w = 466;
  const h = 16;
  ctx.save();
  ctx.fillStyle = "rgba(20, 7, 10, 0.90)";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#ff5b6e";
  ctx.fillRect(x, y, w * Math.max(0, boss.hp / boss.maxHp), h);
  ctx.strokeStyle = "#ffd35a";
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = "#e8f7f8";
  ctx.font = "800 12px system-ui";
  ctx.textAlign = "center";
  ctx.fillText("SIGNAL WARDEN", x + w / 2, y - 5);
  ctx.textAlign = "left";
  ctx.restore();
}

function drawMissionCompleteOverlay() {
  if (!missionResult) return;
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#7dff91";
  ctx.font = "900 42px system-ui";
  ctx.textAlign = "center";
  ctx.fillText("MISSION COMPLETE", W / 2, 135);
  ctx.fillStyle = "#e8f7f8";
  ctx.font = "800 72px system-ui";
  ctx.fillText(`RANK ${missionResult.rank}`, W / 2, 226);

  const x = W / 2 - 190;
  const y = 278;
  const rows = [
    ["Clear Time", missionResult.timeText],
    ["Damage Taken", String(missionResult.damageTaken)],
    ["Overclocks", String(missionResult.overclockUses)],
    ["Modules", String(missionResult.upgrades)],
  ];
  ctx.textAlign = "left";
  ctx.font = "800 18px system-ui";
  for (let i = 0; i < rows.length; i++) {
    const rowY = y + i * 34;
    ctx.fillStyle = "#8fa7ad";
    ctx.fillText(rows[i][0], x, rowY);
    ctx.fillStyle = "#e8f7f8";
    ctx.fillText(rows[i][1], x + 230, rowY);
  }

  ctx.fillStyle = "#ffd35a";
  ctx.font = "800 17px system-ui";
  ctx.textAlign = "center";
  ctx.fillText("Press R to reboot the mission", W / 2, 455);
  ctx.restore();
}

function drawUpgradeOverlay() {
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.70)";
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#e8f7f8";
  ctx.font = "800 34px system-ui";
  ctx.textAlign = "center";
  ctx.fillText("FIELD UPGRADE", W / 2, 142);
  ctx.fillStyle = "#8fa7ad";
  ctx.font = "700 15px system-ui";
  ctx.fillText(`Wave ${wave} clear. Choose a module for Wave ${pendingWave}.`, W / 2, 172);

  const cardW = 250;
  const cardH = 138;
  const startX = W / 2 - cardW * 1.5 - 18;
  for (let i = 0; i < upgradeChoices.length; i++) {
    const x = startX + i * (cardW + 18);
    const y = 220;
    ctx.fillStyle = "rgba(12, 23, 28, 0.94)";
    ctx.fillRect(x, y, cardW, cardH);
    ctx.strokeStyle = i === 0 ? "#7dff91" : i === 1 ? "#46e4ff" : "#ffd35a";
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 0.5, y + 0.5, cardW - 1, cardH - 1);

    ctx.fillStyle = ctx.strokeStyle;
    ctx.font = "800 16px system-ui";
    ctx.textAlign = "left";
    ctx.fillText(`${i + 1}`, x + 18, y + 30);
    ctx.fillStyle = "#e8f7f8";
    ctx.font = "800 20px system-ui";
    ctx.fillText(upgradeChoices[i].title, x + 48, y + 34);
    ctx.fillStyle = "#b6c9ce";
    ctx.font = "700 15px system-ui";
    ctx.fillText(upgradeChoices[i].detail, x + 18, y + 76);
    ctx.fillStyle = "#526772";
    ctx.font = "700 12px system-ui";
    ctx.fillText("Press key or tap chip slot", x + 18, y + 112);
  }

  ctx.textAlign = "left";
  ctx.restore();
}

function loop(now) {
  const dt = Math.min(0.033, (now - lastTime) / 1000);
  lastTime = now;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

function restart() {
  player.col = 1;
  player.row = 3;
  player.maxHp = 100;
  player.hp = player.maxHp;
  player.invuln = 0;
  player.gunCd = 0;
  player.swordCd = 0;
  player.phaseCd = 0;
  player.sync = 0;
  player.overdrive = 0;
  player.turn = 0;
  player.gunBonus = 0;
  player.swordBonus = 0;
  player.phaseCdMult = 1;
  player.chipCdMult = 1;
  player.syncGainMult = 1;
  player.chipCd = [0, 0, 0, 0];
  player.facing = 1;
  const p = cellCenter(player.col, player.row);
  player.px = p.x;
  player.py = p.y;
  shots.length = 0;
  slashes.length = 0;
  zones.length = 0;
  hazards.length = 0;
  clones.length = 0;
  pulses.length = 0;
  sparks.length = 0;
  enemies.length = 0;
  obstacles.splice(0, obstacles.length, { col: 2, row: 2, hp: 45, flash: 0 }, { col: 3, row: 4, hp: 45, flash: 0 });
  wave = 1;
  spawnTimer = 0;
  hitstop = 0;
  shake = 0;
  nextEnemyId = 1;
  pendingWave = 1;
  upgradePending = false;
  upgradeChoices = [];
  titleScreen = false;
  gameOver = false;
  missionComplete = false;
  missionResult = null;
  runStats.startedAt = performance.now();
  runStats.completedAt = 0;
  runStats.damageTaken = 0;
  runStats.overclockUses = 0;
  runStats.upgrades = 0;
  message = "SYSTEM ONLINE";
  spawnEnemy("charger", 4, 1);
  spawnEnemy("worker", 5, 3);
  spawnEnemy("turret", 5, 5);
}

window.addEventListener("keydown", (event) => {
  armAudio();
  const key = event.key.toLowerCase();
  if (!keys.has(key)) pressed.add(key);
  keys.add(key);
  if ([" ", "enter", "tab", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) event.preventDefault();
  if (titleScreen && (key === "enter" || key === " " || key === "j" || key === "z")) startMission();
  if (key === "r") restart();
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.key.toLowerCase());
});

canvas.addEventListener("pointerdown", () => {
  armAudio();
  if (titleScreen) startMission();
});

function performTouchAction(action) {
  armAudio();
  if (titleScreen) {
    startMission();
    return;
  }
  if (missionComplete) {
    if (action === "restart") restart();
    return;
  }
  if (upgradePending) {
    if (action === "chip0") selectUpgrade(0);
    if (action === "chip1") selectUpgrade(1);
    if (action === "chip2") selectUpgrade(2);
    if (action === "restart") restart();
    return;
  }
  if (gameOver && action !== "restart") return;
  if (action === "up") tryMove(0, -1);
  if (action === "down") tryMove(0, 1);
  if (action === "left") tryMove(-1, 0);
  if (action === "right") tryMove(1, 0);
  if (action === "turn") flipPlayer();
  if (action === "phase") phaseShift();
  if (action === "dash") dashPlayer();
  if (action === "gun") fireGun();
  if (action === "sword") swingSword();
  if (action === "chip0") useChip(0);
  if (action === "chip1") useChip(1);
  if (action === "chip2") useChip(2);
  if (action === "chip3") useChip(3);
  if (action === "restart") restart();
}

for (const button of touchButtons) {
  let repeat = null;
  const action = button.dataset.action;
  const interval = button.dataset.hold === "true" ? 100 : 170;
  const start = (event) => {
    event.preventDefault();
    button.classList.add("is-down");
    performTouchAction(action);
    if (repeat) clearInterval(repeat);
    if (["up", "down", "left", "right", "gun"].includes(action)) {
      repeat = setInterval(() => performTouchAction(action), interval);
    }
  };
  const stop = (event) => {
    event.preventDefault();
    button.classList.remove("is-down");
    if (repeat) clearInterval(repeat);
    repeat = null;
  };
  button.addEventListener("pointerdown", start);
  button.addEventListener("pointerup", stop);
  button.addEventListener("pointercancel", stop);
  button.addEventListener("pointerleave", stop);
}

init();
requestAnimationFrame(loop);
