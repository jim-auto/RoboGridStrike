"use strict";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const hpEl = document.getElementById("hp");
const waveEl = document.getElementById("wave");

const W = canvas.width;
const H = canvas.height;
const grid = {
  x: 132,
  y: 102,
  cols: 6,
  rows: 3,
  cell: 112,
  gap: 8,
};

const keys = new Set();
const pressed = new Set();
const shots = [];
const slashes = [];
const zones = [];
const sparks = [];
const enemies = [];
const obstacles = [{ col: 2, row: 1, hp: 45, flash: 0 }];

let audioCtx = null;
let lastTime = performance.now();
let hitstop = 0;
let shake = 0;
let gameOver = false;
let wave = 1;
let spawnTimer = 0;
let message = "SYSTEM ONLINE";

const player = {
  col: 1,
  row: 1,
  px: 0,
  py: 0,
  hp: 100,
  maxHp: 100,
  invuln: 0,
  dash: 0,
  fireCd: 0,
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
  spawnEnemy("charger", 4, 0);
  spawnEnemy("turret", 5, 2);
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
    type,
    col,
    row,
    px: p.x,
    py: p.y,
    hp: type === "charger" ? 75 : 60,
    maxHp: type === "charger" ? 75 : 60,
    cd: type === "charger" ? 0.9 : 1.4,
    stun: 0,
    flash: 0,
    dirJam: 0,
  });
}

function isBlocked(col, row) {
  return obstacles.some((o) => o.hp > 0 && o.col === col && o.row === row);
}

function clampPlayer() {
  player.col = Math.max(0, Math.min(2, player.col));
  player.row = Math.max(0, Math.min(2, player.row));
}

function tryMove(dx, dy) {
  if (dx > 0) player.facing = 1;
  if (dx < 0) player.facing = -1;
  const nextCol = player.col + dx;
  const nextRow = player.row + dy;
  if (nextCol < 0 || nextCol > 2 || nextRow < 0 || nextRow > 2) return;
  if (isBlocked(nextCol, nextRow)) return;
  player.col = nextCol;
  player.row = nextRow;
}

