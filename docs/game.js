"use strict";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const hpEl = document.getElementById("hp");
const waveEl = document.getElementById("wave");
const touchButtons = document.querySelectorAll("[data-action]");

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

const keys = new Set();
const pressed = new Set();
const shots = [];
const slashes = [];
const zones = [];
const clones = [];
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

let audioCtx = null;
let lastTime = performance.now();
let hitstop = 0;
let shake = 0;
let gameOver = false;
let wave = 1;
let spawnTimer = 0;
let message = "SYSTEM ONLINE";
let nextEnemyId = 1;

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
  spawnEnemy("charger", 4, 1);
  spawnEnemy("turret", 5, 4);
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
  enemies.push({
    id: nextEnemyId++,
    type,
    col,
    row,
    px: p.x,
    py: p.y,
    hp: type === "charger" ? 75 : 60,
    maxHp: type === "charger" ? 75 : 60,
    cd: type === "charger" ? 0.9 : 1.4,
    windup: 0,
    action: null,
    stun: 0,
    flash: 0,
    dirJam: 0,
    facing: -1,
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

function dashPlayer() {
  player.dash = 0.12;
  tryMove(player.facing, 0);
  shake = Math.max(shake, 4);
  playTone(220, 0.035, "triangle", 0.016);
}

function damageEnemy(enemy, amount, knock = 0) {
  enemy.hp -= amount;
  enemy.flash = 0.12;
  enemy.stun = Math.max(enemy.stun, 0.08);
  const nextCol = Math.max(0, Math.min(grid.cols - 1, enemy.col + knock));
  if (knock && !isBlocked(nextCol, enemy.row) && !isEnemyCell(nextCol, enemy.row, enemy.id) && !isPlayerCell(nextCol, enemy.row)) {
    enemy.col = nextCol;
  }
  const p = cellCenter(enemy.col, enemy.row);
  enemy.px = p.x;
  enemy.py = p.y;
  hitstop = Math.max(hitstop, 0.055);
  shake = Math.max(shake, 8);
  sparks.push({ x: enemy.px, y: enemy.py, t: 0.18, color: "#ffd35a" });
  playTone(160, 0.045, "sawtooth", 0.035);
}

function hurtPlayer(amount) {
  if (player.invuln > 0 || gameOver) return;
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
  player.facing = dir;
  message = dir < 0 ? "FACING LEFT" : "FACING RIGHT";
}

function flipPlayer() {
  turnPlayer(player.facing * -1);
}

function fireGun() {
  if (player.gunCd > 0 || gameOver) return;
  player.gunCd = 0.18;
  const p = cellCenter(player.col, player.row);
  shots.push({ x: p.x + player.facing * 34, y: p.y, vx: player.facing * 720, damage: 10, team: "player", pierce: 0, r: 7, hit: new Set() });
  sparks.push({ x: p.x + player.facing * 24, y: p.y, t: 0.08, color: "#46e4ff" });
  playTone(510, 0.035, "square", 0.018);
}

function swingSword() {
  if (player.swordCd > 0 || gameOver) return;
  const col = player.col + player.facing;
  if (!inBounds(col, player.row)) return;
  player.swordCd = 0.38;
  slashes.push({ col, row: player.row, t: 0.16, damage: 34, knock: player.facing });
  message = "EDGE STRIKE";
  playTone(760, 0.06, "triangle", 0.045);
}

function useChip(i) {
  if (player.chipCd[i] > 0 || gameOver) return;
  if (i === 0) {
    player.chipCd[i] = chips[i].cooldown;
    const p = cellCenter(player.col, player.row);
    shots.push({ x: p.x + player.facing * 36, y: p.y, vx: player.facing * 1120, damage: 24, team: "player", pierce: 4, r: 10, beam: true, hit: new Set() });
    message = "LiDAR SWEEP";
    playTone(620, 0.08, "sawtooth", 0.042);
  } else if (i === 1) {
    player.chipCd[i] = chips[i].cooldown;
    const col = player.col + player.facing;
    for (let row = player.row - 1; row <= player.row + 1; row++) {
      if (inBounds(col, row)) zones.push({ col, row, t: 1.2, tick: row === player.row ? 0 : 0.08, damage: 9, jam: false });
    }
    message = "ARC SNARE";
    playTone(420, 0.09, "sine", 0.038);
  } else if (i === 2) {
    player.chipCd[i] = chips[i].cooldown;
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
      slashes.push({ col: player.col + player.facing, row: player.row, t: 0.16, damage: 36, knock: player.facing });
    }
    message = "VECTOR CLONE";
    shake = 7;
    playTone(360, 0.07, "square", 0.035);
  } else if (i === 3) {
    player.chipCd[i] = chips[i].cooldown;
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
  player.gunCd = Math.max(0, player.gunCd - dt);
  player.swordCd = Math.max(0, player.swordCd - dt);
  player.invuln = Math.max(0, player.invuln - dt);
  player.dash = Math.max(0, player.dash - dt);
  player.chipCd = player.chipCd.map((v) => Math.max(0, v - dt));

  if (pressed.has("q")) turnPlayer(-1);
  if (pressed.has("e")) turnPlayer(1);
  if (pressed.has("c") || pressed.has("tab")) flipPlayer();

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
          const p = cellCenter(enemy.col, enemy.row);
          shots.push({ x: p.x + enemy.action.dir * 36, y: enemy.action.y, vx: enemy.action.dir * 560, damage: 12, team: "enemy", pierce: 0, r: 8, hit: new Set() });
          enemy.cd = 1.25 + Math.random() * 0.5;
          playTone(300, 0.04, "square", 0.018);
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
        const p = cellCenter(enemy.col, enemy.row);
        const targetRow = enemy.dirJam > 0 ? Math.floor(Math.random() * grid.rows) : player.row;
        const target = cellCenter(enemy.col, targetRow);
        const dir = player.col < enemy.col ? -1 : 1;
        enemy.facing = dir;
        enemy.action = { type: "shoot", y: target.y, dir };
        enemy.windup = 0.42;
        enemy.cd = 999;
        playTone(240, 0.035, "sine", 0.014);
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

  for (const spark of sparks) spark.t -= dt;
  for (let i = sparks.length - 1; i >= 0; i--) {
    if (sparks[i].t <= 0) sparks.splice(i, 1);
  }
}

function updateWave(dt) {
  for (let i = enemies.length - 1; i >= 0; i--) {
    if (enemies[i].hp <= 0) enemies.splice(i, 1);
  }
  spawnTimer -= dt;
  if (enemies.length === 0 && spawnTimer <= 0) {
    wave += 1;
    spawnTimer = 0.5;
    spawnRandomEnemy("charger");
    spawnRandomEnemy("turret");
    if (wave % 2 === 0) spawnRandomEnemy("charger");
    message = `WAVE ${wave}`;
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
  if (gameOver) {
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

function drawRobot(x, y, color, enemy = false, flash = 0, dir = 1) {
  ctx.save();
  ctx.translate(x, y);
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

function drawEnemyTelegraphs() {
  for (const enemy of enemies) {
    if (!enemy.action || enemy.windup <= 0) continue;
    const pulse = 0.45 + Math.sin(performance.now() / 38) * 0.18;
    ctx.save();
    ctx.globalAlpha = Math.max(0.2, pulse);
    if (enemy.action.type === "charge") {
      const c = cellCenter(enemy.action.col, enemy.action.row);
      ctx.fillStyle = "rgba(255, 91, 110, 0.24)";
      ctx.strokeStyle = "#ff5b6e";
      ctx.lineWidth = 5;
      ctx.fillRect(c.x - 56, c.y - 56, 112, 112);
      ctx.strokeRect(c.x - 50, c.y - 50, 100, 100);
      ctx.beginPath();
      ctx.moveTo(enemy.px - 28, enemy.py);
      ctx.lineTo(c.x + 28, c.y);
      ctx.stroke();
    }
    if (enemy.action.type === "shoot") {
      ctx.strokeStyle = "#ff5b6e";
      ctx.lineWidth = 5;
      const edgeX = enemy.action.dir > 0 ? grid.x + grid.cols * (grid.cell + grid.gap) - grid.gap : grid.x;
      ctx.beginPath();
      ctx.moveTo(enemy.px + enemy.action.dir * 38, enemy.action.y);
      ctx.lineTo(edgeX, enemy.action.y);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#ffd35a";
      ctx.beginPath();
      ctx.moveTo(enemy.px + enemy.action.dir * 38, enemy.action.y - 9);
      ctx.lineTo(edgeX, enemy.action.y - 9);
      ctx.moveTo(enemy.px + enemy.action.dir * 38, enemy.action.y + 9);
      ctx.lineTo(edgeX, enemy.action.y + 9);
      ctx.stroke();
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

  drawGrid();

  for (const zone of zones) {
    const c = cellCenter(zone.col, zone.row);
    ctx.fillStyle = zone.jam ? "rgba(199, 125, 255, 0.18)" : "rgba(125, 255, 145, 0.22)";
    ctx.strokeStyle = zone.jam ? "rgba(199, 125, 255, 0.82)" : "rgba(125, 255, 145, 0.8)";
    ctx.lineWidth = 4;
    ctx.fillRect(c.x - 56, c.y - 56, 112, 112);
    ctx.strokeRect(c.x - 50, c.y - 50, 100, 100);
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
    drawRobot(enemy.px, enemy.py, enemy.type === "charger" ? "#6b303b" : "#7c6635", true, enemy.flash, enemy.facing);
    if (enemy.dirJam > 0) {
      ctx.strokeStyle = "#c77dff";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(enemy.px - 34, enemy.py - 34, 68, 68);
      ctx.setLineDash([]);
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

  if (player.invuln <= 0 || Math.floor(performance.now() / 70) % 2 === 0) {
    drawRobot(player.px, player.py, player.dash > 0 ? "#7dff91" : "#1d5d6e", false, 0, player.facing);
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

  for (let i = 0; i < 4; i++) {
    const x = 430 + i * 122;
    ctx.fillStyle = "#0c171c";
    ctx.fillRect(x, 26, 104, 30);
    ctx.strokeStyle = player.chipCd[i] > 0 ? "#526772" : "#46e4ff";
    ctx.strokeRect(x, 26, 104, 30);
    ctx.fillStyle = player.chipCd[i] > 0 ? "#78919a" : "#e8f7f8";
    ctx.font = "700 12px system-ui";
    ctx.fillText(`${i + 1} ${chips[i].label}`, x + 9, 46);
    if (player.chipCd[i] > 0) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(x, 26, 104 * Math.min(1, player.chipCd[i] / chips[i].cooldown), 30);
    }
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
  player.hp = player.maxHp;
  player.invuln = 0;
  player.gunCd = 0;
  player.swordCd = 0;
  player.chipCd = [0, 0, 0, 0];
  player.facing = 1;
  const p = cellCenter(player.col, player.row);
  player.px = p.x;
  player.py = p.y;
  shots.length = 0;
  slashes.length = 0;
  zones.length = 0;
  clones.length = 0;
  sparks.length = 0;
  enemies.length = 0;
  obstacles.splice(0, obstacles.length, { col: 2, row: 2, hp: 45, flash: 0 }, { col: 3, row: 4, hp: 45, flash: 0 });
  wave = 1;
  gameOver = false;
  message = "SYSTEM ONLINE";
  spawnEnemy("charger", 4, 1);
  spawnEnemy("turret", 5, 4);
}

window.addEventListener("keydown", (event) => {
  armAudio();
  const key = event.key.toLowerCase();
  if (!keys.has(key)) pressed.add(key);
  keys.add(key);
  if ([" ", "tab", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) event.preventDefault();
  if (key === "r") restart();
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.key.toLowerCase());
});

function performTouchAction(action) {
  armAudio();
  if (gameOver && action !== "restart") return;
  if (action === "up") tryMove(0, -1);
  if (action === "down") tryMove(0, 1);
  if (action === "left") tryMove(-1, 0);
  if (action === "right") tryMove(1, 0);
  if (action === "turn") flipPlayer();
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