function damageEnemy(enemy, amount, knock = 0) {
  enemy.hp -= amount;
  enemy.flash = 0.12;
  enemy.stun = Math.max(enemy.stun, 0.08);
  enemy.col = Math.max(3, Math.min(5, enemy.col + knock));
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

function fireBuster() {
  if (player.fireCd > 0 || gameOver) return;
  player.fireCd = 0.18;
  const p = cellCenter(player.col, player.row);
  shots.push({ x: p.x + 34, y: p.y, vx: 720, damage: 10, team: "player", pierce: 0, r: 7 });
  sparks.push({ x: p.x + 24, y: p.y, t: 0.08, color: "#46e4ff" });
  playTone(510, 0.035, "square", 0.018);
}

function useChip(i) {
  if (player.chipCd[i] > 0 || gameOver) return;
  if (i === 0) {
    player.chipCd[i] = 1.15;
    const p = cellCenter(player.col, player.row);
    shots.push({ x: p.x + 36, y: p.y, vx: 980, damage: 32, team: "player", pierce: 0, r: 12 });
    message = "CANNON";
    playTone(140, 0.09, "sawtooth", 0.05);
  } else if (i === 1) {
    player.chipCd[i] = 1.45;
    slashes.push({ col: player.col + 1, row: player.row, t: 0.15, damage: 42 });
    message = "KINETIC SWORD";
    playTone(760, 0.06, "triangle", 0.045);
  } else if (i === 2) {
    player.chipCd[i] = 2.2;
    player.dash = 0.16;
    const oldCol = player.col;
    player.col = Math.min(2, player.col + 2);
    if (isBlocked(player.col, player.row)) player.col = oldCol;
    slashes.push({ col: player.col + 1, row: player.row, t: 0.16, damage: 36 });
    message = "MPPI DASH STRIKE";
    shake = 7;
    playTone(360, 0.07, "square", 0.035);
  } else if (i === 3) {
    player.chipCd[i] = 4.0;
    zones.push({ col: 3, row: player.row, t: 2.6, tick: 0, damage: 8 });
    zones.push({ col: 4, row: player.row, t: 2.6, tick: 0.12, damage: 8 });
    message = "AREA CONTROL";
    playTone(250, 0.12, "sine", 0.04);
  }
}

function updatePlayer(dt) {
  player.fireCd = Math.max(0, player.fireCd - dt);
  player.invuln = Math.max(0, player.invuln - dt);
  player.dash = Math.max(0, player.dash - dt);
  player.chipCd = player.chipCd.map((v) => Math.max(0, v - dt));

  let dx = 0;
  let dy = 0;
  if (pressed.has("arrowleft") || pressed.has("a")) dx -= 1;
  if (pressed.has("arrowright") || pressed.has("d")) dx += 1;
  if (pressed.has("arrowup") || pressed.has("w")) dy -= 1;
  if (pressed.has("arrowdown") || pressed.has("s")) dy += 1;
  if (dx || dy) tryMove(dx, dy);

  if (pressed.has(" ") || pressed.has("shift")) {
    player.dash = 0.12;
    tryMove(player.facing, 0);
    shake = Math.max(shake, 4);
    playTone(220, 0.035, "triangle", 0.016);
  }
  if (keys.has("j") || keys.has("z")) fireBuster();
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

    if (enemy.type === "charger" && enemy.cd <= 0) {
      enemy.cd = 1.0 + Math.random() * 0.45;
      const rowDelta = enemy.dirJam > 0 ? Math.sign(Math.random() - 0.5) : Math.sign(player.row - enemy.row);
      if (rowDelta && Math.random() < 0.55) enemy.row = Math.max(0, Math.min(2, enemy.row + rowDelta));
      else enemy.col = Math.max(3, enemy.col - 1);
      if (enemy.col === player.col && enemy.row === player.row) hurtPlayer(18);
      if (enemy.col <= 2) enemy.col = 4;
    }

    if (enemy.type === "turret" && enemy.cd <= 0) {
      enemy.cd = 1.25 + Math.random() * 0.5;
      const p = cellCenter(enemy.col, enemy.row);
      shots.push({ x: p.x - 36, y: p.y, vx: -560, damage: 12, team: "enemy", pierce: 0, r: 8 });
      playTone(300, 0.04, "square", 0.018);
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
        if (o.hp > 0 && Math.abs(s.x - c.x) < 42 && Math.abs(s.y - c.y) < 42) {
          o.hp -= s.damage;
          o.flash = 0.12;
          s.dead = true;
          shake = Math.max(shake, 5);
        }
      }
      for (const enemy of enemies) {
        if (Math.abs(s.x - enemy.px) < 38 && Math.abs(s.y - enemy.py) < 38) {
          damageEnemy(enemy, s.damage);
          if (s.pierce <= 0) s.dead = true;
          else s.pierce -= 1;
        }
      }
    } else if (Math.abs(s.x - player.px) < 34 && Math.abs(s.y - player.py) < 34) {
      hurtPlayer(s.damage);
      s.dead = true;
    }
  }

  for (let i = shots.length - 1; i >= 0; i--) {
    if (shots[i].dead || shots[i].x < 80 || shots[i].x > W - 80) shots.splice(i, 1);
  }
}

function updateAreaEffects(dt) {
  for (const slash of slashes) {
    slash.t -= dt;
    for (const enemy of enemies) {
      if (!slash.done && enemy.col === slash.col && enemy.row === slash.row) {
        damageEnemy(enemy, slash.damage, 1);
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
        if (enemy.col === zone.col && enemy.row === zone.row) damageEnemy(enemy, zone.damage);
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
    spawnEnemy("charger", 5, Math.floor(Math.random() * 3));
    spawnEnemy("turret", 4 + Math.floor(Math.random() * 2), Math.floor(Math.random() * 3));
    if (wave % 2 === 0) spawnEnemy("charger", 5, Math.floor(Math.random() * 3));
    message = `WAVE ${wave}`;
  }
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
      const playerSide = col <= 2;
      ctx.fillStyle = playerSide ? "rgba(31, 123, 143, 0.22)" : "rgba(120, 47, 58, 0.22)";
      ctx.strokeStyle = playerSide ? "rgba(70, 228, 255, 0.55)" : "rgba(255, 91, 110, 0.50)";
      ctx.lineWidth = 2;
      ctx.fillRect(x, y, grid.cell, grid.cell);
      ctx.strokeRect(x + 0.5, y + 0.5, grid.cell - 1, grid.cell - 1);
    }
  }
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.setLineDash([8, 8]);
  ctx.beginPath();
  const split = grid.x + 3 * (grid.cell + grid.gap) - grid.gap / 2;
  ctx.moveTo(split, grid.y - 14);
  ctx.lineTo(split, grid.y + grid.rows * (grid.cell + grid.gap) - grid.gap + 14);
  ctx.stroke();
  ctx.restore();
}

function drawRobot(x, y, color, enemy = false, flash = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = flash > 0 ? "#ffffff" : color;
  ctx.strokeStyle = enemy ? "#ffb0ba" : "#bff8ff";
  ctx.lineWidth = 3;
  ctx.fillRect(-24, -27, 48, 54);
  ctx.strokeRect(-24, -27, 48, 54);
  ctx.fillStyle = enemy ? "#ff5b6e" : "#46e4ff";
  ctx.fillRect(enemy ? -19 : 5, -12, 14, 8);
  ctx.fillRect(-14, 31, 10, 10);
  ctx.fillRect(4, 31, 10, 10);
  ctx.restore();
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
    ctx.fillStyle = "rgba(125, 255, 145, 0.22)";
    ctx.strokeStyle = "rgba(125, 255, 145, 0.8)";
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
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  for (const enemy of enemies) {
    drawRobot(enemy.px, enemy.py, enemy.type === "charger" ? "#6b303b" : "#7c6635", true, enemy.flash);
    ctx.fillStyle = "#22070a";
    ctx.fillRect(enemy.px - 28, enemy.py - 43, 56, 6);
    ctx.fillStyle = "#ff5b6e";
    ctx.fillRect(enemy.px - 28, enemy.py - 43, 56 * Math.max(0, enemy.hp / enemy.maxHp), 6);
  }

  if (player.invuln <= 0 || Math.floor(performance.now() / 70) % 2 === 0) {
    drawRobot(player.px, player.py, player.dash > 0 ? "#7dff91" : "#1d5d6e", false, 0);
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

  const labels = ["CANNON", "SWORD", "DASH", "AREA"];
  for (let i = 0; i < 4; i++) {
    const x = 430 + i * 122;
    ctx.fillStyle = "#0c171c";
    ctx.fillRect(x, 26, 104, 30);
    ctx.strokeStyle = player.chipCd[i] > 0 ? "#526772" : "#46e4ff";
    ctx.strokeRect(x, 26, 104, 30);
    ctx.fillStyle = player.chipCd[i] > 0 ? "#78919a" : "#e8f7f8";
    ctx.font = "700 12px system-ui";
    ctx.fillText(`${i + 1} ${labels[i]}`, x + 9, 46);
    if (player.chipCd[i] > 0) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(x, 26, 104 * Math.min(1, player.chipCd[i] / [1.15, 1.45, 2.2, 4][i]), 30);
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
  player.row = 1;
  player.hp = player.maxHp;
  player.invuln = 0;
  player.fireCd = 0;
  player.chipCd = [0, 0, 0, 0];
  player.facing = 1;
  const p = cellCenter(player.col, player.row);
  player.px = p.x;
  player.py = p.y;
  shots.length = 0;
  slashes.length = 0;
  zones.length = 0;
  sparks.length = 0;
  enemies.length = 0;
  obstacles.splice(0, obstacles.length, { col: 2, row: 1, hp: 45, flash: 0 });
  wave = 1;
  gameOver = false;
  message = "SYSTEM ONLINE";
  spawnEnemy("charger", 4, 0);
  spawnEnemy("turret", 5, 2);
}

window.addEventListener("keydown", (event) => {
  armAudio();
  const key = event.key.toLowerCase();
  if (!keys.has(key)) pressed.add(key);
  keys.add(key);
  if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) event.preventDefault();
  if (key === "r") restart();
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.key.toLowerCase());
});

init();
requestAnimationFrame(loop);
